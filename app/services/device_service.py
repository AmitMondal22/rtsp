import re
from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.models.device import Device
from app.models.user import User
from app.schemas.device import DeviceCreate, DeviceUpdate


def sanitize_rtsp_url(url: str) -> str:
    """
    Sanitize and extract clean RTSP URL from any input string (including ffplay commands or raw URLs).
    Supports all camera types (Hikvision, Dahua, Uniview, Axis, Reolink, TP-Link, MediaMTX, GStreamer, FFmpeg, IPv6, URL-encoded credentials, etc.).
    """
    if not url:
        return url
    url = url.strip()

    # Extract rtsp:// or rtsps:// if embedded inside a command string like 'ffplay -rtsp_transport tcp rtsp://...'
    match = re.search(r'(rtsps?://\S+)', url, flags=re.IGNORECASE)
    if match:
        url = match.group(1)

    # Fix duplicated schemes like 'rtsp://rtsp://' -> 'rtsp://'
    url = re.sub(r'^(?:rtsp:?/*){2,}', 'rtsp://', url, flags=re.IGNORECASE)

    # Fix 'rtsp:554//' or 'rtsp://rtsp:554//' or 'rtsp:554/' -> 'rtsp://'
    url = re.sub(r'^rtsp:?(?::554|554)?/*rtsp:?/*(?:554)?/*', 'rtsp://', url, flags=re.IGNORECASE)
    url = re.sub(r'^rtsp:554/+', 'rtsp://', url, flags=re.IGNORECASE)
    url = re.sub(r'^rtsp://554/+', 'rtsp://', url, flags=re.IGNORECASE)

    # Ensure valid scheme prefix
    if not url.lower().startswith("rtsp://") and not url.lower().startswith("rtsps://"):
        url = "rtsp://" + url.lstrip('/')

    return url


def build_rtsp_url(device: Device) -> str:
    """Return the clean RTSP stream connection URL directly from database."""
    if device.rtsp_url and device.rtsp_url.strip():
        return sanitize_rtsp_url(device.rtsp_url)
    return "rtsp://localhost:554/stream1"


def create_device_service(db: Session, device_data: DeviceCreate, user: User) -> dict:
    rtsp_url = sanitize_rtsp_url(device_data.rtsp_url) if device_data.rtsp_url else None

    target_bank_id = device_data.bank_id or user.bank_id
    if not target_bank_id and device_data.assigned_user_id:
        assigned_user = db.query(User).filter(User.id == device_data.assigned_user_id).first()
        if assigned_user:
            target_bank_id = assigned_user.bank_id

    device = Device(
        name=device_data.name,
        device_type=device_data.device_type or "rtsp",
        rtsp_url=rtsp_url,
        manufacturer=device_data.manufacturer,
        model=device_data.model,
        firmware_version=device_data.firmware_version,
        location=device_data.location,
        latitude=device_data.latitude,
        longitude=device_data.longitude,
        extra_config=device_data.extra_config or {},
        owner_id=user.id,
        bank_id=target_bank_id,
        branch_id=device_data.branch_id,
        assigned_user_id=device_data.assigned_user_id,
        assigned_user_2_id=device_data.assigned_user_2_id,
        whatsapp_number_1=device_data.whatsapp_number_1,
        whatsapp_number_2=device_data.whatsapp_number_2,
        enable_email=device_data.enable_email if device_data.enable_email is not None else True,
        enable_whatsapp=device_data.enable_whatsapp if device_data.enable_whatsapp is not None else True,
    )
    db.add(device)
    db.commit()

    device = (
        db.query(Device)
        .options(joinedload(Device.bank), joinedload(Device.branch))
        .filter(Device.id == device.id)
        .first()
    )
    return format_device_out(device)


