from typing import Optional
from pydantic import BaseModel
from datetime import datetime

class BankBase(BaseModel):
    name: str

class BankCreate(BankBase):
    pass

class BankUpdate(BaseModel):
    name: Optional[str] = None
    username: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None

class BankOut(BankBase):
    id: int
    admin_user_id: Optional[int] = None
    admin_username: Optional[str] = None
    admin_email: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class BankAdminCreate(BaseModel):
    bank_name: str
    username: str
    email: str
    password: str
