import asyncio
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Request, status, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.device import Device
from app.models.message import ThreadMessage
from app.schemas.device import DeviceStreamOut
from app.schemas.message import ThreadMessageCreate, ThreadMessageOut
from app.schemas.otp import OTPGenerateOut, OTPVerifyIn, OTPVerifyOut, CameraActionRequest
from app.services.auth_service import get_current_user
from app.services.device_service import get_device_by_id, build_rtsp_url
from app.services.camera_service import (
    get_thread_messages_service,
    send_thread_message_service,
    send_message_no_mqtt_service,
    generate_otp_service,
    verify_otp_service,
)
from app.streaming import validate_rtsp_with_fallback
from app.streaming_opencv import generate_mjpeg_frames, OpenCVCamera
from app.controllers.device_controller import check_device_access

logger = logging.getLogger("camera_controller")
router = APIRouter(prefix="/api/camera", tags=["Camera"])


# ── Stream URL ──
@router.get("/{device_id}/stream-url", response_model=DeviceStreamOut)
def get_stream_url(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return stream URLs (RTSP, MJPEG, WebSocket) for a device."""
    device = get_device_by_id(db, device_id)
    check_device_access(device, current_user)

    rtsp_url = build_rtsp_url(device)
    base = f"/api/camera/{device_id}"

    return DeviceStreamOut(
        device_id=device.id,
        name=device.name,
        rtsp_url=rtsp_url,
        mjpeg_url=f"{base}/mjpeg",
    )


# ── WebSocket Streaming (RTSP backend -> WebSocket frontend) ──
@router.websocket("/{device_id}/ws")
async def websocket_stream(
    websocket: WebSocket,
    device_id: int,
    token: str = None,
    db: Session = Depends(get_db),
):
    """
    RTSP WebSocket live stream for a device.
    Backend captures RTSP video via OpenCV and streams JPEG binary frames over WebSocket to frontend.
    """
    await websocket.accept()

    # Authenticate token if provided
    if token:
        try:
            from app.services.auth_service import verify_token
            payload = verify_token(token)
            if not payload:
                await websocket.close(code=1008, reason="Unauthorized")
                return
        except Exception:
            await websocket.close(code=1008, reason="Invalid token")
            return

    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        await websocket.close(code=1008, reason="Device not found")
        return

    rtsp_url = build_rtsp_url(device)
    transport = device.transport or "tcp"

    camera = OpenCVCamera(rtsp_url, transport=transport)
    opened = await camera.open()
    if not opened:
        try:
            await websocket.send_text(json.dumps({"error": "Failed to connect to RTSP camera stream"}))
        except Exception:
            pass
        await websocket.close(code=1011)
        return

    try:
        while True:
            jpeg_bytes = await camera.read_frame()
            if jpeg_bytes is not None:
                try:
                    await websocket.send_bytes(jpeg_bytes)
                except (WebSocketDisconnect, RuntimeError, ConnectionResetError, asyncio.CancelledError):
                    logger.info(f"WebSocket client disconnected for device {device_id}. Stopping camera stream.")
                    break
            await asyncio.sleep(1.0 / 15.0)  # ~15 FPS
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for device {device_id}.")
    except Exception as e:
        logger.warning(f"WebSocket streaming closed for device {device_id}: {e}")
    finally:
        logger.info(f"Disconnecting backend RTSP camera resources for device {device_id}...")
        await camera.release_async()



# ── MJPEG Streaming (reliable fallback) ──
@router.get("/{device_id}/mjpeg")
def mjpeg_stream(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    MJPEG live stream for a device.
    Returns multipart/x-mixed-replace JPEG frames.
    """
    device = get_device_by_id(db, device_id)
    check_device_access(device, current_user)

    rtsp_url = build_rtsp_url(device)
    transport = device.transport or "tcp"

    return StreamingResponse(
        generate_mjpeg_frames(rtsp_url, transport=transport),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )



# ── Test RTSP Connectivity ──
@router.get("/{device_id}/test-stream")
def test_stream(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Quick connectivity test: tries to open the RTSP stream with OpenCV
    and capture a single frame. Returns success/failure details.
    """
    import cv2
    import os

    device = get_device_by_id(db, device_id)
    check_device_access(device, current_user)

    rtsp_url = build_rtsp_url(device)
    transport = device.transport or "tcp"

    # Set RTSP transport
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = f"rtsp_transport;{transport}"

    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        cap.release()
        return {
            "device_id": device_id,
            "rtsp_url": rtsp_url,
            "success": False,
            "error": "OpenCV could not open the RTSP stream. Check URL, credentials, and network.",
        }

    ret, frame = cap.read()
    cap.release()

    if not ret or frame is None:
        return {
            "device_id": device_id,
            "rtsp_url": rtsp_url,
            "success": False,
            "error": "Stream opened but failed to capture a frame.",
        }

    return {
        "device_id": device_id,
        "rtsp_url": rtsp_url,
        "success": True,
        "frame_size": f"{frame.shape[1]}x{frame.shape[0]}",
        "message": "Successfully captured a frame from the camera.",
    }


@router.get("/otp-requests")
def get_global_otp_requests(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all incoming OTP requests for devices owned by the current user."""
    from app.models.device import Device
    from app.models.message import ThreadMessage

    if current_user.role == "super_admin":
        devices = db.query(Device).all()
    elif current_user.role == "bank_admin":
        devices = db.query(Device).filter(Device.bank_id == current_user.bank_id).all()
    else:
        devices = db.query(Device).filter(Device.assigned_user_id == current_user.id).all()

    device_ids = [d.id for d in devices]
    if not device_ids:
        return []

    import datetime
    now = datetime.datetime.utcnow()
    five_minutes_ago = now - datetime.timedelta(minutes=5)

    messages = []
    for d_id in device_ids:
        latest = (
            db.query(ThreadMessage)
            .filter(ThreadMessage.device_id == d_id)
            .order_by(ThreadMessage.created_at.desc())
            .first()
        )
        if latest and latest.message_type in ("otp_request", "otp_request_ack"):
            if latest.created_at >= five_minutes_ago:
                messages.append(latest)

    messages.sort(key=lambda m: m.created_at, reverse=True)

    result = []
    for msg in messages:
        # Resolve device name
        dev = next((d for d in devices if d.id == msg.device_id), None)
        out = {
            "id": msg.id,
            "device_id": msg.device_id,
            "device_name": dev.name if dev else f"Device #{msg.device_id}",
            "content": msg.content,
            "payload": msg.payload,
            "created_at": msg.created_at.isoformat(),
        }
        result.append(out)
    return result


# ── Thread Messages (via MQTT) ──
@router.get("/{device_id}/thread", response_model=list[ThreadMessageOut])
def get_thread_messages(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all thread messages for a device."""
    messages = get_thread_messages_service(db, device_id, current_user)
    # Enrich with sender username
    result = []
    for msg in messages:
        out = ThreadMessageOut(
            id=msg.id,
            device_id=msg.device_id,
            sender_id=msg.sender_id,
            sender_username=msg.sender.username if msg.sender else f"User #{msg.sender_id}",
            content=msg.content,
            message_type=msg.message_type,
            payload=msg.payload,
            created_at=msg.created_at,
        )
        result.append(out)
    return result


@router.post("/{device_id}/thread", response_model=ThreadMessageOut)
def send_thread_message(
    device_id: int,
    message: ThreadMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Send a message in the device thread. Published to MQTT as JSON."""
    msg = send_thread_message_service(db, device_id, current_user, message)
    return ThreadMessageOut(
        id=msg.id,
        device_id=msg.device_id,
        sender_id=msg.sender_id,
        sender_username=current_user.username,
        content=msg.content,
        message_type=msg.message_type,
        payload=msg.payload,
        created_at=msg.created_at,
    )


# ── No-Thread Message (No MQTT) ──
@router.post("/{device_id}/message", response_model=ThreadMessageOut)
def send_no_thread_message(
    device_id: int,
    message: ThreadMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Send a message in No Thread mode — saved locally, NOT published to MQTT."""
    msg = send_message_no_mqtt_service(db, device_id, current_user, message)
    return ThreadMessageOut(
        id=msg.id,
        device_id=msg.device_id,
        sender_id=msg.sender_id,
        sender_username=current_user.username,
        content=msg.content,
        message_type=msg.message_type,
        payload=msg.payload,
        created_at=msg.created_at,
    )


# ── OTP ──
@router.post("/{device_id}/otp/generate", response_model=OTPGenerateOut)
def generate_otp(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a 6-digit OTP for device access (No Thread mode)."""
    result = generate_otp_service(db, device_id, current_user)
    return OTPGenerateOut(**result)


@router.post("/{device_id}/otp/verify", response_model=OTPVerifyOut)
def verify_otp(
    device_id: int,
    otp_data: OTPVerifyIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Verify a 6-digit OTP code."""
    result = verify_otp_service(db, device_id, current_user, otp_data.code)
    return OTPVerifyOut(**result)


# ── Validate RTSP Connection ──
@router.post("/{device_id}/validate")
async def validate_stream(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Validate that the device's RTSP stream is reachable.
    Tries the configured transport first, then falls back through TCP/UDP/HTTP.
    """
    device = get_device_by_id(db, device_id)
    check_device_access(device, current_user)

    rtsp_url = build_rtsp_url(device)
    is_valid, transport_used = await validate_rtsp_with_fallback(
        rtsp_url,
        preferred_transport=device.transport or "tcp",
    )
    return {
        "device_id": device_id,
        "rtsp_url": rtsp_url,
        "reachable": is_valid,
        "transport_used": transport_used,
    }


# ── Unified Send Action (Thread / No Thread) ──
@router.post("/{device_id}/send-action")
def send_action(
    device_id: int,
    action_data: CameraActionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    import random
    import datetime

    mode = action_data.mode
    device = get_device_by_id(db, device_id)
    check_device_access(device, current_user)

    if mode == "thread":
        # Generate OTP + send email
        otp_result = generate_otp_service(db, device_id, current_user)

        return {
            "success": True,
            "mode": "thread",
            "message": f"OTP generated and sent to {current_user.email}",
            "otp_code": otp_result["code"],
            "otp_expires_at": otp_result["expires_at"].isoformat(),
            "email_sent": otp_result.get("email_sent", False),
        }

    elif mode == "no_threat":
        # Generate two 4-digit OTPs
        otp1 = str(random.randint(1000, 9999))
        otp2 = str(random.randint(1000, 9999))

        from app.models.otp import OTPCode
        from app.services.email_service import send_otp_email
        from app.services.mqtt_service import publish_otp_to_device
        from app.models.message import ThreadMessage

        u1_id = action_data.user_id_1
        u2_id = action_data.user_id_2

        # 1. Resolve User 1 (defaults to branch OTP1 user or device assigned_user)
        if u1_id:
            u1 = db.query(User).filter(User.id == u1_id).first()
        elif device.assigned_user_id:
            u1 = db.query(User).filter(User.id == device.assigned_user_id).first()
        elif device.branch and device.branch.otp1_user_id:
            u1 = db.query(User).filter(User.id == device.branch.otp1_user_id).first()
        elif device.branch and device.branch.user1_id:
            u1 = db.query(User).filter(User.id == device.branch.user1_id).first()
        else:
            u1 = current_user

        if not u1:
            u1 = current_user

        # 2. Resolve User 2 (defaults to branch OTP2 user or device assigned_user_2)
        if u2_id:
            u2 = db.query(User).filter(User.id == u2_id).first()
        elif getattr(device, "assigned_user_2_id", None):
            u2 = db.query(User).filter(User.id == device.assigned_user_2_id).first()
        elif device.branch and device.branch.otp2_user_id:
            u2 = db.query(User).filter(User.id == device.branch.otp2_user_id).first()
        elif device.branch and device.branch.user2_id:
            u2 = db.query(User).filter(User.id == device.branch.user2_id).first()
        else:
            bank_id = device.bank_id or current_user.bank_id
            if bank_id:
                u2 = db.query(User).filter(User.bank_id == bank_id, User.id != u1.id).first()
            else:
                u2 = db.query(User).filter(User.id != u1.id).first()

        if not u2:
            u2 = u1

        # Check Branch OTP enable flags
        enable_otp1 = True
        enable_otp2 = True
        if device.branch:
            if getattr(device.branch, "enable_otp1", None) is False:
                enable_otp1 = False
            if getattr(device.branch, "enable_otp2", None) is False:
                enable_otp2 = False

        # Validation check for bank compatibility
        if current_user.role != "super_admin" and current_user.bank_id:
            if u1.bank_id and u1.bank_id != current_user.bank_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User 1 must belong to your bank")
            if u2.bank_id and u2.bank_id != current_user.bank_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User 2 must belong to your bank")

        expires_at = datetime.datetime.utcnow() + datetime.timedelta(minutes=5)

        # 1st OTP: for User 1 if enabled
        if enable_otp1:
            db_otp1 = OTPCode(
                device_id=device.id,
                user_id=u1.id,
                code=otp1,
                expires_at=expires_at,
            )
            db.add(db_otp1)

        # 2nd OTP: for User 2 if enabled
        if enable_otp2:
            db_otp2 = OTPCode(
                device_id=device.id,
                user_id=u2.id,
                code=otp2,
                expires_at=expires_at,
            )
            db.add(db_otp2)
        db.commit()

        # Publish to MQTT topic /OTP/{device.name}
        mqtt_sent = publish_otp_to_device(device.name, otp1 if enable_otp1 else "", otp2 if enable_otp2 else "")

        # 1. Email Delivery (if enable_email is True and OTP enabled)
        email_sent1 = False
        email_sent2 = False
        if getattr(device, "enable_email", True) is not False:
            if enable_otp1:
                email_sent1 = send_otp_email(u1.email, otp1, device.name, otp_label="1st Authorization OTP")
            if enable_otp2:
                email_sent2 = send_otp_email(u2.email, otp2, device.name, otp_label="2nd Authorization OTP")

        # 2. WhatsApp Delivery (if enable_whatsapp is True and OTP enabled)
        from app.services.whatsapp_service import send_whatsapp_otp
        whatsapp_sent1 = False
        whatsapp_sent2 = False
        if getattr(device, "enable_whatsapp", True) is not False:
            wa1 = getattr(device, "whatsapp_number_1", None) or getattr(u1, "whatsapp_number", None)
            wa2 = getattr(device, "whatsapp_number_2", None) or getattr(u2, "whatsapp_number", None)
            if wa1 and enable_otp1:
                whatsapp_sent1 = send_whatsapp_otp(wa1, otp1, device.name, otp_label="1st Authorization OTP")
            if wa2 and enable_otp2:
                whatsapp_sent2 = send_whatsapp_otp(wa2, otp2, device.name, otp_label="2nd Authorization OTP")

        # Save ThreadMessage
        new_msg = ThreadMessage(
            device_id=device.id,
            sender_id=current_user.id,
            content=f"No Threat authorized. 1st OTP: {otp1} (sent to {u1.email}), 2nd OTP: {otp2} (sent to {u2.email}). Published to MQTT `/OTP/{device.name}`.",
            message_type="no_threat",
            payload={
                "otp1": otp1,
                "otp2": otp2,
                "recipient1": u1.username,
                "recipient1_email": u1.email,
                "recipient2": u2.username,
                "recipient2_email": u2.email,
                "email_sent1": email_sent1,
                "email_sent2": email_sent2,
                "whatsapp_sent1": whatsapp_sent1,
                "whatsapp_sent2": whatsapp_sent2,
                "mqtt_topic": f"/OTP/{device.name}",
                "mqtt_published": mqtt_sent
            }
        )
        db.add(new_msg)
        db.commit()

        return {
            "success": True,
            "mode": "no_threat",
            "message": f"NO THREAT authorized. 1st OTP ({otp1}) sent to {u1.email}. 2nd OTP ({otp2}) sent to {u2.email}. Published to MQTT `/OTP/{device.name}`.",
            "otp1": otp1,
            "otp2": otp2,
            "user1_username": u1.username,
            "user1_email": u1.email,
            "user2_username": u2.username,
            "user2_email": u2.email,
            "enable_email": getattr(device, "enable_email", True),
            "enable_whatsapp": getattr(device, "enable_whatsapp", True),
            "email_sent1": email_sent1,
            "email_sent2": email_sent2,
            "whatsapp_sent1": whatsapp_sent1,
            "whatsapp_sent2": whatsapp_sent2,
            "mapped_user": u2.username,
            "mqtt_sent": mqtt_sent,
            "email_sent": email_sent1 or email_sent2,
            "whatsapp_sent": whatsapp_sent1 or whatsapp_sent2,
        }

    else:
        # No Thread mode — local message only, no email
        from app.schemas.message import ThreadMessageCreate
        msg_data = ThreadMessageCreate(
            content="No Thread — message saved locally",
            message_type="no_thread",
        )
        msg = send_message_no_mqtt_service(db, device_id, current_user, msg_data)

        return {
            "success": True,
            "mode": "no_thread",
            "message": "No Thread — message saved locally. No email sent.",
            "msg_id": msg.id,
            "email_sent": False,
        }


@router.get("/{device_id}/last-acknowledgment")
def get_last_acknowledgment(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = get_device_by_id(db, device_id)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    
    from app.models.message import ThreadMessage
    last_msg = (
        db.query(ThreadMessage)
        .filter(
            ThreadMessage.device_id == device_id,
            ThreadMessage.message_type.in_(["otp_request_ack", "otp_request", "no_threat", "thread"])
        )
        .order_by(ThreadMessage.created_at.desc())
        .first()
    )
    if not last_msg:
        return {"has_ack": False, "message": "No recent OTP requests or acknowledgments."}
    
    # Sanitize payload to completely remove any OTP values
    payload = dict(last_msg.payload or {})
    payload.pop("otp1", None)
    payload.pop("otp2", None)
    payload.pop("otp_code", None)
    payload.pop("code", None)

    # Sanitize content to mask any OTP numbers (4 or 6 digits)
    import re
    content = last_msg.content
    content = re.sub(r'\b\d{4}\b', '****', content)
    content = re.sub(r'\b\d{6}\b', '******', content)

    return {
        "has_ack": True,
        "id": last_msg.id,
        "message_type": last_msg.message_type,
        "content": content,
        "payload": payload,
        "created_at": last_msg.created_at.isoformat(),
    }




@router.get("/{device_id}/otp-report")
def get_otp_report(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = get_device_by_id(db, device_id)
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    
    messages = (
        db.query(ThreadMessage)
        .filter(
            ThreadMessage.device_id == device_id,
            ThreadMessage.message_type.in_(["otp_request_ack", "otp_request", "no_threat", "thread"])
        )
        .order_by(ThreadMessage.created_at.desc())
        .limit(100)
        .all()
    )
    
    report_items = []
    for m in messages:
        payload = m.payload or {}
        report_items.append({
            "id": m.id,
            "device_name": device.name,
            "message_type": m.message_type,
            "created_at": m.created_at.isoformat(),
            "user1": payload.get("recipient1") or payload.get("user1_username") or "—",
            "user2": payload.get("recipient2") or payload.get("user2_username") or "—",
            "email_sent": payload.get("email_sent1") or payload.get("email_sent") or False,
            "whatsapp_sent": payload.get("whatsapp_sent1") or payload.get("whatsapp_sent") or False,
            "mqtt_topic": payload.get("mqtt_topic") or payload.get("topic") or f"/OTP/{device.name}",
            "status": "Acknowledged" if m.message_type in ("otp_request_ack", "no_threat") else "Generated"
        })
    
    return {
        "device_id": device.id,
        "device_name": device.name,
        "location": device.location,
        "total_records": len(report_items),
        "report": report_items,
    }
