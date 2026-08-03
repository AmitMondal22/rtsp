from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager

from app.database import engine, Base
from app.config import settings
from app.controllers import auth_controller, device_controller, camera_controller, bank_controller
from app.streaming import start_health_monitor, stop_health_monitor
from app.services.mqtt_service import start_mqtt_client, stop_mqtt_client


def auto_migrate():
    from sqlalchemy import text
    with engine.connect() as conn:
        migrations = [
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(20);",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS assigned_user_2_id INTEGER REFERENCES users(id);",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS whatsapp_number_1 VARCHAR(20);",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS whatsapp_number_2 VARCHAR(20);",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS enable_email BOOLEAN DEFAULT TRUE;",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS enable_whatsapp BOOLEAN DEFAULT TRUE;",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(100);",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS model VARCHAR(100);",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS firmware_version VARCHAR(50);",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS latitude VARCHAR(20);",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS longitude VARCHAR(20);",
            "ALTER TABLE branches ADD COLUMN IF NOT EXISTS enable_otp1 BOOLEAN DEFAULT TRUE;",
            "ALTER TABLE branches ADD COLUMN IF NOT EXISTS enable_otp2 BOOLEAN DEFAULT TRUE;",
            "ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;",
            "ALTER TABLE users DROP CONSTRAINT IF EXISTS ix_users_username;",
            "DROP INDEX IF EXISTS ix_users_username;",
            "CREATE INDEX IF EXISTS ix_users_username ON users (username);",

        ]
        for query in migrations:
            try:
                conn.execute(text(query))
                conn.commit()
            except Exception as e:
                print(f"[DB Migration] Warning: {e}")


def seed_database():
    from app.database import SessionLocal
    from app.models.user import User
    from app.services.auth_service import hash_password

    db = SessionLocal()
    try:
        admin_user = db.query(User).filter(User.email == "admin@ipcamera.local").first()
        if not admin_user:
            admin_user = User(
                username="admin",
                email="admin@ipcamera.local",
                hashed_password=hash_password("admin123"),
                role="admin",
                is_active=True
            )
            db.add(admin_user)
            db.commit()
            print("[DB] Default admin user created.")

        super_admin = db.query(User).filter(User.email == "superadmin@example.com").first()
        if not super_admin:
            super_admin = User(
                username="superadmin",
                email="superadmin@example.com",
                hashed_password=hash_password("adminpassword"),
                role="super_admin",
                is_active=True
            )
            db.add(super_admin)
            db.commit()
            print("[DB] Default superadmin user created.")

    except Exception as e:
        print(f"[DB] Init failed: {e}")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create DB tables and auto-migrate missing columns
    Base.metadata.create_all(bind=engine)
    auto_migrate()
    seed_database()

    # Start RTSP health monitor (background device connectivity checks)
    try:
        start_health_monitor()
        print("[RTSP] Health monitor started")
    except Exception as e:
        print(f"[RTSP] Health monitor init failed: {e}")

    # Start MQTT client
    try:
        start_mqtt_client()
        print("[MQTT] Client started")
    except Exception as e:
        print(f"[MQTT] Client failed: {e}")

    yield
    # Shutdown

    # Stop RTSP health monitor
    try:
        stop_health_monitor()
        print("[RTSP] Health monitor stopped")
    except Exception:
        pass

    # Stop MQTT client
    try:
        stop_mqtt_client()
        print("[MQTT] Client stopped")
    except Exception:
        pass


app = FastAPI(
    title=settings.APP_NAME,
    description="IP Camera Manager with MVC architecture, PostgreSQL, and RTSP streaming.",
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

# Mount controllers (routers)
app.include_router(auth_controller.router)
app.include_router(device_controller.router)
app.include_router(camera_controller.router)
app.include_router(bank_controller.router)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
@app.get("/login")
def serve_login():
    return FileResponse("templates/login.html")


@app.get("/dashboard")
def serve_dashboard():
    return FileResponse("templates/dashboard.html")


@app.get("/banks")
def serve_banks():
    return FileResponse("templates/banks.html")


@app.get("/users")
def serve_users():
    return FileResponse("templates/users.html")


@app.get("/branches")
def serve_branches():
    return FileResponse("templates/branches.html")


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
    }
