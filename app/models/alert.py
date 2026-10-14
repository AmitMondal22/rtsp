from app.utils.timezone import get_ist_now
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from app.database import Base


class SecurityAlert(Base):
    __tablename__ = "security_alerts"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    is_simulated = Column(Boolean, default=True)
    severity = Column(String(50), default="Medium")  # Critical, High, Medium, Low
    alert_type = Column(String(100), default="Security Alert")  # Invalid Otp, Door Held Open, Device Offline, etc.
    device_name = Column(String(100), nullable=True)
    camera_name = Column(String(100), nullable=True)
    status = Column(String(50), default="Open")  # Open, In Progress, Resolved
    handled_by = Column(String(100), default="—")
    created_at = Column(DateTime, default=get_ist_now)
    resolved_at = Column(DateTime, nullable=True)
    details = Column(Text, nullable=True)
