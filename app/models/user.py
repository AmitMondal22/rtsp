import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, index=True, nullable=False)
    email = Column(String(100), index=True, nullable=False)
    whatsapp_number = Column(String(20), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    role = Column(String(20), default="user")  # super_admin, admin, bank_admin, user
    bank_id = Column(Integer, ForeignKey("banks.id"), nullable=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    bank = relationship("Bank", back_populates="users")
    branch = relationship("Branch", back_populates="users", foreign_keys=[branch_id])
    devices = relationship("Device", back_populates="owner", foreign_keys="[Device.owner_id]")
    messages = relationship("ThreadMessage", back_populates="sender")
    otp_codes = relationship("OTPCode", back_populates="user")

