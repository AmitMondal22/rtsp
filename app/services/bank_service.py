from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from app.models.bank import Bank
from app.models.user import User
from app.schemas.bank import BankAdminCreate
from app.schemas.user import BankUserCreate
from app.services.auth_service import hash_password

def create_bank_and_admin_service(db: Session, data: BankAdminCreate) -> Bank:
    # Check if bank exists
    existing_bank = db.query(Bank).filter(Bank.name == data.bank_name).first()
    if existing_bank:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bank name already exists")
    
    # Check if user exists
    existing_user = db.query(User).filter((User.username == data.username) | (User.email == data.email)).first()
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username or email already exists")

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
    if not bank_id:
        first_bank = db.query(Bank).first()
        if not first_bank:
            first_bank = Bank(name="Default Bank")
            db.add(first_bank)
            db.commit()
            db.refresh(first_bank)
        bank_id = first_bank.id

    existing_user = db.query(User).filter((User.username == data.username) | (User.email == data.email)).first()
    if existing_user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username or email already exists")

    target_role = getattr(data, "role", None) or "user"
    new_user = User(
        username=data.username,
        email=data.email,
        whatsapp_number=getattr(data, "whatsapp_number", None),
        hashed_password=hash_password(data.password),
        role=target_role,
        bank_id=bank_id
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

def get_bank_users_service(db: Session, current_user: User) -> list[User]:
    if current_user.role in ("super_admin", "admin") or not current_user.bank_id:
        return db.query(User).all()
    return db.query(User).filter(User.bank_id == current_user.bank_id).all()

def update_bank_service(db: Session, bank_id: int, data) -> Bank:
    bank = db.query(Bank).filter(Bank.id == bank_id).first()
    if not bank:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bank not found")
    if data.name:
        bank.name = data.name
    db.commit()
    db.refresh(bank)
    return bank

def delete_bank_service(db: Session, bank_id: int):
    bank = db.query(Bank).filter(Bank.id == bank_id).first()
    if not bank:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bank not found")
    db.delete(bank)
    db.commit()
    return {"message": "Bank deleted successfully"}

def update_bank_user_service(db: Session, user_id: int, data) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if data.username is not None and data.username != user.username:
        existing = db.query(User).filter(User.username == data.username, User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already taken")
        user.username = data.username
    if data.email is not None and data.email != user.email:
        existing = db.query(User).filter(User.email == data.email, User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already taken")
        user.email = data.email
    if data.whatsapp_number is not None:
        user.whatsapp_number = data.whatsapp_number
    if data.role is not None:
        user.role = data.role
    if data.bank_id is not None:
        user.bank_id = data.bank_id
    if data.password:
        user.hashed_password = hash_password(data.password)
    if data.is_active is not None:
        user.is_active = data.is_active

    db.commit()
    db.refresh(user)
    return user

def delete_bank_user_service(db: Session, user_id: int):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    db.delete(user)
    db.commit()
    return {"message": "User deleted successfully"}
