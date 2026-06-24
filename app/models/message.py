import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship
from app.database import Base


class ThreadMessage(Base):
    __tablename__ = "thread_messages"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    message_type = Column(String(20), default="text")  # text, command, alert
    payload = Column(JSON, nullable=True)  # Extra JSON data payload
    is_mqtt_published = Column(Boolean, default=True)  # False for "No Thread" messages
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    device = relationship("Device", back_populates="messages")
    sender = relationship("User", back_populates="messages")
