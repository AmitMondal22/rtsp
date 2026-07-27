from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
import logging
from app.config import settings

logger = logging.getLogger("app.database")

def create_app_engine():
    db_url = settings.db_url
    if db_url.startswith("sqlite"):
        return create_engine(db_url, connect_args={"check_same_thread": False})
    
    try:
        eng = create_engine(db_url, pool_pre_ping=True, pool_size=10, max_overflow=20)
        conn = eng.connect()
        conn.close()
        return eng
    except Exception as e:
        logger.warning(f"PostgreSQL connection failed ({e}). Falling back to SQLite database.")
        sqlite_url = "sqlite:///./ipcamera.db"
        return create_engine(sqlite_url, connect_args={"check_same_thread": False})

engine = create_app_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
