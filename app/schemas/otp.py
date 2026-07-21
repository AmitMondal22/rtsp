import datetime
from typing import Optional
from pydantic import BaseModel, field_validator


class OTPGenerateOut(BaseModel):
    otp_id: int
    code: str
    expires_at: datetime.datetime
    message: str
    email_sent: bool = False


class OTPVerifyIn(BaseModel):
    code: str

    @field_validator("code")
    @classmethod
    def validate_otp(cls, v: str) -> str:
        if len(v) not in (4, 6) or not v.isdigit():
            raise ValueError("OTP must be 4 or 6 digits")
        return v


class OTPVerifyOut(BaseModel):
    success: bool
    message: str


class CameraActionRequest(BaseModel):
    mode: str = "thread"
    user_id_1: Optional[int] = None
    user_id_2: Optional[int] = None

