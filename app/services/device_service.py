import re
from urllib.parse import urlparse, unquote

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.user import User
from app.schemas.device import DeviceCreate, DeviceUpdate


def sanitize_rtsp_url(url: str) -> str:
    """
    Clean up malformed RTSP URL prefixes while preserving valid hosts, ports, credentials, and stream paths.
    
    Examples:
      'rtsp://rtsp:554//stream.strba.sk:1935/strba/VYHLAD_JAZERO.stream' -> 'rtsp://stream.strba.sk:1935/strba/VYHLAD_JAZERO.stream'
      'rtsp:554//stream.strba.sk:1935/strba/VYHLAD_JAZERO.stream'        -> 'rtsp://stream.strba.sk:1935/strba/VYHLAD_JAZERO.stream'
      'rtsp://rtsp://admin:pass@192.168.1.100:554/live'                -> 'rtsp://admin:pass@192.168.1.100:554/live'
    """
    if not url:
        return url
    url = url.strip()

    # Replace garbage prefixes like 'rtsp://rtsp:554//', 'rtsp:554//', 'rtsp://rtsp://', etc.
    pattern = r'^(?:rtsp:?/*)+(?:\d+/*)?(?:rtsp:?/*)*'
    url = re.sub(pattern, 'rtsp://', url, flags=re.IGNORECASE)

    if not url.lower().startswith("rtsp://") and not url.lower().startswith("rtsps://"):
        url = "rtsp://" + url

    return url


def parse_rtsp_url(url: str) -> dict:
    """
    Parse an RTSP URL into component parts.
    Supports query parameters (?channel=1&subtype=1) and URL-decoded credentials (%40, %23, etc.)

    Example: rtsp://admin:pass%40123@192.168.1.108:554/cam/realmonitor?channel=1&subtype=1
    Returns: {host: '192.168.1.108', port: 554, username: 'admin',
              password: 'pass@123', stream_path: '/cam/realmonitor?channel=1&subtype=1'}
    """
    result = {"host": None, "port": 554, "username": None, "password": None, "stream_path": "/stream1"}
    if not url:
        return result

    cleaned_url = sanitize_rtsp_url(url)
    if not cleaned_url.startswith("rtsp://"):
        return result

    try:
        http_url = re.sub(r'^rtsp://', 'http://', cleaned_url, flags=re.IGNORECASE)
        parsed = urlparse(http_url)
        result["host"] = parsed.hostname
        result["port"] = parsed.port or 554
        result["username"] = unquote(parsed.username) if parsed.username else None
        result["password"] = unquote(parsed.password) if parsed.password else None

        path_str = parsed.path or "/stream1"
        if parsed.query:
            path_str = f"{path_str}?{parsed.query}"
        result["stream_path"] = path_str
    except Exception:
        pass

    return result


def build_rtsp_url(device: Device) -> str:
    """Return the sanitized device RTSP stream URL."""
    if device.rtsp_url and device.rtsp_url.strip():
        return sanitize_rtsp_url(device.rtsp_url)
    host = device.host or "localhost"
    port = device.port or 554
    path = device.stream_path or "/stream1"
    if device.username and device.password:
        return f"rtsp://{device.username}:{device.password}@{host}:{port}{path}"
    return f"rtsp://{host}:{port}{path}"


def create_device_service(db: Session, device_data: DeviceCreate, user: User) -> Device:
    rtsp_url = sanitize_rtsp_url(device_data.rtsp_url) if device_data.rtsp_url else None

    host = device_data.host
    port = device_data.port
    username = device_data.username
    password = device_data.password
    stream_path = device_data.stream_path

    # If full RTSP URL is provided, auto-parse missing fields from it
    if rtsp_url:
        parsed = parse_rtsp_url(rtsp_url)
        if not host and parsed.get("host"):
            host = parsed["host"]
        if (not port or port == 554) and parsed.get("port"):
            port = parsed["port"]
        if not username and parsed.get("username"):
            username = parsed["username"]
        if not password and parsed.get("password"):
            password = parsed["password"]
        if (not stream_path or stream_path == "/stream1") and parsed.get("stream_path"):
            stream_path = parsed["stream_path"]
    elif host:
        auth_part = ""
        if username and password:
            auth_part = f"{username}:{password}@"
        rtsp_url = f"rtsp://{auth_part}{host}:{port or 554}{stream_path or '/stream1'}"

    target_bank_id = device_data.bank_id or user.bank_id
    if not target_bank_id and device_data.assigned_user_id:
        assigned_user = db.query(User).filter(User.id == device_data.assigned_user_id).first()
        if assigned_user:
            target_bank_id = assigned_user.bank_id

    device = Device(
        name=device_data.name,
        device_type=device_data.device_type or "rtsp",
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
    db.refresh(device)
    return format_device_out(device)


def format_device_out(device: Device) -> dict:
    return {
        "id": device.id,
        "name": device.name,
        "device_type": device.device_type,
        "host": device.host,
        "port": device.port or 554,
        "username": device.username,
        "stream_path": device.stream_path or "/stream1",
        "transport": device.transport or "tcp",
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
    if user.role in ["super_admin", "admin"]:
        devices = db.query(Device).all()
    elif user.role == "bank_admin":
        devices = db.query(Device).filter(Device.bank_id == user.bank_id).all()
    else:
        devices = db.query(Device).filter(
            (Device.assigned_user_id == user.id) | (Device.bank_id == user.bank_id)
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

    # 1. If rtsp_url is provided in update, sanitize/strip and parse components
    if "rtsp_url" in update_dict and update_dict["rtsp_url"]:
        new_url = sanitize_rtsp_url(update_dict["rtsp_url"])
        update_dict["rtsp_url"] = new_url

        parsed = parse_rtsp_url(new_url)
        if parsed.get("host"):
            update_dict["host"] = parsed["host"]
        if parsed.get("port"):
            update_dict["port"] = parsed["port"]
        if parsed.get("username"):
            update_dict["username"] = parsed["username"]
        if parsed.get("password"):
            update_dict["password"] = parsed["password"]
        if parsed.get("stream_path"):
            update_dict["stream_path"] = parsed["stream_path"]

    for field, value in update_dict.items():
        setattr(device, field, value)

    if "assigned_user_id" in update_dict and update_dict["assigned_user_id"]:
        assigned_user = db.query(User).filter(User.id == update_dict["assigned_user_id"]).first()
        if assigned_user and assigned_user.bank_id:
            device.bank_id = assigned_user.bank_id

    # If rtsp_url is empty but host exists, build RTSP URL from manual components
    if not device.rtsp_url and device.host:
        auth_part = ""
        if device.username and device.password:
            auth_part = f"{device.username}:{device.password}@"
        device.rtsp_url = f"rtsp://{auth_part}{device.host}:{device.port or 554}{device.stream_path or '/stream1'}"

    db.commit()
    db.refresh(device)
    return format_device_out(device)


def delete_device_service(db: Session, device_id: int) -> None:
    from app.models.message import ThreadMessage
    from app.models.otp import OTPCode

    device = get_device_by_id(db, device_id)
    db.query(ThreadMessage).filter(ThreadMessage.device_id == device_id).delete(synchronize_session=False)
    db.query(OTPCode).filter(OTPCode.device_id == device_id).delete(synchronize_session=False)
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