def format_device_out(device: Device) -> dict:
    return {
        "id": device.id,
        "name": device.name,
        "device_type": device.device_type,
        "rtsp_url": device.rtsp_url,
        "manufacturer": device.manufacturer,
        "model": device.model,
        "firmware_version": device.firmware_version,
        "location": device.location,
        "latitude": device.latitude,
        "longitude": device.longitude,
        "is_online": device.is_online,
        "is_recording": device.is_recording,
        "last_seen": device.last_seen,
        "extra_config": device.extra_config,
        "owner_id": device.owner_id,
        "bank_id": device.bank_id,
        "branch_id": device.branch_id,
        "bank_name": device.bank.name if device.bank else None,
        "branch_name": device.branch.name if device.branch else None,
        "assigned_user_id": device.assigned_user_id,
        "assigned_user_2_id": device.assigned_user_2_id,
        "whatsapp_number_1": device.whatsapp_number_1,
        "whatsapp_number_2": device.whatsapp_number_2,
        "enable_email": device.enable_email if device.enable_email is not None else True,
        "enable_whatsapp": device.enable_whatsapp if device.enable_whatsapp is not None else True,
        "created_at": device.created_at,
    }


def get_user_devices(db: Session, user: User) -> list[dict]:
    """Fetch devices with bank/branch eagerly loaded to avoid N+1 lazy queries."""
    opts = [joinedload(Device.bank), joinedload(Device.branch)]
    if user.role in ["super_admin", "admin"]:
        devices = db.query(Device).options(*opts).all()
    elif user.role == "bank_admin":
        if user.bank_id:
            devices = db.query(Device).options(*opts).filter(Device.bank_id == user.bank_id).all()
        else:
            devices = []
    else:  # regular user
        if user.branch_id:
            devices = db.query(Device).options(*opts).filter(
                (Device.branch_id == user.branch_id) |
                (Device.assigned_user_id == user.id) |
                (Device.assigned_user_2_id == user.id) |
                (Device.owner_id == user.id)
            ).filter(Device.bank_id == user.bank_id if user.bank_id else True).all()
        elif user.bank_id:
            devices = db.query(Device).options(*opts).filter(Device.bank_id == user.bank_id).all()
        else:
            devices = db.query(Device).options(*opts).filter(
                (Device.assigned_user_id == user.id) |
                (Device.assigned_user_2_id == user.id) |
                (Device.owner_id == user.id)
            ).all()
    return [format_device_out(d) for d in devices]


def get_device_by_id(db: Session, device_id: int) -> Device:
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    return device


def update_device_service(db: Session, device_id: int, update_data: DeviceUpdate) -> dict:
    device = get_device_by_id(db, device_id)
    update_dict = update_data.model_dump(exclude_unset=True)

    if "rtsp_url" in update_dict and update_dict["rtsp_url"]:
        update_dict["rtsp_url"] = sanitize_rtsp_url(update_dict["rtsp_url"])

    for field, value in update_dict.items():
        if hasattr(device, field):
            setattr(device, field, value)

    if "assigned_user_id" in update_dict and update_dict["assigned_user_id"]:
        assigned_user = db.query(User).filter(User.id == update_dict["assigned_user_id"]).first()
        if assigned_user and assigned_user.bank_id:
            device.bank_id = assigned_user.bank_id

    db.add(device)
    db.commit()

    device = (
        db.query(Device)
        .options(joinedload(Device.bank), joinedload(Device.branch))
        .filter(Device.id == device_id)
        .first()
    )
    return format_device_out(device)


def delete_device_service(db: Session, device_id: int) -> None:
    from app.models.message import ThreadMessage
    from app.models.otp import OTPCode
    from app.models.otp_bulk import DeviceOfflineOTP
    from sqlalchemy import text

    device = get_device_by_id(db, device_id)
    db.query(ThreadMessage).filter(ThreadMessage.device_id == device_id).delete(synchronize_session=False)
    db.query(OTPCode).filter(OTPCode.device_id == device_id).delete(synchronize_session=False)
    db.query(DeviceOfflineOTP).filter(DeviceOfflineOTP.device_id == device_id).delete(synchronize_session=False)
    try:
        db.execute(text("DELETE FROM offline_otps WHERE device_id = :did"), {"did": device_id})
    except Exception:
        pass
    try:
        db.execute(text("DELETE FROM device_offline_otps WHERE device_id = :did"), {"did": device_id})
    except Exception:
        pass
    db.delete(device)
    db.commit()


def assign_device_service(db: Session, device_id: int, user_id: int) -> dict:
    device = get_device_by_id(db, device_id)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    device.assigned_user_id = user_id
    if user.bank_id:
        device.bank_id = user.bank_id
    db.commit()
    db.refresh(device)
    return format_device_out(device)


