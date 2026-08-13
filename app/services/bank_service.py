from typing import Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from app.models.bank import Bank
from app.models.branch import Branch
from app.models.user import User
from app.schemas.bank import BankAdminCreate
from app.schemas.branch import BranchCreate, BranchUpdate
from app.schemas.user import BankUserCreate
from app.services.auth_service import hash_password

def create_bank_and_admin_service(db: Session, data: BankAdminCreate) -> Bank:
    # Check if bank exists
    existing_bank = db.query(Bank).filter(Bank.name == data.bank_name).first()
    if existing_bank:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bank name already exists")
    
    # Check if user email exists
    from sqlalchemy import func
    existing_user = db.query(User).filter(func.lower(User.email) == data.email.strip().lower()).first()
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email address already registered")

    # Create Bank
    new_bank = Bank(name=data.bank_name)
    db.add(new_bank)
    db.commit()
    db.refresh(new_bank)

    # Create Bank Admin User
    admin_user = User(
        username=data.username,
        email=data.email,
        hashed_password=hash_password(data.password),
        role="bank_admin",
        bank_id=new_bank.id
    )
    db.add(admin_user)
    db.commit()
    
    return new_bank

def create_bank_user_service(db: Session, data: BankUserCreate, current_user: User) -> User:
    bank_id = getattr(data, "bank_id", None) or current_user.bank_id
    if not bank_id and current_user.role not in ["super_admin", "admin"]:
        first_bank = db.query(Bank).first()
        if not first_bank:
            first_bank = Bank(name="Default Bank")
            db.add(first_bank)
            db.commit()
            db.refresh(first_bank)
        bank_id = first_bank.id

    from sqlalchemy import func
    existing_user = db.query(User).filter(func.lower(User.email) == data.email.strip().lower()).first()
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email address already registered")

    target_role = getattr(data, "role", None) or "user"
    branch_id = getattr(data, "branch_id", None)
    is_active = getattr(data, "is_active", True)
    new_user = User(
        username=data.username,
        email=data.email,
        whatsapp_number=getattr(data, "whatsapp_number", None),
        hashed_password=hash_password(data.password),
        role=target_role,
        bank_id=bank_id,
        branch_id=branch_id,
        is_active=is_active if is_active is not None else True
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

def format_user_out(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "whatsapp_number": user.whatsapp_number,
        "is_active": user.is_active if user.is_active is not None else True,
        "role": user.role,
        "bank_id": user.bank_id,
        "branch_id": user.branch_id,
        "bank_name": user.bank.name if user.bank else None,
        "branch_name": user.branch.name if user.branch else None,
        "created_at": user.created_at,
    }

def get_bank_users_service(db: Session, current_user: User) -> list[dict]:
    if current_user.role in ("super_admin", "admin") or not current_user.bank_id:
        users = db.query(User).all()
    else:
        users = db.query(User).filter(User.bank_id == current_user.bank_id).all()
    return [format_user_out(u) for u in users]

def format_bank_out(db: Session, bank: Bank) -> dict:
    admin_user = db.query(User).filter(User.bank_id == bank.id, User.role == "bank_admin").first()
    return {
        "id": bank.id,
        "name": bank.name,
        "admin_user_id": admin_user.id if admin_user else None,
        "admin_username": admin_user.username if admin_user else None,
        "admin_email": admin_user.email if admin_user else None,
        "created_at": bank.created_at,
    }


def update_bank_service(db: Session, bank_id: int, data) -> dict:
    bank = db.query(Bank).filter(Bank.id == bank_id).first()
    if not bank:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bank not found")

    if getattr(data, "name", None):
        bank.name = data.name.strip()

    admin_user = db.query(User).filter(User.bank_id == bank_id, User.role == "bank_admin").first()
    if admin_user:
        if getattr(data, "username", None) and data.username.strip():
            admin_user.username = data.username.strip()

        if getattr(data, "email", None) and data.email.strip():
            clean_email = data.email.strip().lower()
            if clean_email != admin_user.email.lower():
                from sqlalchemy import func
                existing = db.query(User).filter(func.lower(User.email) == clean_email, User.id != admin_user.id).first()
                if existing:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Email address '{clean_email}' is already registered to another user")
                admin_user.email = clean_email

        if getattr(data, "password", None) and data.password.strip():
            admin_user.hashed_password = hash_password(data.password.strip())
    else:
        # Create bank admin user if not present
        if getattr(data, "username", None) or getattr(data, "email", None):
            clean_email = (data.email or f"admin_{bank_id}@bank.com").strip().lower()
            from sqlalchemy import func
            existing = db.query(User).filter(func.lower(User.email) == clean_email).first()
            if existing:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Email address '{clean_email}' is already registered to another user")
            pwd = data.password.strip() if getattr(data, "password", None) and data.password.strip() else "admin123"
            new_admin = User(
                username=data.username.strip() if getattr(data, "username", None) else f"admin_{bank.name.lower().replace(' ', '')}",
                email=clean_email,
                hashed_password=hash_password(pwd),
                role="bank_admin",
                bank_id=bank.id,
                is_active=True
            )
            db.add(new_admin)

    db.commit()
    db.refresh(bank)
    return format_bank_out(db, bank)


def delete_bank_service(db: Session, bank_id: int, current_user: Optional[User] = None):
    bank = db.query(Bank).filter(Bank.id == bank_id).first()
    if not bank:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bank not found")

    from app.models.device import Device
    from app.models.user import User

    # 1. Collect all users associated with this bank (bank admin user + branch users)
    bank_users = db.query(User).filter(User.bank_id == bank_id).all()
    user_ids_to_delete = [u.id for u in bank_users]

    # 2. Delete all branches belonging to this bank
    branches = db.query(Branch).filter(Branch.bank_id == bank_id).all()
    for branch in branches:
        try:
            delete_branch_service(db, branch.id, current_user=current_user)
        except Exception:
            pass

    # 3. Unlink any devices assigned to this bank
    db.query(Device).filter(Device.bank_id == bank_id).update({Device.bank_id: None, Device.branch_id: None}, synchronize_session=False)

    # 4. Delete the Bank record
    db.delete(bank)
    db.commit()

    # 5. Delete all users belonging to this bank (including the Bank Admin user!)
    for uid in user_ids_to_delete:
        if current_user and current_user.id == uid:
            continue
        try:
            delete_bank_user_service(db, uid, current_user=None)
        except Exception:
            pass

    return {"message": "Bank and associated bank admin user deleted successfully"}

def check_email_availability_service(db: Session, email: str, exclude_user_id: Optional[int] = None) -> dict:
    clean_email = email.strip().lower()
    if not clean_email or "@" not in clean_email:
        return {"available": True, "message": "Email is incomplete"}

    from sqlalchemy import func
    query = db.query(User).filter(func.lower(User.email) == clean_email)
    if exclude_user_id:
        query = query.filter(User.id != exclude_user_id)

    existing = query.first()
    if existing:
        return {"available": False, "message": f"Email '{clean_email}' is already registered"}
    return {"available": True, "message": f"Email '{clean_email}' is available"}


def update_bank_user_service(db: Session, user_id: int, data, current_user: Optional[User] = None) -> dict:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if current_user and current_user.role == "bank_admin" and current_user.bank_id != user.bank_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to edit users outside your bank")
    from sqlalchemy import func
    if data.username is not None:
        user.username = data.username.strip()
    if data.email is not None and data.email.strip().lower() != user.email.lower():
        existing = db.query(User).filter(func.lower(User.email) == data.email.strip().lower(), User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email address already registered to another user")
        user.email = data.email.strip().lower()
    if data.whatsapp_number is not None:
        user.whatsapp_number = data.whatsapp_number
    if data.role is not None:
        user.role = data.role
    if data.bank_id is not None:
        if data.bank_id and not db.query(Bank).filter(Bank.id == data.bank_id).first():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bank not found")
        user.bank_id = data.bank_id
    if getattr(data, "branch_id", None) is not None:
        if data.branch_id and not db.query(Branch).filter(Branch.id == data.branch_id).first():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")
        user.branch_id = data.branch_id
    if data.password:
        user.hashed_password = hash_password(data.password)
    if data.is_active is not None:
        user.is_active = data.is_active

    db.commit()
    db.refresh(user)
    return format_user_out(user)

def delete_bank_user_service(db: Session, user_id: int, current_user: Optional[User] = None):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    if current_user:
        if current_user.id == user_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot delete your own user account")
        if current_user.role == "bank_admin" and current_user.bank_id != user.bank_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to delete users outside your bank")

    from app.models.device import Device
    from app.models.message import ThreadMessage
    from app.models.otp import OTPCode

    # 1. Clear user references in branches
    db.query(Branch).filter(Branch.user1_id == user_id).update({Branch.user1_id: None}, synchronize_session=False)
    db.query(Branch).filter(Branch.user2_id == user_id).update({Branch.user2_id: None}, synchronize_session=False)
    db.query(Branch).filter(Branch.user3_id == user_id).update({Branch.user3_id: None}, synchronize_session=False)
    db.query(Branch).filter(Branch.otp1_user_id == user_id).update({Branch.otp1_user_id: None}, synchronize_session=False)
    db.query(Branch).filter(Branch.otp2_user_id == user_id).update({Branch.otp2_user_id: None}, synchronize_session=False)

    # 2. Clear user references in devices
    db.query(Device).filter(Device.owner_id == user_id).update({Device.owner_id: None}, synchronize_session=False)
    db.query(Device).filter(Device.assigned_user_id == user_id).update({Device.assigned_user_id: None}, synchronize_session=False)
    db.query(Device).filter(Device.assigned_user_2_id == user_id).update({Device.assigned_user_2_id: None}, synchronize_session=False)

    # 3. Clean up messages sent by user and OTP codes assigned to user
    db.query(ThreadMessage).filter(ThreadMessage.sender_id == user_id).delete(synchronize_session=False)
    db.query(OTPCode).filter(OTPCode.user_id == user_id).delete(synchronize_session=False)

    db.delete(user)
    db.commit()
    return {"message": "User deleted successfully"}

# ── Branch Services ──
from app.services.email_service import send_branch_user_email

def format_branch_out(branch: Branch) -> dict:
    u1_role = "otp1"
    u2_role = "otp2"
    u3_role = "none"

    if branch.otp1_user_id and branch.otp1_user_id == branch.user1_id:
        u1_role = "otp1"
    elif branch.otp2_user_id and branch.otp2_user_id == branch.user1_id:
        u1_role = "otp2"
    else:
        u1_role = "none"

    if branch.otp1_user_id and branch.otp1_user_id == branch.user2_id:
        u2_role = "otp1"
    elif branch.otp2_user_id and branch.otp2_user_id == branch.user2_id:
        u2_role = "otp2"
    else:
        u2_role = "none"

    if branch.otp1_user_id and branch.otp1_user_id == branch.user3_id:
        u3_role = "otp1"
    elif branch.otp2_user_id and branch.otp2_user_id == branch.user3_id:
        u3_role = "otp2"
    else:
        u3_role = "none"

    return {
        "id": branch.id,
        "name": branch.name,
        "bank_id": branch.bank_id,
        "is_active": branch.is_active if branch.is_active is not None else True,
        "user1_id": branch.user1_id,
        "user2_id": branch.user2_id,
        "user3_id": branch.user3_id,
        "user1_otp_role": u1_role,
        "user2_otp_role": u2_role,
        "user3_otp_role": u3_role,
        "otp1_user_id": branch.otp1_user_id,
        "otp2_user_id": branch.otp2_user_id,
        "bank_name": branch.bank.name if branch.bank else None,
        "user1_name": branch.user1.username if branch.user1 else None,
        "user1_email": branch.user1.email if branch.user1 else None,
        "user1_whatsapp": branch.user1.whatsapp_number if branch.user1 else None,
        "user1_active": branch.user1.is_active if branch.user1 else True,
        "user2_name": branch.user2.username if branch.user2 else None,
        "user2_email": branch.user2.email if branch.user2 else None,
        "user2_whatsapp": branch.user2.whatsapp_number if branch.user2 else None,
        "user2_active": branch.user2.is_active if branch.user2 else True,
        "user3_name": branch.user3.username if branch.user3 else None,
        "user3_email": branch.user3.email if branch.user3 else None,
        "user3_whatsapp": branch.user3.whatsapp_number if branch.user3 else None,
        "user3_active": branch.user3.is_active if branch.user3 else True,
        "otp1_user_name": branch.otp1_user.username if branch.otp1_user else None,
        "otp2_user_name": branch.otp2_user.username if branch.otp2_user else None,
        "enable_otp1": branch.enable_otp1 if getattr(branch, "enable_otp1", None) is not None else True,
        "enable_otp2": branch.enable_otp2 if getattr(branch, "enable_otp2", None) is not None else True,
        "created_at": branch.created_at,
    }


def _validate_unique_emails_in_input(db: Session, e1: Optional[str], e2: Optional[str], e3: Optional[str], excluded_user_ids: Optional[set] = None):
    emails = [e.strip().lower() for e in (e1, e2, e3) if e and e.strip()]
    if len(emails) != len(set(emails)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User 1, User 2, and User 3 cannot have duplicate email addresses in the same branch")

    from sqlalchemy import func
    for em in set(emails):
        q = db.query(User).filter(func.lower(User.email) == em)
        if excluded_user_ids:
            q = q.filter(~User.id.in_(excluded_user_ids))
        existing = q.first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Email address '{em}' is already registered to another user")


def _resolve_otp_users(u1: User, u2: User, u3: User, r1: Optional[str], r2: Optional[str], r3: Optional[str]):
    role1 = (r1 or "otp1").lower()
    role2 = (r2 or "otp2").lower()
    role3 = (r3 or "none").lower()

    otp1_id = None
    otp2_id = None

    if role1 == "otp1": otp1_id = u1.id
    elif role2 == "otp1": otp1_id = u2.id
    elif role3 == "otp1": otp1_id = u3.id

    if role1 == "otp2": otp2_id = u1.id
    elif role2 == "otp2": otp2_id = u2.id
    elif role3 == "otp2": otp2_id = u3.id

    if not otp1_id: otp1_id = u1.id
    if not otp2_id: otp2_id = u2.id

    return otp1_id, otp2_id


import threading

def _async_send_email(email: str, username: str, branch_name: str, action: str):
    try:
        send_branch_user_email(email, username, branch_name, action=action)
    except Exception:
        pass

def _save_or_update_branch_user(
    db: Session,
    bank_id: int,
    branch_id: int,
    slot: int,
    existing_user_id: Optional[int],
    username: Optional[str],
    email: Optional[str],
    password: Optional[str] = None,
    whatsapp: Optional[str] = None,
    is_active: Optional[bool] = None,
    excluded_user_ids: Optional[set] = None,
) -> User:
    from sqlalchemy import func
    import time

    if excluded_user_ids is None:
        excluded_user_ids = set()

    clean_email = email.strip().lower() if email and email.strip() else None
    clean_username = username.strip() if username and username.strip() else None

    if not clean_email:
        if clean_username:
            clean_email = f"{clean_username.lower().replace(' ', '_')}_b{branch_id}@branch.local"
        else:
            clean_email = f"user{slot}_{int(time.time()*1000)}_{branch_id}@branch.local"

    if not clean_username:
        clean_username = f"user{slot}_b{branch_id}_{int(time.time()*1000)}"

    if clean_username:
        base_username = clean_username
        counter = 1
        while True:
            q = db.query(User).filter(func.lower(User.username) == clean_username.lower())
            if existing_user_id:
                q = q.filter(User.id != existing_user_id)
            if not q.first():
                break
            counter += 1
            clean_username = f"{base_username}_{counter}"

    user = None
    if existing_user_id:
        user = db.query(User).filter(User.id == existing_user_id).first()

    if user:
        if clean_username:
            user.username = clean_username
        user.email = clean_email
        user.bank_id = bank_id
        user.branch_id = branch_id
        if whatsapp is not None:
            user.whatsapp_number = whatsapp.strip() if whatsapp else None
        if password and password.strip():
            user.hashed_password = hash_password(password.strip())
        if is_active is not None:
            user.is_active = is_active

        db.commit()
        db.refresh(user)
        threading.Thread(target=_async_send_email, args=(user.email, user.username, f"Branch #{branch_id}", "updated in"), daemon=True).start()
        return user
    else:
        new_user = User(
            username=clean_username,
            email=clean_email,
            whatsapp_number=whatsapp.strip() if whatsapp else None,
            hashed_password=hash_password(password.strip() if (password and password.strip()) else "user123456"),
            role="user",
            bank_id=bank_id,
            branch_id=branch_id,
            is_active=is_active if is_active is not None else True,
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        threading.Thread(target=_async_send_email, args=(new_user.email, new_user.username, f"Branch #{branch_id}", "created under"), daemon=True).start()
        return new_user


def create_branch_service(db: Session, data: BranchCreate) -> dict:
    bank = db.query(Bank).filter(Bank.id == data.bank_id).first()
    if not bank:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bank not found")

    _validate_unique_emails_in_input(db, data.user1_email, data.user2_email, data.user3_email)

    new_branch = Branch(
        name=data.name,
        bank_id=data.bank_id,
        is_active=data.is_active,
        enable_otp1=data.enable_otp1 if data.enable_otp1 is not None else True,
        enable_otp2=data.enable_otp2 if data.enable_otp2 is not None else True,
    )
    db.add(new_branch)
    db.commit()
    db.refresh(new_branch)

    u1 = _save_or_update_branch_user(db, data.bank_id, new_branch.id, 1, None, data.user1_username, data.user1_email, data.user1_password, data.user1_whatsapp, data.user1_active)
    u2 = _save_or_update_branch_user(db, data.bank_id, new_branch.id, 2, None, data.user2_username, data.user2_email, data.user2_password, data.user2_whatsapp, data.user2_active)
    u3 = _save_or_update_branch_user(db, data.bank_id, new_branch.id, 3, None, data.user3_username, data.user3_email, data.user3_password, data.user3_whatsapp, data.user3_active)

    new_branch.user1_id = u1.id
    new_branch.user2_id = u2.id
    new_branch.user3_id = u3.id

    otp1_id, otp2_id = _resolve_otp_users(u1, u2, u3, data.user1_otp_role, data.user2_otp_role, data.user3_otp_role)
    new_branch.otp1_user_id = data.otp1_user_id or otp1_id
    new_branch.otp2_user_id = data.otp2_user_id or otp2_id

    db.commit()
    db.refresh(new_branch)
    return format_branch_out(new_branch)


def get_branches_service(db: Session, current_user: User, bank_id: int = None) -> list[dict]:
    query = db.query(Branch)
    if current_user.role in ["super_admin", "admin"]:
        if bank_id:
            query = query.filter(Branch.bank_id == bank_id)
    elif current_user.role == "bank_admin":
        if current_user.bank_id:
            query = query.filter(Branch.bank_id == current_user.bank_id)
        else:
            query = query.filter(Branch.id == -1)
    else:  # regular user
        if current_user.branch_id:
            query = query.filter(Branch.id == current_user.branch_id)
        elif current_user.bank_id:
            query = query.filter(Branch.bank_id == current_user.bank_id)
        else:
            query = query.filter(Branch.id == -1)

    branches = query.all()
    return [format_branch_out(b) for b in branches]


def update_branch_service(db: Session, branch_id: int, data: BranchUpdate) -> dict:
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")

    bank_id = data.bank_id or branch.bank_id

    if data.name is not None:
        branch.name = data.name
    if data.bank_id is not None:
        branch.bank_id = data.bank_id
    if data.is_active is not None:
        branch.is_active = data.is_active

    excluded_ids = {uid for uid in (branch.user1_id, branch.user2_id, branch.user3_id) if uid}

    _validate_unique_emails_in_input(db, data.user1_email, data.user2_email, data.user3_email, excluded_user_ids=excluded_ids)

    u1_existing_id = branch.user1_id
    u2_existing_id = branch.user2_id if (branch.user2_id and branch.user2_id != u1_existing_id) else None
    seen_ids = {uid for uid in (u1_existing_id, u2_existing_id) if uid}
    u3_existing_id = branch.user3_id if (branch.user3_id and branch.user3_id not in seen_ids) else None

    u1 = _save_or_update_branch_user(db, bank_id, branch.id, 1, u1_existing_id, data.user1_username, data.user1_email, data.user1_password, data.user1_whatsapp, data.user1_active, excluded_ids)
    u2 = _save_or_update_branch_user(db, bank_id, branch.id, 2, u2_existing_id, data.user2_username, data.user2_email, data.user2_password, data.user2_whatsapp, data.user2_active, excluded_ids)
    u3 = _save_or_update_branch_user(db, bank_id, branch.id, 3, u3_existing_id, data.user3_username, data.user3_email, data.user3_password, data.user3_whatsapp, data.user3_active, excluded_ids)

    branch.user1_id = u1.id
    branch.user2_id = u2.id
    branch.user3_id = u3.id

    otp1_id, otp2_id = _resolve_otp_users(u1, u2, u3, data.user1_otp_role, data.user2_otp_role, data.user3_otp_role)
    branch.otp1_user_id = data.otp1_user_id or otp1_id
    branch.otp2_user_id = data.otp2_user_id or otp2_id

    if data.enable_otp1 is not None:
        branch.enable_otp1 = data.enable_otp1
    if data.enable_otp2 is not None:
        branch.enable_otp2 = data.enable_otp2

    db.commit()
    db.refresh(branch)
    return format_branch_out(branch)


def delete_branch_service(db: Session, branch_id: int, current_user: Optional[User] = None):
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branch not found")

    if current_user and current_user.role == "bank_admin" and current_user.bank_id != branch.bank_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to delete branches outside your bank")

    from app.models.device import Device
    from app.models.user import User

    # Collect all user IDs associated with/assigned to this branch
    branch_user_ids = set()
    if branch.user1_id: branch_user_ids.add(branch.user1_id)
    if branch.user2_id: branch_user_ids.add(branch.user2_id)
    if branch.user3_id: branch_user_ids.add(branch.user3_id)

    users_with_branch = db.query(User.id).filter(User.branch_id == branch_id).all()
    for (uid,) in users_with_branch:
        branch_user_ids.add(uid)

    # 1. Unlink devices assigned to this branch
    db.query(Device).filter(Device.branch_id == branch_id).update({Device.branch_id: None}, synchronize_session=False)

    # 2. Clear assigned user references on the branch object itself to prevent FK constraints
    branch.user1_id = None
    branch.user2_id = None
    branch.user3_id = None
    branch.otp1_user_id = None
    branch.otp2_user_id = None
    db.flush()

    # 3. Delete branch
    db.delete(branch)
    db.commit()

    # 4. Delete the 3 users under this branch from the database
    for uid in branch_user_ids:
        if current_user and current_user.id == uid:
            continue
        try:
            delete_bank_user_service(db, uid, current_user=None)
        except Exception:
            pass

    return {"message": "Branch and associated users deleted successfully"}


