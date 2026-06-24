from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager

from app.database import engine, Base
from app.config import settings
from app.controllers import auth_controller, device_controller, camera_controller
from app.streaming import start_health_monitor, stop_health_monitor
from app.services.mqtt_service import start_mqtt_client, stop_mqtt_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create DB tables
    Base.metadata.create_all(bind=engine)

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

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def serve_frontend():
    return FileResponse("templates/index.html")


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
    }
