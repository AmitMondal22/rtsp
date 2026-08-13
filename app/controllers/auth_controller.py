from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserLogin, UserOut, Token
from app.services.auth_service import (
    register_user_service,
    login_service,
    get_current_user,
)

router = APIRouter(prefix="/api/users", tags=["Users"])


from fastapi import HTTPException, status

@router.post("/register")
def register():
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Public self-registration is disabled. Users must be registered by a Bank Admin or System Admin.",
    )


@router.post("/login", response_model=Token)
def login(user: UserLogin, db: Session = Depends(get_db)):
    access_token = login_service(db, user.identifier, user.password)
    return Token(access_token=access_token)


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.get("/", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in ["super_admin", "admin", "bank_admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    if current_user.role == "bank_admin":
        return db.query(User).filter(User.bank_id == current_user.bank_id).all()
    return db.query(User).all()
