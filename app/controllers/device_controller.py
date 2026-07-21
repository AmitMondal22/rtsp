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


def check_device_access(device: Device, user: User):
    if user.role == "super_admin":
        return
    if user.role == "bank_admin" and device.bank_id == user.bank_id:
        return
    if user.role == "user" and (device.assigned_user_id == user.id or device.bank_id == user.bank_id):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


def check_device_admin_access(device: Device, user: User):
    if user.role == "super_admin":
        return
    if user.role == "bank_admin" and device.bank_id == user.bank_id:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


@router.post("/", response_model=DeviceOut)
def create_device(
    device: DeviceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "bank_admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can create devices",
        )
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
    if current_user.role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Access denied"
        )
    return db.query(Device).all()


@router.get("/{device_id}", response_model=DeviceOut)
def get_device(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = get_device_by_id(db, device_id)
    check_device_access(device, current_user)
    return device


@router.put("/{device_id}", response_model=DeviceOut)
def update_device(
    device_id: int,
    device_update: DeviceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = get_device_by_id(db, device_id)
    check_device_admin_access(device, current_user)
    return update_device_service(db, device_id, device_update)


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_device(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = get_device_by_id(db, device_id)
    check_device_admin_access(device, current_user)
    delete_device_service(db, device_id)


@router.post("/{device_id}/assign", response_model=DeviceOut)
def assign_device(
    device_id: int,
    assignment: DeviceAssign,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = get_device_by_id(db, device_id)
    check_device_admin_access(device, current_user)
    # Check if target user is in same bank (unless super_admin)
    target_user = db.query(User).filter(User.id == assignment.user_id).first()
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found"
        )
    if current_user.role != "super_admin" and target_user.bank_id != current_user.bank_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot assign device to a user in a different bank",
        )
    return assign_device_service(db, device_id, assignment.user_id)


@router.post("/{device_id}/unassign", response_model=DeviceOut)
def unassign_device(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = get_device_by_id(db, device_id)
    check_device_admin_access(device, current_user)
    device.assigned_user_id = None
    db.commit()
    db.refresh(device)
    return device
