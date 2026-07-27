import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship
from app.database import Base


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    device_type = Column(String(50), default="rtsp")  # rtsp connection

    # RTSP / connection configuration
    rtsp_url = Column(String(500), nullable=True)
    host = Column(String(100), nullable=True)
    port = Column(Integer, default=554)
    username = Column(String(100), nullable=True)
    password = Column(String(100), nullable=True)
    stream_path = Column(String(200), default="/stream1")
    transport = Column(String(20), default="tcp")  # tcp, udp, http

    # Camera metadata
    manufacturer = Column(String(100), nullable=True)
    model = Column(String(100), nullable=True)
    firmware_version = Column(String(50), nullable=True)

    # Location
    location = Column(String(200), nullable=True)
    latitude = Column(String(20), nullable=True)
    longitude = Column(String(20), nullable=True)

    # Status
    is_online = Column(Boolean, default=False)
    is_recording = Column(Boolean, default=False)
    last_seen = Column(DateTime, nullable=True)

    # Extra configuration (JSON for extensibility)
    extra_config = Column(JSON, default=dict)

    # Notification controls & WhatsApp
    enable_email = Column(Boolean, default=True)
    enable_whatsapp = Column(Boolean, default=True)
    whatsapp_number_1 = Column(String(20), nullable=True)
    whatsapp_number_2 = Column(String(20), nullable=True)

    # Owner / assignment
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    bank_id = Column(Integer, ForeignKey("banks.id"), nullable=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    assigned_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    assigned_user_2_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    owner = relationship("User", back_populates="devices", foreign_keys=[owner_id])
    bank = relationship("Bank", back_populates="devices")
    branch = relationship("Branch", back_populates="devices")
    assigned_user = relationship("User", foreign_keys=[assigned_user_id])
    assigned_user_2 = relationship("User", foreign_keys=[assigned_user_2_id])
    messages = relationship("ThreadMessage", back_populates="device")
    otp_codes = relationship("OTPCode", back_populates="device")

