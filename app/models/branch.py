import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base


class Branch(Base):
    __tablename__ = "branches"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    bank_id = Column(Integer, ForeignKey("banks.id"), nullable=False)
    is_active = Column(Boolean, default=True)

    # 3 assigned users for the branch
    user1_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user2_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user3_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # 1st OTP & 2nd OTP assigned users & enable toggles
    otp1_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    otp2_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    enable_otp1 = Column(Boolean, default=True)
    enable_otp2 = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    # Relationships
    bank = relationship("Bank", back_populates="branches")
    user1 = relationship("User", foreign_keys=[user1_id])
    user2 = relationship("User", foreign_keys=[user2_id])
    user3 = relationship("User", foreign_keys=[user3_id])
    otp1_user = relationship("User", foreign_keys=[otp1_user_id])
    otp2_user = relationship("User", foreign_keys=[otp2_user_id])
    devices = relationship("Device", back_populates="branch")
    users = relationship("User", back_populates="branch", foreign_keys="[User.branch_id]")
