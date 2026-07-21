import re
from urllib.parse import urlparse

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.user import User
from app.schemas.device import DeviceCreate, DeviceUpdate


def sanitize_rtsp_url(url: str) -> str:
    """
    Fix malformed RTSP URLs.
    Examples:
      rtsp:554//admin1234:12345678@192.168.29.114:554/stream1 -> rtsp://admin1234:12345678@192.168.29.114:554/stream1
      rtsp://admin:pass@192.168.1.1:/stream1                -> rtsp://admin:pass@192.168.1.1:554/stream1
    """
    if not url:
        return url
    # Fix typos like 'rtsp:554//' or 'rtsp:PORT//' -> 'rtsp://'
    url = re.sub(r'^rtsp:\d+//', 'rtsp://', url)
    # Fix genuinely empty ports: host:/path -> host:554/path
    url = re.sub(r'(@[^/:]+|://[^/:@]+):(/)', r'\1:554\2', url)
    return url


def parse_rtsp_url(url: str) -> dict:
    """
    Parse an RTSP URL into its component parts.

    Example: rtsp://admin1234:12345678@192.168.29.114:554/stream1
    Returns: {host: '192.168.29.114', port: 554, username: 'admin1234',
              password: '12345678', stream_path: '/stream1'}
    """
    result = {"host": None, "port": 554, "username": None, "password": None, "stream_path": "/stream1"}
    if not url or not url.startswith("rtsp://"):
        return result

    try:
        parsed = urlparse(url)
        result["host"] = parsed.hostname
        result["port"] = parsed.port or 554
        result["username"] = parsed.username
        result["password"] = parsed.password
        result["stream_path"] = parsed.path or "/stream1"
    except Exception:
        pass

    return result


def build_rtsp_url(device: Device) -> str:
    """Build RTSP URL from individual components if rtsp_url is not set."""
    if device.rtsp_url:
        return sanitize_rtsp_url(device.rtsp_url)
    host = device.host or "localhost"
    port = device.port or 554
    path = device.stream_path or "/stream1"
    if device.username and device.password:
        return f"rtsp://{device.username}:{device.password}@{host}:{port}{path}"
    return f"rtsp://{host}:{port}{path}"


def create_device_service(db: Session, device_data: DeviceCreate, user: User) -> Device:
    rtsp_url = device_data.rtsp_url
    host = device_data.host
    port = device_data.port
    username = device_data.username
    password = device_data.password
    stream_path = device_data.stream_path

    # If full RTSP URL is provided, auto-parse missing fields from it
    if rtsp_url and rtsp_url.startswith("rtsp://"):
        parsed = parse_rtsp_url(rtsp_url)
        if not host and parsed["host"]:
            host = parsed["host"]
        if port == 554 and parsed["port"] and parsed["port"] != 554:
            port = parsed["port"]
        elif parsed["port"]:
            port = parsed["port"]
        if not username and parsed["username"]:
            username = parsed["username"]
        if not password and parsed["password"]:
            password = parsed["password"]
        if stream_path == "/stream1" and parsed["stream_path"] and parsed["stream_path"] != "/stream1":
            stream_path = parsed["stream_path"]
        elif parsed["stream_path"]:
            stream_path = parsed["stream_path"]
    elif not rtsp_url and host:
        # Build RTSP URL from manual components
        auth_part = ""
        if username and password:
            auth_part = f"{username}:{password}@"
        rtsp_url = f"rtsp://{auth_part}{host}:{port}{stream_path}"

    target_bank_id = device_data.bank_id or user.bank_id
    if not target_bank_id and device_data.assigned_user_id:
        assigned_user = db.query(User).filter(User.id == device_data.assigned_user_id).first()
        if assigned_user:
            target_bank_id = assigned_user.bank_id

    device = Device(
        name=device_data.name,
        device_type=device_data.device_type,
        rtsp_url=rtsp_url,
        host=host,
        port=port,
        username=username,
        password=password,
        stream_path=stream_path,
        transport=device_data.transport,
        manufacturer=device_data.manufacturer,
        model=device_data.model,
        firmware_version=device_data.firmware_version,
        location=device_data.location,
        latitude=device_data.latitude,
        longitude=device_data.longitude,
        extra_config=device_data.extra_config or {},
        owner_id=user.id,
        bank_id=target_bank_id,
        assigned_user_id=device_data.assigned_user_id,
        assigned_user_2_id=device_data.assigned_user_2_id,
        whatsapp_number_1=device_data.whatsapp_number_1,
        whatsapp_number_2=device_data.whatsapp_number_2,
        enable_email=device_data.enable_email if device_data.enable_email is not None else True,
        enable_whatsapp=device_data.enable_whatsapp if device_data.enable_whatsapp is not None else True,
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


def get_user_devices(db: Session, user: User) -> list[Device]:
    if user.role == "super_admin":
        return db.query(Device).all()
    elif user.role == "bank_admin":
        return db.query(Device).filter(Device.bank_id == user.bank_id).all()
    else:
        return db.query(Device).filter(
            (Device.assigned_user_id == user.id) | (Device.bank_id == user.bank_id)
        ).all()


def get_device_by_id(db: Session, device_id: int) -> Device:
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    return device


def update_device_service(db: Session, device_id: int, update_data: DeviceUpdate) -> Device:
    device = get_device_by_id(db, device_id)
    update_dict = update_data.model_dump(exclude_unset=True)
    for field, value in update_dict.items():
        setattr(device, field, value)

    if "assigned_user_id" in update_dict and update_dict["assigned_user_id"]:
        assigned_user = db.query(User).filter(User.id == update_dict["assigned_user_id"]).first()
        if assigned_user and assigned_user.bank_id:
            device.bank_id = assigned_user.bank_id

    # Rebuild RTSP URL if manual components changed and rtsp_url was not explicitly updated
    manual_fields_changed = any(f in update_dict for f in ["host", "port", "username", "password", "stream_path"])
    rtsp_url_updated_explicitly = "rtsp_url" in update_dict

    if (manual_fields_changed and not rtsp_url_updated_explicitly) or (not device.rtsp_url and device.host):
        auth_part = ""
        if device.username and device.password:
            auth_part = f"{device.username}:{device.password}@"
        device.rtsp_url = f"rtsp://{auth_part}{device.host or 'localhost'}:{device.port or 554}{device.stream_path or '/stream1'}"

    db.commit()
    db.refresh(device)
    return device


def delete_device_service(db: Session, device_id: int) -> None:
    device = get_device_by_id(db, device_id)
    db.delete(device)
    db.commit()


def assign_device_service(db: Session, device_id: int, user_id: int) -> Device:
    device = get_device_by_id(db, device_id)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    device.assigned_user_id = user_id
    if user.bank_id:
        device.bank_id = user.bank_id
    db.commit()
    db.refresh(device)
    return device
