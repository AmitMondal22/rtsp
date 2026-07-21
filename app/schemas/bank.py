from typing import Optional
from pydantic import BaseModel
from datetime import datetime

class BankBase(BaseModel):
    name: str

class BankCreate(BankBase):
    pass

class BankUpdate(BaseModel):
    name: Optional[str] = None

class BankOut(BankBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True

class BankAdminCreate(BaseModel):
    bank_name: str
    username: str
    email: str
    password: str
