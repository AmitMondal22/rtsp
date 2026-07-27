import datetime
from pydantic import BaseModel
from typing import Optional


class BranchBase(BaseModel):
    name: str
    bank_id: int
    is_active: bool = True
    user1_id: Optional[int] = None
    user2_id: Optional[int] = None
    user3_id: Optional[int] = None
    otp1_user_id: Optional[int] = None
    otp2_user_id: Optional[int] = None
    enable_otp1: bool = True
    enable_otp2: bool = True

    # Direct 3 User Creation Fields
    user1_username: Optional[str] = None
    user1_email: Optional[str] = None
    user1_password: Optional[str] = None
    user1_whatsapp: Optional[str] = None
    user1_active: Optional[bool] = True
    user1_otp_role: Optional[str] = "otp1"

    user2_username: Optional[str] = None
    user2_email: Optional[str] = None
    user2_password: Optional[str] = None
    user2_whatsapp: Optional[str] = None
    user2_active: Optional[bool] = True
    user2_otp_role: Optional[str] = "otp2"

    user3_username: Optional[str] = None
    user3_email: Optional[str] = None
    user3_password: Optional[str] = None
    user3_whatsapp: Optional[str] = None
    user3_active: Optional[bool] = True
    user3_otp_role: Optional[str] = "none"


class BranchCreate(BranchBase):
    pass


class BranchUpdate(BaseModel):
    name: Optional[str] = None
    bank_id: Optional[int] = None
    is_active: Optional[bool] = None
    user1_id: Optional[int] = None
    user2_id: Optional[int] = None
    user3_id: Optional[int] = None
    otp1_user_id: Optional[int] = None
    otp2_user_id: Optional[int] = None
    enable_otp1: Optional[bool] = None
    enable_otp2: Optional[bool] = None

    user1_username: Optional[str] = None
    user1_email: Optional[str] = None
    user1_password: Optional[str] = None
    user1_whatsapp: Optional[str] = None
    user1_active: Optional[bool] = None
    user1_otp_role: Optional[str] = None

    user2_username: Optional[str] = None
    user2_email: Optional[str] = None
    user2_password: Optional[str] = None
    user2_whatsapp: Optional[str] = None
    user2_active: Optional[bool] = None
    user2_otp_role: Optional[str] = None

    user3_username: Optional[str] = None
    user3_email: Optional[str] = None
    user3_password: Optional[str] = None
    user3_whatsapp: Optional[str] = None
    user3_active: Optional[bool] = None
    user3_otp_role: Optional[str] = None


class BranchOut(BranchBase):
    id: int
    bank_name: Optional[str] = None
    user1_name: Optional[str] = None
    user1_email: Optional[str] = None
    user1_whatsapp: Optional[str] = None
    user1_active: Optional[bool] = True
    user1_otp_role: Optional[str] = "otp1"
    user2_name: Optional[str] = None
    user2_email: Optional[str] = None
    user2_whatsapp: Optional[str] = None
    user2_active: Optional[bool] = True
    user2_otp_role: Optional[str] = "otp2"
    user3_name: Optional[str] = None
    user3_email: Optional[str] = None
    user3_whatsapp: Optional[str] = None
    user3_active: Optional[bool] = True
    user3_otp_role: Optional[str] = "none"
    otp1_user_name: Optional[str] = None
    otp2_user_name: Optional[str] = None
    enable_otp1: Optional[bool] = True
    enable_otp2: Optional[bool] = True
    created_at: datetime.datetime

    model_config = {"from_attributes": True}

