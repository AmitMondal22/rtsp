from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.bank import Bank
from app.schemas.bank import BankOut, BankAdminCreate, BankUpdate
from app.schemas.user import UserOut, BankUserCreate, UserUpdate
from app.services.auth_service import get_current_user
from app.services.bank_service import (
    create_bank_and_admin_service,
    create_bank_user_service,
    get_bank_users_service,
    update_bank_service,
    delete_bank_service,
    update_bank_user_service,
    delete_bank_user_service,
)

router = APIRouter(prefix="/api/banks", tags=["Banks"])

@router.post("/", response_model=BankOut)
def create_bank(
    data: BankAdminCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only super_admin can create banks")
    return create_bank_and_admin_service(db, data)

@router.get("/", response_model=list[BankOut])
def list_banks(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(Bank).all()

@router.put("/{bank_id}", response_model=BankOut)
def update_bank(
    bank_id: int,
    data: BankUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only super_admin can edit banks")
    return update_bank_service(db, bank_id, data)

@router.delete("/{bank_id}")
def delete_bank(
    bank_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only super_admin can delete banks")
    return delete_bank_service(db, bank_id)

@router.post("/users", response_model=UserOut)
def create_bank_user(
    data: BankUserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "bank_admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can create users")
    return create_bank_user_service(db, data, current_user)

@router.get("/users", response_model=list[UserOut])
def list_bank_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return get_bank_users_service(db, current_user)

@router.put("/users/{user_id}", response_model=UserOut)
def update_bank_user(
    user_id: int,
    data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "bank_admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can update users")
    return update_bank_user_service(db, user_id, data)

@router.delete("/users/{user_id}")
def delete_bank_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "bank_admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can delete users")
    return delete_bank_user_service(db, user_id)
