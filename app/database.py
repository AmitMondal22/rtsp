from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from sqlalchemy.pool import NullPool
import logging
from app.config import settings

logger = logging.getLogger("app.database")


def create_app_engine():
    db_url = settings.db_url
    if db_url.startswith("sqlite"):
        # NullPool avoids thread-safety issues with SQLite
        return create_engine(
            db_url,
            connect_args={"check_same_thread": False},
            poolclass=NullPool,
        )

    try:
        eng = create_engine(
            db_url,
            pool_pre_ping=True,    # validate connection health before checkout
            pool_size=10,          # base pool size
            max_overflow=20,       # extra burst connections under load
            pool_recycle=1800,     # recycle idle connections every 30 min (prevents Docker idle-timeout drops)
            pool_timeout=10,       # fail fast on pool exhaustion instead of hanging 30s
        )
        conn = eng.connect()
        conn.close()
        logger.info("PostgreSQL connection pool established.")
        return eng
    except Exception as e:
        logger.warning(f"PostgreSQL connection failed ({e}). Falling back to SQLite.")
        return create_engine(
            "sqlite:///./ipcamera.db",
            connect_args={"check_same_thread": False},
            poolclass=NullPool,
        )


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

