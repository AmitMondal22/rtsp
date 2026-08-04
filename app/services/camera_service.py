import random
import datetime
import json
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.user import User
from app.models.message import ThreadMessage
from app.models.otp import OTPCode
from app.schemas.message import ThreadMessageCreate
from app.services.device_service import get_device_by_id

from app.services.email_service import send_otp_email


def check_device_access(device: Device, user: User) -> None:
    """Ensure user has access to the device."""
    if device.owner_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this device",
        )


# ── Thread Messages (MQTT Published) ──

def get_thread_messages_service(db: Session, device_id: int, user: User) -> list[ThreadMessage]:
    device = get_device_by_id(db, device_id)
    check_device_access(device, user)
    return (
        db.query(ThreadMessage)
        .filter(ThreadMessage.device_id == device_id)
        .order_by(ThreadMessage.created_at.asc())
        .all()
    )


def send_thread_message_service(
    db: Session, device_id: int, user: User, msg_data: ThreadMessageCreate
) -> ThreadMessage:
    device = get_device_by_id(db, device_id)
    check_device_access(device, user)

    # Save message to database
    new_msg = ThreadMessage(
        device_id=device_id,
        sender_id=user.id,
        content=msg_data.content,
        message_type=msg_data.message_type,
        payload=msg_data.payload,
    )
    db.add(new_msg)
    db.commit()
    db.refresh(new_msg)
    return new_msg


def send_message_no_mqtt_service(
    db: Session, device_id: int, user: User, msg_data: ThreadMessageCreate
) -> ThreadMessage:
    """Send a message saved to DB only — NOT published to MQTT (No Thread mode)."""
    device = get_device_by_id(db, device_id)
    check_device_access(device, user)

    new_msg = ThreadMessage(
        device_id=device_id,
        sender_id=user.id,
        content=msg_data.content,
        message_type=msg_data.message_type,
        payload=msg_data.payload,
        is_mqtt_published=False,
    )
    db.add(new_msg)
    db.commit()
    db.refresh(new_msg)
    return new_msg


from app.services.whatsapp_service import send_whatsapp_otp

# ── OTP ──

def generate_otp_service(db: Session, device_id: int, user: User) -> dict:
    device = get_device_by_id(db, device_id)
    check_device_access(device, user)

    target_user = user
    if device.branch and device.branch.otp1_user_id:
        b_u1 = db.query(User).filter(User.id == device.branch.otp1_user_id).first()
        if b_u1:
            target_user = b_u1
    elif device.branch and device.branch.user1_id:
        b_u1 = db.query(User).filter(User.id == device.branch.user1_id).first()
        if b_u1:
            target_user = b_u1
    elif device.assigned_user_id:
        assigned_u = db.query(User).filter(User.id == device.assigned_user_id).first()
        if assigned_u:
            target_user = assigned_u

    from app.utils.timezone import get_ist_now
    now = get_ist_now()

    # Rate limit: check if there's an unexpired, unused OTP for this device+target_user
    existing_otp = (
        db.query(OTPCode)
        .filter(
            OTPCode.device_id == device_id,
            OTPCode.user_id == target_user.id,
            OTPCode.is_used == False,
            OTPCode.expires_at > now,
        )
        .first()
    )
    
    wa_number = device.whatsapp_number_1 or (getattr(target_user, "whatsapp_number", None))

    if existing_otp:
        code = existing_otp.code
        email_sent = False
        if getattr(device, "enable_email", True) is not False:
            email_sent = send_otp_email(target_user.email, code, device.name, otp_label="Device Access OTP")
        
        whatsapp_sent = False
        if getattr(device, "enable_whatsapp", True) is not False and wa_number:
            whatsapp_sent = send_whatsapp_otp(wa_number, code, device.name, otp_label="Device Access OTP")

        # Log to ThreadMessage for single OTP retrieval/reuse
        new_msg = ThreadMessage(
            device_id=device_id,
            sender_id=target_user.id,
            content=f"Single OTP retrieved (Active). OTP: {code}. Sent to {target_user.username} ({target_user.email}).",
            message_type="thread",
            payload={
                "otp_code": code,
                "otp1": code,
                "otp2": "—",
                "recipient1": target_user.username,
                "recipient1_email": target_user.email,
                "email_sent": email_sent,
                "whatsapp_sent": whatsapp_sent,
                "mqtt_topic": f"/OTP/{device.name}",
                "mqtt_published": False
            }
        )
        db.add(new_msg)
        db.commit()

        return {
            "otp_id": existing_otp.id,
            "code": code,
            "expires_at": existing_otp.expires_at,
            "message": f"An active OTP already exists for {target_user.username} ({target_user.email}). Valid until {existing_otp.expires_at.strftime('%H:%M:%S')}.",
            "email_sent": email_sent,
            "whatsapp_sent": whatsapp_sent,
        }

    code = str(random.randint(100000, 999999))
    expires_at = now + datetime.timedelta(minutes=5)

    otp = OTPCode(
        device_id=device_id,
        user_id=target_user.id,
        code=code,
        expires_at=expires_at,
    )
    db.add(otp)
    db.commit()
    db.refresh(otp)

    email_sent = False
    if getattr(device, "enable_email", True) is not False:
        email_sent = send_otp_email(target_user.email, code, device.name, otp_label="Device Access OTP")

    whatsapp_sent = False
    if getattr(device, "enable_whatsapp", True) is not False and wa_number:
        whatsapp_sent = send_whatsapp_otp(wa_number, code, device.name, otp_label="Device Access OTP")

    from app.services.mqtt_service import publish_otp_to_device
    mqtt_sent = publish_otp_to_device(device.name, code, code)

    # Log to ThreadMessage for single OTP generation
    new_msg = ThreadMessage(
        device_id=device_id,
        sender_id=target_user.id,
        content=f"Single OTP generated. OTP: {code}. Sent to {target_user.username} ({target_user.email}).",
        message_type="thread",
        payload={
            "otp_code": code,
            "otp1": code,
            "otp2": "—",
            "recipient1": target_user.username,
            "recipient1_email": target_user.email,
            "email_sent": email_sent,
            "whatsapp_sent": whatsapp_sent,
            "mqtt_topic": f"/OTP/{device.name}",
            "mqtt_published": mqtt_sent
        }
    )
    db.add(new_msg)
    db.commit()

    return {
        "otp_id": otp.id,
        "code": code,
        "expires_at": expires_at,
        "message": f"OTP generated for device {device.name} and sent to {target_user.username} ({target_user.email}). Valid for 5 minutes.",
        "email_sent": email_sent,
        "whatsapp_sent": whatsapp_sent,
        "mqtt_sent": mqtt_sent,
    }



def verify_otp_service(db: Session, device_id: int, user: User, code: str) -> dict:
    device = get_device_by_id(db, device_id)
    check_device_access(device, user)

    from app.utils.timezone import get_ist_now
    now = get_ist_now()
    otp = (
        db.query(OTPCode)
        .filter(
            OTPCode.device_id == device_id,
            OTPCode.user_id == user.id,
            OTPCode.code == code,
            OTPCode.is_used == False,
            OTPCode.expires_at > now,
        )
        .first()
    )

    if not otp:
        return {"success": False, "message": "Invalid or expired OTP code."}

    otp.is_used = True
    db.commit()



    return {
        "success": True,
        "message": "OTP verified successfully. You now have access to this device.",
    }
