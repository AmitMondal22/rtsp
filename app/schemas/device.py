import datetime
import re
from pydantic import BaseModel, field_validator
from typing import Optional, Any


class DeviceCreate(BaseModel):
    name: str
    device_type: str = "ip_camera"
    # Connection details
    host: Optional[str] = None
    port: int = 554
    username: Optional[str] = None
    password: Optional[str] = None
    stream_path: str = "/stream1"
    transport: str = "tcp"
    # Alternative: full RTSP URL
    rtsp_url: Optional[str] = None
    # Metadata
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    firmware_version: Optional[str] = None
    # Location
    location: Optional[str] = None
    latitude: Optional[str] = None
    longitude: Optional[str] = None
    # Extra
    extra_config: Optional[dict[str, Any]] = None
    bank_id: Optional[int] = None
    assigned_user_id: Optional[int] = None
    assigned_user_2_id: Optional[int] = None
    whatsapp_number_1: Optional[str] = None
    whatsapp_number_2: Optional[str] = None
    enable_email: bool = True
    enable_whatsapp: bool = True

    model_config = {"extra": "ignore"}

    @field_validator("transport")
    @classmethod
    def validate_transport(cls, v: str) -> str:
        if v not in ("tcp", "udp", "http"):
            raise ValueError("Transport must be tcp, udp, or http")
        return v

    @field_validator("rtsp_url")
    @classmethod
    def validate_rtsp_url(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return v
        v = re.sub(r'^rtsp:\d+//', 'rtsp://', v.strip())
        if not v.startswith("rtsp://") and not v.isdigit():
            raise ValueError("RTSP URL must start with rtsp:// or be a camera index (digit)")
        if not v.isdigit():
            v = re.sub(r'(://[^@/]*@)?([^/:]+):(/)', r'\1\2:554\3', v)
        return v


class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    password: Optional[str] = None
    stream_path: Optional[str] = None
    transport: Optional[str] = None
    rtsp_url: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    location: Optional[str] = None
    is_online: Optional[bool] = None
    is_recording: Optional[bool] = None
    extra_config: Optional[dict[str, Any]] = None
    bank_id: Optional[int] = None
    assigned_user_id: Optional[int] = None
    assigned_user_2_id: Optional[int] = None
    whatsapp_number_1: Optional[str] = None
    whatsapp_number_2: Optional[str] = None
    enable_email: Optional[bool] = None
    enable_whatsapp: Optional[bool] = None

    model_config = {"extra": "ignore"}

    @field_validator("transport")
    @classmethod
    def validate_transport(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if v not in ("tcp", "udp", "http"):
            raise ValueError("Transport must be tcp, udp, or http")
        return v

    @field_validator("rtsp_url")
    @classmethod
    def validate_rtsp_url(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return v
        if not v.startswith("rtsp://") and not v.isdigit():
            raise ValueError("RTSP URL must start with rtsp:// or be a camera index (digit)")
        # Auto-fix genuinely empty ports only
        if not v.isdigit():
            v = re.sub(r'(://[^@/]*@)?([^/:]+):(/)', r'\1\2:554\3', v)
        return v


class DeviceAssign(BaseModel):
    user_id: int


class DeviceOut(BaseModel):
    id: int
    name: str
    device_type: str
    host: Optional[str] = None
    port: int = 554
    username: Optional[str] = None
    stream_path: str = "/stream1"
    transport: str = "tcp"
    rtsp_url: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    firmware_version: Optional[str] = None
    location: Optional[str] = None
    latitude: Optional[str] = None
    longitude: Optional[str] = None
    is_online: bool
    is_recording: bool
    last_seen: Optional[datetime.datetime] = None
    extra_config: Optional[dict[str, Any]] = None
    owner_id: Optional[int] = None
    bank_id: Optional[int] = None
    assigned_user_id: Optional[int] = None
    assigned_user_2_id: Optional[int] = None
    whatsapp_number_1: Optional[str] = None
    whatsapp_number_2: Optional[str] = None
    enable_email: bool = True
    enable_whatsapp: bool = True
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class DeviceStreamOut(BaseModel):
    device_id: int
    name: str
    rtsp_url: str
    mjpeg_url: str
