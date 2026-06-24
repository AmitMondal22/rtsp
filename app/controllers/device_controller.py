from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.models.device import Device
from app.schemas.device import DeviceCreate, DeviceUpdate, DeviceAssign, DeviceOut
from app.services.auth_service import get_current_user
from app.services.device_service import (
    create_device_service,
    get_user_devices,
    get_device_by_id,
    update_device_service,
    delete_device_service,
    assign_device_service,
)

router = APIRouter(prefix="/api/devices", tags=["Devices"])


@router.post("/", response_model=DeviceOut)
def create_device(
    device: DeviceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return create_device_service(db, device, current_user)


@router.get("/", response_model=list[DeviceOut])
def list_devices(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return get_user_devices(db, current_user)


@router.get("/all", response_model=list[DeviceOut])
def list_all_devices(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all devices (admin view)."""
    return db.query(Device).all()


@router.get("/{device_id}", response_model=DeviceOut)
def get_device(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = get_device_by_id(db, device_id)
    if device.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return device


@router.put("/{device_id}", response_model=DeviceOut)
def update_device(
    device_id: int,
    device_update: DeviceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = get_device_by_id(db, device_id)
    if device.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return update_device_service(db, device_id, device_update)


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_device(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = get_device_by_id(db, device_id)
    if device.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    delete_device_service(db, device_id)


@router.post("/{device_id}/assign", response_model=DeviceOut)
def assign_device(
    device_id: int,
    assignment: DeviceAssign,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = get_device_by_id(db, device_id)
    if device.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    return assign_device_service(db, device_id, assignment.user_id)


@router.post("/{device_id}/unassign", response_model=DeviceOut)
def unassign_device(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = get_device_by_id(db, device_id)
    if device.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    device.owner_id = None
    db.commit()
    db.refresh(device)
    return device
