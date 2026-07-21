import datetime
from pydantic import BaseModel, field_validator
from typing import Optional


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserCreate(BaseModel):
    username: str
    email: str
    password: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Password must be at least 6 characters")
        return v

    @field_validator("username")
    @classmethod
    def username_valid(cls, v: str) -> str:
        if len(v) < 3:
            raise ValueError("Username must be at least 3 characters")
        return v


class BankUserCreate(BaseModel):
    username: str
    email: str
    password: str
    whatsapp_number: Optional[str] = None
    role: Optional[str] = "user"

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("Password must be at least 6 characters")
        return v

    @field_validator("username")
    @classmethod
    def username_valid(cls, v: str) -> str:
        if len(v) < 3:
            raise ValueError("Username must be at least 3 characters")
        return v


class UserLogin(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    whatsapp_number: Optional[str] = None
    is_active: bool
    role: str
    bank_id: Optional[int] = None
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    whatsapp_number: Optional[str] = None
    role: Optional[str] = None
    bank_id: Optional[int] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None


class UserDeviceOut(BaseModel):
    """Minimal user info for device assignment."""
    id: int
    username: str
    email: str
    whatsapp_number: Optional[str] = None

    model_config = {"from_attributes": True}
