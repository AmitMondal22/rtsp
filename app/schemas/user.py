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
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    is_active: bool = True

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
    email: Optional[str] = None
    username: Optional[str] = None
    password: str

    @property
    def identifier(self) -> str:
        return (self.email or self.username or "").strip()


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    whatsapp_number: Optional[str] = None
    is_active: bool = True
    role: str
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    bank_name: Optional[str] = None
    branch_name: Optional[str] = None
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    whatsapp_number: Optional[str] = None
    role: Optional[str] = None
    bank_id: Optional[int] = None
    branch_id: Optional[int] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None



class UserDeviceOut(BaseModel):
    """Minimal user info for device assignment."""
    id: int
    username: str
    email: str
    whatsapp_number: Optional[str] = None

    model_config = {"from_attributes": True}
