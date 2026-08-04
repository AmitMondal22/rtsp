import asyncio
import datetime
import json
import logging
import random
import re
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends, HTTPException, Request, status, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.device import Device
from app.models.message import ThreadMessage
from app.models.otp import OTPCode
from app.models.user import User
from app.schemas.device import DeviceStreamOut
from app.schemas.message import ThreadMessageCreate, ThreadMessageOut
from app.schemas.otp import OTPGenerateOut, OTPVerifyIn, OTPVerifyOut, CameraActionRequest
from app.services.auth_service import get_current_user
from app.services.camera_service import (
    get_thread_messages_service,
    send_thread_message_service,
    send_message_no_mqtt_service,
    generate_otp_service,
    verify_otp_service,
)
from app.services.device_service import get_device_by_id, build_rtsp_url
from app.services.email_service import send_otp_email
from app.services.mqtt_service import publish_otp_to_device
from app.services.whatsapp_service import send_whatsapp_otp
from app.streaming import validate_rtsp_with_fallback
from app.streaming_opencv import generate_mjpeg_frames, OpenCVCamera
from app.controllers.device_controller import check_device_access
from app.utils.timezone import get_ist_now

logger = logging.getLogger("camera_controller")
router = APIRouter(prefix="/api/camera", tags=["Camera"])

# Shared executor for parallel OTP delivery (email + whatsapp)
_otp_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="otp-send")

active_camera_websockets: dict[int, list[WebSocket]] = {}


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


