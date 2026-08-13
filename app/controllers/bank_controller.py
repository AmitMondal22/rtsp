from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.bank import Bank
from app.schemas.bank import BankOut, BankAdminCreate, BankUpdate
from app.schemas.branch import BranchOut, BranchCreate, BranchUpdate
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
    create_branch_service,
    get_branches_service,
    update_branch_service,
    delete_branch_service,
    check_email_availability_service,
    format_bank_out,
)

router = APIRouter(prefix="/api/banks", tags=["Banks"])

@router.post("/", response_model=BankOut)
def create_bank(
    data: BankAdminCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can create banks")
    bank = create_bank_and_admin_service(db, data)
    return format_bank_out(db, bank)

@router.get("/", response_model=list[BankOut])
def list_banks(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role in ["super_admin", "admin"]:
        banks = db.query(Bank).all()
    elif current_user.bank_id:
        banks = db.query(Bank).filter(Bank.id == current_user.bank_id).all()
    else:
        banks = []
    return [format_bank_out(db, b) for b in banks]

@router.put("/{bank_id}", response_model=BankOut)
def update_bank(
    bank_id: int,
    data: BankUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can edit banks")
    return update_bank_service(db, bank_id, data)

@router.delete("/{bank_id}")
def delete_bank(
    bank_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can delete banks")
    return delete_bank_service(db, bank_id, current_user=current_user)

# ── Branch Endpoints ──
@router.post("/branches", response_model=BranchOut)
def create_branch(
    data: BranchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "admin", "bank_admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can create branches")
    if current_user.role == "bank_admin":
        data.bank_id = current_user.bank_id
    return create_branch_service(db, data)

@router.get("/branches", response_model=list[BranchOut])
def list_branches(
    bank_id: int = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return get_branches_service(db, current_user, bank_id=bank_id)

@router.get("/{bank_id}/branches", response_model=list[BranchOut])
def list_bank_branches(
    bank_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == "bank_admin" and current_user.bank_id != bank_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to access branches of other banks")
    return get_branches_service(db, current_user, bank_id=bank_id)

@router.put("/branches/{branch_id}", response_model=BranchOut)
def update_branch(
    branch_id: int,
    data: BranchUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "admin", "bank_admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can update branches")
    if current_user.role == "bank_admin":
        data.bank_id = current_user.bank_id
    return update_branch_service(db, branch_id, data)

@router.delete("/branches/{branch_id}")
def delete_branch(
    branch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "admin", "bank_admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can delete branches")
    return delete_branch_service(db, branch_id, current_user=current_user)

# ── User Endpoints ──
@router.post("/users", response_model=UserOut)
def create_bank_user(
    data: BankUserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "admin", "bank_admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can create users")
    if current_user.role == "bank_admin":
        data.bank_id = current_user.bank_id
        if data.role in ["super_admin", "admin"]:
            data.role = "user"
    return create_bank_user_service(db, data, current_user)

@router.get("/users", response_model=list[UserOut])
def list_bank_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "admin", "bank_admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can view users")
    return get_bank_users_service(db, current_user)

@router.put("/users/{user_id}", response_model=UserOut)
def update_bank_user(
    user_id: int,
    data: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "admin", "bank_admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can update users")
    if current_user.role == "bank_admin":
        data.bank_id = current_user.bank_id
        if data.role in ["super_admin", "admin"]:
            data.role = "user"
    return update_bank_user_service(db, user_id, data, current_user=current_user)

@router.delete("/users/{user_id}")
def delete_bank_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "admin", "bank_admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can delete users")
    return delete_bank_user_service(db, user_id, current_user=current_user)


from typing import Optional

@router.get("/check-email")
def check_email_availability(
    email: str,
    exclude_user_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return check_email_availability_service(db, email, exclude_user_id=exclude_user_id)


