from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.device import Device
from app.models.otp_bulk import DeviceOfflineOTP
from app.schemas.otp_schema import BulkOTPUpdate, BulkOTPOut
from app.services.mqtt_service import publish_bulk_otp_to_device
from app.controllers.auth_controller import get_current_user

router = APIRouter(prefix="/api/otp", tags=["Offline OTP Management"])


@router.get("/device/{device_id}", response_model=BulkOTPOut)
def get_device_offline_otps(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    records = db.query(DeviceOfflineOTP).filter(DeviceOfflineOTP.device_id == device_id).order_by(DeviceOfflineOTP.slot_number.asc()).all()
    
    # Map slot_number (1..100) -> otp_code
    otp_map = {r.slot_number: (r.otp_code or "") for r in records}
    otps = [otp_map.get(i, "") for i in range(1, 101)]

    last_updated = None
    if records:
        latest_rec = max(records, key=lambda r: r.updated_at if r.updated_at else 0)
        last_updated = latest_rec.updated_at.isoformat() if latest_rec.updated_at else None

    return BulkOTPOut(device_id=device_id, otps=otps, updated_at=last_updated)


@router.post("/device/{device_id}", response_model=Dict[str, Any])
def save_device_offline_otps(
    device_id: int,
    payload: BulkOTPUpdate,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    otps = payload.otps
    if len(otps) < 100:
        otps = otps + [""] * (100 - len(otps))
    otps = otps[:100]

    existing = {r.slot_number: r for r in db.query(DeviceOfflineOTP).filter(DeviceOfflineOTP.device_id == device_id).all()}

    for i in range(1, 101):
        code_val = str(otps[i - 1]).strip()
        if i in existing:
            existing[i].otp_code = code_val
        else:
            new_rec = DeviceOfflineOTP(device_id=device_id, slot_number=i, otp_code=code_val, status="active")
            db.add(new_rec)

    db.commit()

    mqtt_sent = False
    if payload.publish_mqtt:
        # Publish to /OTP/{device_id}
        mqtt_sent = publish_bulk_otp_to_device(str(device_id), otps)
        # Also publish to /OTP/{device_name} if name is different
        if device.name and device.name != str(device_id):
            publish_bulk_otp_to_device(device.name, otps)

    return {
        "status": "success",
        "message": f"Saved 100 OTPs for device {device.name}",
        "device_id": device_id,
        "mqtt_published": mqtt_sent,
        "topic": f"/OTP/{device_id}"
    }


@router.post("/device/{device_id}/publish", response_model=Dict[str, Any])
def publish_device_offline_otps(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: Any = Depends(get_current_user),
):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    records = db.query(DeviceOfflineOTP).filter(DeviceOfflineOTP.device_id == device_id).order_by(DeviceOfflineOTP.slot_number.asc()).all()
    otp_map = {r.slot_number: (r.otp_code or "") for r in records}
    otps = [otp_map.get(i, "") for i in range(1, 101)]

    mqtt_sent = publish_bulk_otp_to_device(str(device_id), otps)
    if device.name and device.name != str(device_id):
        publish_bulk_otp_to_device(device.name, otps)

    return {
        "status": "success",
        "message": f"Published 100 OTPs to MQTT for device {device.name}",
        "device_id": device_id,
        "mqtt_published": mqtt_sent,
        "topic": f"/OTP/{device_id}"
    }
