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


class UserLogin(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    email: str
    is_active: bool
    role: str
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    email: Optional[str] = None
    is_active: Optional[bool] = None


class UserDeviceOut(BaseModel):
    """Minimal user info for device assignment."""
    id: int
    username: str
    email: str

    model_config = {"from_attributes": True}
