import datetime
from pydantic import BaseModel
from typing import Optional, Any


class ThreadMessageCreate(BaseModel):
    content: str
    message_type: str = "text"
    payload: Optional[dict[str, Any]] = None


class ThreadMessageOut(BaseModel):
    id: int
    device_id: int
    sender_id: int
    sender_username: str = ""
    content: str
    message_type: str = "text"
    payload: Optional[dict[str, Any]] = None
    created_at: datetime.datetime

    model_config = {"from_attributes": True}

