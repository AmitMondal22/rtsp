from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.utils.timezone import get_ist_now
from app.database import Base


class DeviceOfflineOTP(Base):
    __tablename__ = "device_offline_otps"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False)
    slot_number = Column(Integer, nullable=False)  # 1 to 100
    otp_code = Column(String(20), nullable=True, default="")
    status = Column(String(20), default="active")
    updated_at = Column(DateTime, default=get_ist_now, onupdate=get_ist_now)

    device = relationship("Device", back_populates="offline_otps")
