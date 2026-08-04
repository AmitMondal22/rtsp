import datetime
from pydantic import BaseModel, field_validator
from typing import Optional, Any


class DeviceCreate(BaseModel):
    name: str
    device_type: str = "rtsp"
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
    branch_id: Optional[int] = None
    assigned_user_id: Optional[int] = None
    assigned_user_2_id: Optional[int] = None
    whatsapp_number_1: Optional[str] = None
    whatsapp_number_2: Optional[str] = None
    enable_email: bool = True
    enable_whatsapp: bool = True

    model_config = {"extra": "ignore"}

    @field_validator("rtsp_url")
    @classmethod
    def validate_rtsp_url(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return v
        from app.services.device_service import sanitize_rtsp_url
        return sanitize_rtsp_url(v)


class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    rtsp_url: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    location: Optional[str] = None
    is_online: Optional[bool] = None
    is_recording: Optional[bool] = None
    extra_config: Optional[dict[str, Any]] = None
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    assigned_user_id: Optional[int] = None
    assigned_user_2_id: Optional[int] = None
    whatsapp_number_1: Optional[str] = None
    whatsapp_number_2: Optional[str] = None
    enable_email: Optional[bool] = None
    enable_whatsapp: Optional[bool] = None

    model_config = {"extra": "ignore"}

    @field_validator("rtsp_url")
    @classmethod
    def validate_rtsp_url(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return v
        from app.services.device_service import sanitize_rtsp_url
        return sanitize_rtsp_url(v)


class DeviceAssign(BaseModel):
    user_id: int


class DeviceOut(BaseModel):
    id: int
    name: str
    device_type: str
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
    branch_id: Optional[int] = None
    bank_name: Optional[str] = None
    branch_name: Optional[str] = None
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

