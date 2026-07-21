from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # App
    APP_NAME: str = "IP Camera Manager"
    APP_VERSION: str = "2.0.0"
    DEBUG: bool = False

    # Database (PostgreSQL)
    DB_HOST: str = "localhost"
    DB_PORT: int = 5432
    DB_USER: str = "ipcamera"
    DB_PASSWORD: str = "ipcamera123"
    DB_NAME: str = "ipcamera"
    DATABASE_URL: Optional[str] = None

    @property
    def db_url(self) -> str:
        if self.DATABASE_URL:
            return self.DATABASE_URL
        return f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    # JWT
    JWT_SECRET_KEY: str = "change-this-secret-key-in-production-8a7f9b2c"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 480


    # RTSP Streaming
    RTSP_STREAM_TIMEOUT: int = 30  # seconds

    # SMTP Email (for OTP delivery)
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USERNAME: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None
    SMTP_FROM_EMAIL: str = "noreply@ipcamera.local"
    SMTP_USE_TLS: bool = True

    # MQTT Broker
    MQTT_BROKER_HOST: str = "localhost"
    MQTT_BROKER_PORT: int = 1883
    MQTT_USERNAME: Optional[str] = None
    MQTT_PASSWORD: Optional[str] = None

    # WhatsApp Gateway
    WHATSAPP_API_URL: Optional[str] = None
    WHATSAPP_API_TOKEN: Optional[str] = None
    WHATSAPP_FROM_NUMBER: Optional[str] = None

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