# ── Disconnect Active Stream (call before reconnect after device update) ──
@router.post("/{device_id}/disconnect")
async def disconnect_device_stream(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Close any active broadcaster connections for a device so the socket is released before reconnect."""
    device = get_device_by_id(db, device_id)
    check_device_access(device, current_user)

    from app.streaming_opencv import camera_broadcaster_hub
    camera_broadcaster_hub.close_broadcaster(device_id)

    return {"disconnected": True, "device_id": device_id}



@router.websocket("/{device_id}/ws")
async def websocket_stream(
    websocket: WebSocket,
    device_id: int,
    token: str = None,
    db: Session = Depends(get_db),
):
    """
    RTSP WebSocket live stream for a device.
    Uses multi-client camera broadcaster so multiple users/browsers/locations stream simultaneously.
    """
    try:
        await websocket.accept()
    except Exception as e:
        logger.warning("WebSocket accept failed: %s", e)
        return

    from app.streaming_opencv import camera_broadcaster_hub

    try:
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
        broadcaster = camera_broadcaster_hub.get_broadcaster(device_id, rtsp_url, transport="tcp")
        await broadcaster.add_websocket(websocket)

        try:
            while True:
                # Keep WebSocket open until client closes tab/connection
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.info("WebSocket closed for device %d: %s", device_id, e)
        finally:
            await broadcaster.remove_websocket(websocket)

    except Exception as outer_e:
        logger.error("Unhandled websocket error for device %d: %s", device_id, outer_e)


# ── MJPEG Streaming (reliable fallback for multi-client) ──
@router.get("/{device_id}/mjpeg")
def mjpeg_stream(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    MJPEG live stream for a device.
    Uses camera broadcaster to share frames across multiple HTTP clients.
    """
    try:
        device = get_device_by_id(db, device_id)
        check_device_access(device, current_user)

        rtsp_url = build_rtsp_url(device)
        from app.streaming_opencv import camera_broadcaster_hub
        broadcaster = camera_broadcaster_hub.get_broadcaster(device_id, rtsp_url, transport="tcp")

        async def mjpeg_generator():
            q = broadcaster.subscribe_queue()
            boundary = b"--frame\r\n"
            content_type = b"Content-Type: image/jpeg\r\n\r\n"
            try:
                while True:
                    frame = await q.get()
                    yield boundary + content_type + frame + b"\r\n"
            except asyncio.CancelledError:
                pass
            finally:
                broadcaster.unsubscribe_queue(q)

        return StreamingResponse(
            mjpeg_generator(),
            media_type="multipart/x-mixed-replace; boundary=frame",
        )
    except Exception as e:
        logger.error(f"Error initializing MJPEG stream for device {device_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to initialize MJPEG camera stream")



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

    # Set RTSP transport
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

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
    """Get all incoming OTP requests for devices accessible to the current user."""
    # Build device filter based on role
    if current_user.role == "super_admin":
        device_ids = [d.id for d in db.query(Device.id).all()]
    elif current_user.bank_id:
        device_ids = [
            d.id for d in db.query(Device.id).filter(
                or_(
                    Device.bank_id == current_user.bank_id,
                    Device.assigned_user_id == current_user.id,
                    Device.owner_id == current_user.id,
                )
            ).all()
        ]
    else:
        device_ids = [
            d.id for d in db.query(Device.id).filter(
                or_(
                    Device.assigned_user_id == current_user.id,
                    Device.owner_id == current_user.id,
                )
            ).all()
        ]

    if not device_ids:
        return []

    now = get_ist_now()
    five_minutes_ago = now - datetime.timedelta(minutes=5)

    # Single query: latest otp_request per device using a subquery
    messages = (
        db.query(ThreadMessage)
        .filter(
            ThreadMessage.device_id.in_(device_ids),
            ThreadMessage.message_type == "otp_request",
            ThreadMessage.created_at >= five_minutes_ago,
        )
        .order_by(ThreadMessage.device_id, ThreadMessage.created_at.desc())
        .all()
    )

    # Keep only the most recent per device (already sorted by device_id + desc created_at)
    seen = set()
    unique_messages = []
    for msg in messages:
        if msg.device_id not in seen:
            seen.add(msg.device_id)
            unique_messages.append(msg)

    # Build device lookup map (avoid N+1)
    devices = db.query(Device).filter(Device.id.in_(device_ids)).all()
    device_map = {d.id: d for d in devices}

    return [
        {
            "id": msg.id,
            "device_id": msg.device_id,
            "device_name": device_map.get(msg.device_id, {}).name if device_map.get(msg.device_id) else f"Device #{msg.device_id}",
            "content": msg.content,
            "payload": msg.payload,
            "message_type": msg.message_type,
            "created_at": msg.created_at.isoformat(),
        }
        for msg in unique_messages
    ]


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
    mode = (action_data.mode or "no_threat").lower()
    device = get_device_by_id(db, device_id)
    check_device_access(device, current_user)

    now = get_ist_now()
    five_minutes_ago = now - datetime.timedelta(minutes=5)

    # Require an active unacknowledged hardware OTP request
    pending_req = (
        db.query(ThreadMessage)
        .filter(
            ThreadMessage.device_id == device_id,
            ThreadMessage.message_type == "otp_request",
            ThreadMessage.created_at >= five_minutes_ago,
        )
        .order_by(ThreadMessage.created_at.desc())
        .first()
    )

    if not pending_req:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active pending hardware OTP request found. OTP can only be sent once when a device request is pending."
        )

    # Mark consumed (one-time send)
    pending_req.message_type = "otp_request_ack"
    db.commit()

    if mode == "thread":
        # Generate OTP + send email
        otp_result = generate_otp_service(db, device_id, current_user)

        return {
            "success": True,
            "mode": "thread",
            "message": f"Authorization OTP generated and dispatched to {current_user.email}.",
            "email_sent": otp_result.get("email_sent", False),
        }

    elif mode == "no_threat":
        otp1 = str(random.randint(1000, 9999))
        otp2 = str(random.randint(1000, 9999))

        u1_id = action_data.user_id_1
        u2_id = action_data.user_id_2

        # Collect candidate user IDs for a single bulk query
        candidate_ids = []
        if u1_id:
            candidate_ids.append(u1_id)
        if u2_id:
            candidate_ids.append(u2_id)
        if device.branch:
            for attr in ("otp1_user_id", "user1_id", "otp2_user_id", "user2_id"):
                v = getattr(device.branch, attr, None)
                if v:
                    candidate_ids.append(v)
        if device.assigned_user_id:
            candidate_ids.append(device.assigned_user_id)
        if getattr(device, "assigned_user_2_id", None):
            candidate_ids.append(device.assigned_user_2_id)

        # Single bulk user query
        user_map: dict[int, User] = {}
        if candidate_ids:
            fetched = db.query(User).filter(User.id.in_(set(candidate_ids))).all()
            user_map = {u.id: u for u in fetched}

        # Resolve User 1
        def _resolve_u1() -> User:
            if u1_id and u1_id in user_map:
                return user_map[u1_id]
            if device.branch:
                for attr in ("otp1_user_id", "user1_id"):
                    uid = getattr(device.branch, attr, None)
                    if uid and uid in user_map:
                        return user_map[uid]
            if device.assigned_user_id and device.assigned_user_id in user_map:
                return user_map[device.assigned_user_id]
            return current_user

        # Resolve User 2
        def _resolve_u2(u1: User) -> User:
            if u2_id and u2_id in user_map:
                return user_map[u2_id]
            if device.branch:
                for attr in ("otp2_user_id", "user2_id"):
                    uid = getattr(device.branch, attr, None)
                    if uid and uid in user_map:
                        return user_map[uid]
            if getattr(device, "assigned_user_2_id", None) and device.assigned_user_2_id in user_map:
                return user_map[device.assigned_user_2_id]
            # Fallback: any other bank user
            bank_id = device.bank_id or current_user.bank_id
            if bank_id:
                u2 = db.query(User).filter(User.bank_id == bank_id, User.id != u1.id).first()
                if u2:
                    return u2
            return u1

        u1 = _resolve_u1()
        u2 = _resolve_u2(u1)

        # Check Branch OTP enable flags
        enable_otp1 = getattr(device.branch, "enable_otp1", True) if device.branch else True
        enable_otp2 = getattr(device.branch, "enable_otp2", True) if device.branch else True
        if enable_otp1 is None:
            enable_otp1 = True
        if enable_otp2 is None:
            enable_otp2 = True

        # Bank compatibility check
        if current_user.role != "super_admin" and current_user.bank_id:
            if u1.bank_id and u1.bank_id != current_user.bank_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User 1 must belong to your bank")
            if u2.bank_id and u2.bank_id != current_user.bank_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User 2 must belong to your bank")

        expires_at = now + datetime.timedelta(minutes=5)

        if enable_otp1:
            db.add(OTPCode(device_id=device.id, user_id=u1.id, code=otp1, expires_at=expires_at))
        if enable_otp2:
            db.add(OTPCode(device_id=device.id, user_id=u2.id, code=otp2, expires_at=expires_at))
        db.commit()

        # Publish to MQTT topic
        mqtt_sent = publish_otp_to_device(device.name, otp1 if enable_otp1 else "", otp2 if enable_otp2 else "")

        # Parallel email + WhatsApp delivery via shared executor
        enable_email = getattr(device, "enable_email", True) is not False
        enable_wa = getattr(device, "enable_whatsapp", True) is not False
        wa1 = getattr(u1, "whatsapp_number", None) or getattr(device, "whatsapp_number_1", None)
        wa2 = getattr(u2, "whatsapp_number", None) or getattr(device, "whatsapp_number_2", None)

        futures = {}
        if enable_email and enable_otp1:
            futures["email1"] = _otp_executor.submit(send_otp_email, u1.email, otp1, device.name, "1st Authorization OTP")
        if enable_email and enable_otp2:
            futures["email2"] = _otp_executor.submit(send_otp_email, u2.email, otp2, device.name, "2nd Authorization OTP")
        if enable_wa and wa1 and enable_otp1:
            futures["wa1"] = _otp_executor.submit(send_whatsapp_otp, wa1, otp1, device.name, "1st Authorization OTP")
        if enable_wa and wa2 and enable_otp2:
            futures["wa2"] = _otp_executor.submit(send_whatsapp_otp, wa2, otp2, device.name, "2nd Authorization OTP")

        def _safe_result(key):
            try:
                return futures[key].result(timeout=10) if key in futures else False
            except Exception:
                return False

        email_sent1 = _safe_result("email1")
        email_sent2 = _safe_result("email2")
        whatsapp_sent1 = _safe_result("wa1")
        whatsapp_sent2 = _safe_result("wa2")

        # Save ThreadMessage
        new_msg = ThreadMessage(
            device_id=device.id,
            sender_id=current_user.id,
            content=f"No Threat authorized. 1st OTP sent to {u1.email}, 2nd OTP sent to {u2.email}. Published to MQTT `/OTP/{device.name}`.",
            message_type="no_threat",
            payload={
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
            "message": f"NO THREAT authorized for device {device.name}. OTPs dispatched to {u1.username} & {u2.username} via Email/WhatsApp & published to MQTT.",
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
