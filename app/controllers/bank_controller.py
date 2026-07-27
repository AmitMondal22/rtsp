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
    return delete_bank_service(db, bank_id)

# ── Branch Endpoints ──
@router.post("/branches", response_model=BranchOut)
def create_branch(
    data: BranchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "admin", "bank_admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can create branches")
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
    return update_branch_service(db, branch_id, data)

@router.delete("/branches/{branch_id}")
def delete_branch(
    branch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "admin", "bank_admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can delete branches")
    return delete_branch_service(db, branch_id)

# ── User Endpoints ──
@router.post("/users", response_model=UserOut)
def create_bank_user(
    data: BankUserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "admin", "bank_admin"]:
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
    if current_user.role not in ["super_admin", "admin", "bank_admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can update users")
    return update_bank_user_service(db, user_id, data)

@router.delete("/users/{user_id}")
def delete_bank_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "admin", "bank_admin"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can delete users")
    return delete_bank_user_service(db, user_id)

