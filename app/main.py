from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from contextlib import asynccontextmanager

from app.database import engine, Base
from app.config import settings
from app.controllers import auth_controller, device_controller, camera_controller, bank_controller, otp_controller, alert_controller, report_controller
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
            "ALTER TABLE devices DROP COLUMN IF EXISTS host;",
            "ALTER TABLE devices DROP COLUMN IF EXISTS port;",
            "ALTER TABLE devices DROP COLUMN IF EXISTS username;",
            "ALTER TABLE devices DROP COLUMN IF EXISTS password;",
            "ALTER TABLE devices DROP COLUMN IF EXISTS stream_path;",
            "ALTER TABLE devices DROP COLUMN IF EXISTS transport;",
            "ALTER TABLE branches ADD COLUMN IF NOT EXISTS enable_otp1 BOOLEAN DEFAULT TRUE;",
            "ALTER TABLE branches ADD COLUMN IF NOT EXISTS enable_otp2 BOOLEAN DEFAULT TRUE;",
            "ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;",
            "ALTER TABLE users DROP CONSTRAINT IF EXISTS ix_users_username;",
            "DROP INDEX IF EXISTS ix_users_username;",
            "CREATE INDEX IF NOT EXISTS ix_users_username ON users (username);",
            "ALTER TABLE offline_otps DROP CONSTRAINT IF EXISTS offline_otps_device_id_fkey;",
            "ALTER TABLE offline_otps ADD CONSTRAINT offline_otps_device_id_fkey FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE;",
            "ALTER TABLE device_offline_otps DROP CONSTRAINT IF EXISTS device_offline_otps_device_id_fkey;",
            "ALTER TABLE device_offline_otps ADD CONSTRAINT device_offline_otps_device_id_fkey FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE;",
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

        pass

    except Exception as e:
        print(f"[DB] Init failed: {e}")
    finally:
        db.close()


def cleanup_device_rtsp_urls():
    from app.database import SessionLocal
    from app.models.device import Device
    from app.services.device_service import sanitize_rtsp_url

    db = SessionLocal()
    try:
        devices = db.query(Device).all()
        updated_count = 0
        for dev in devices:
            if dev.rtsp_url:
                cleaned = sanitize_rtsp_url(dev.rtsp_url)
                if cleaned != dev.rtsp_url:
                    print(f"[DB Cleanup] Corrected RTSP URL for device {dev.id} ({dev.name}): '{dev.rtsp_url}' -> '{cleaned}'")
                    dev.rtsp_url = cleaned
                    updated_count += 1
        if updated_count > 0:
            db.commit()
            print(f"[DB Cleanup] Successfully updated {updated_count} device RTSP URLs.")
    except Exception as e:
        print(f"[DB Cleanup] Warning cleaning device RTSP URLs: {e}")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create DB tables and auto-migrate missing columns
    try:
        Base.metadata.create_all(bind=engine)
        auto_migrate()
        cleanup_device_rtsp_urls()
        seed_database()
    except Exception as db_err:
        print(f"[DB Startup Warning] {db_err}")

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

    # Start automatic background stream cleaner
    try:
        from app.streaming_opencv import start_auto_cleanup, stop_auto_cleanup
        start_auto_cleanup()
        print("[RTSP] Auto resource cleaner started")
    except Exception as e:
        print(f"[RTSP] Auto resource cleaner init failed: {e}")

    yield
    # Shutdown

    # Stop automatic background stream cleaner
    try:
        stop_auto_cleanup()
        print("[RTSP] Auto resource cleaner stopped")
    except Exception:
        pass

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
app.include_router(auth_controller.auth_router)
app.include_router(device_controller.router)
app.include_router(camera_controller.router)
app.include_router(bank_controller.router)
app.include_router(otp_controller.router)
app.include_router(alert_controller.router)
app.include_router(report_controller.router)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

templates = Jinja2Templates(directory="templates")


@app.get("/")
@app.get("/login")
def serve_login(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})


@app.get("/dashboard")
@app.get("/overview")
def serve_dashboard(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})


@app.get("/rtsp")
def serve_rtsp(request: Request):
    return templates.TemplateResponse("rtsp.html", {"request": request})


@app.get("/devices")
def serve_devices(request: Request):
    return templates.TemplateResponse("devices.html", {"request": request})


@app.get("/requests")
def serve_requests(request: Request):
    return templates.TemplateResponse("requests.html", {"request": request})


@app.get("/alerts")
def serve_alerts(request: Request):
    return templates.TemplateResponse("alerts.html", {"request": request})


@app.get("/reports")
def serve_reports(request: Request):
    return templates.TemplateResponse("reports.html", {"request": request})


@app.get("/online-otp")
@app.get("/manage-otp")
def serve_online_otp(request: Request):
    return templates.TemplateResponse("online_otp.html", {"request": request})


@app.get("/offline-otp")
def serve_offline_otp(request: Request):
    return templates.TemplateResponse("offline_otp.html", {"request": request})


@app.get("/banks")
def serve_banks(request: Request):
    return templates.TemplateResponse("banks.html", {"request": request})


@app.get("/branches")
def serve_branches(request: Request):
    return templates.TemplateResponse("branches.html", {"request": request})


@app.get("/users")
def serve_users(request: Request):
    return templates.TemplateResponse("users.html", {"request": request})


@app.get("/logs")
def serve_logs(request: Request):
    return templates.TemplateResponse("logs.html", {"request": request})




@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
    }
