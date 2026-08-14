from typing import List, Optional
from pydantic import BaseModel


class BulkOTPUpdate(BaseModel):
    device_id: int
    otps: List[str]
    publish_mqtt: bool = True


class BulkOTPOut(BaseModel):
    device_id: int
    otps: List[str]
    updated_at: Optional[str] = None
