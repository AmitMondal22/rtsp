from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
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
from app.streaming_opencv import generate_mjpeg_frames

router = APIRouter(prefix="/api/camera", tags=["Camera"])


# ── Stream URL ──
@router.get("/{device_id}/stream-url", response_model=DeviceStreamOut)
def get_stream_url(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return stream URLs (RTSP, MJPEG, HLS) for a device."""
    device = get_device_by_id(db, device_id)
    if device.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    rtsp_url = build_rtsp_url(device)
    base = f"/api/camera/{device_id}"

    return DeviceStreamOut(
        device_id=device.id,
        name=device.name,
        rtsp_url=rtsp_url,
        mjpeg_url=f"{base}/mjpeg",
    )


# ── MJPEG Streaming (reliable fallback) ──
@router.get("/{device_id}/mjpeg")
def mjpeg_stream(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    MJPEG live stream for a device.

    Returns multipart/x-mixed-replace JPEG frames — works in any browser
    with a simple <img> tag. Much more reliable than WebRTC on Windows.
    """
    device = get_device_by_id(db, device_id)
    if device.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    rtsp_url = build_rtsp_url(device)
    transport = device.transport or "tcp"

    return StreamingResponse(
        generate_mjpeg_frames(rtsp_url, transport=transport),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


# ── Test RTSP Connectivity ──
@router.get("/{device_id}/test-stream")
async def test_stream(
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
    if device.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

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

    # Find all devices owned by the user
    devices = db.query(Device).filter(Device.owner_id == current_user.id).all()
    device_ids = [d.id for d in devices]
    if not device_ids:
        return []

    messages = (
        db.query(ThreadMessage)
        .filter(
            ThreadMessage.device_id.in_(device_ids),
            ThreadMessage.message_type == "otp_request"
        )
        .order_by(ThreadMessage.created_at.desc())
        .all()
    )

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
    if device.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

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
    import json
    import datetime

    mode = action_data.mode
    device = get_device_by_id(db, device_id)
    if device.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

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
        import random
        otp1 = str(random.randint(1000, 9999))
        otp2 = str(random.randint(1000, 9999))

        from app.models.otp import OTPCode
        from app.services.email_service import send_otp_email
        from app.services.mqtt_service import publish_otp_to_device
        from app.models.message import ThreadMessage

        expires_at = datetime.datetime.utcnow() + datetime.timedelta(minutes=5)

        # 1st OTP: for current requesting user
        db_otp1 = OTPCode(
            device_id=device.id,
            user_id=current_user.id,
            code=otp1,
            expires_at=expires_at,
        )
        db.add(db_otp1)

        # 2nd OTP: for another mapped user (first other user in DB, or fallback to current user)
        mapped_user = db.query(User).filter(User.id != current_user.id).first()
        if not mapped_user:
            mapped_user = current_user

        db_otp2 = OTPCode(
            device_id=device.id,
            user_id=mapped_user.id,
            code=otp2,
            expires_at=expires_at,
        )
        db.add(db_otp2)
        db.commit()

        # Publish to MQTT topic /OTP/{device.name}
        mqtt_sent = publish_otp_to_device(device.name, otp1, otp2)

        # Send emails
        email_sent1 = send_otp_email(current_user.email, otp1, device.name)
        email_sent2 = False
        if mapped_user.id != current_user.id:
            email_sent2 = send_otp_email(mapped_user.email, otp2, device.name)

        # Save ThreadMessage
        new_msg = ThreadMessage(
            device_id=device.id,
            sender_id=current_user.id,
            content=f"No Threat authorized. 1st OTP: {otp1} (sent to {current_user.username}), 2nd OTP: {otp2} (sent to {mapped_user.username}). Published to MQTT `/OTP/{device.name}`.",
            message_type="no_threat",
            payload={
                "otp1": otp1,
                "otp2": otp2,
                "recipient1": current_user.username,
                "recipient2": mapped_user.username,
                "mqtt_topic": "/OTP/0000200043",
                "mqtt_published": mqtt_sent
            }
        )
        db.add(new_msg)
        db.commit()

        return {
            "success": True,
            "mode": "no_threat",
            "message": f"NO THREAT authorized. 1st OTP ({otp1}) sent to {current_user.email}. 2nd OTP ({otp2}) sent to {mapped_user.email}. Published to MQTT `/OTP/{device.name}`.",
            "otp1": otp1,
            "otp2": otp2,
            "mapped_user": mapped_user.username,
            "mqtt_sent": mqtt_sent,
            "email_sent": email_sent1 or email_sent2,
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

