import os
import json
import logging
import threading
import paho.mqtt.client as mqtt
from app.database import SessionLocal
from app.models.device import Device
from app.models.message import ThreadMessage
from app.config import settings

logger = logging.getLogger("mqtt")

mqtt_client = None


def on_connect(client, userdata, flags, rc):
    if rc == 0:
        logger.info("MQTT connected successfully")
        client.subscribe("/OTP/REQUEST/#", qos=1)
    else:
        logger.warning("MQTT connection failed with code %d", rc)


def on_disconnect(client, userdata, rc):
    if rc != 0:
        logger.warning("MQTT unexpected disconnect (code %d) — will auto-reconnect", rc)


def on_message(client, userdata, msg):
    logger.info("MQTT message on topic: %s", msg.topic)
    try:
        payload_str = msg.payload.decode("utf-8")
        try:
            data = json.loads(payload_str)
        except Exception:
            data = {"raw": payload_str}

        db = SessionLocal()
        try:
            # Topic format: /OTP/REQUEST/DEVICENAME
            parts = msg.topic.strip("/").split("/")
            device_name = parts[-1] if len(parts) > 1 else None

            device = None
            if device_name:
                device = db.query(Device).filter(Device.name == device_name).first()
            if not device:
                device = db.query(Device).first()

            if device:
                ack_msg = ThreadMessage(
                    device_id=device.id,
                    sender_id=device.owner_id or 1,
                    content=f"OTP Request received from {device.name} via {msg.topic}",
                    message_type="otp_request",
                    payload={
                        "topic": msg.topic,
                        "raw_payload": payload_str,
                        "data": data,
                        "status": "Pending",
                        "device_name": device.name,
                    },
                )
                db.add(ack_msg)
                db.commit()
                logger.info("OTP request saved for device %s", device.name)
            else:
                logger.warning("No device found for MQTT topic %s", msg.topic)
        finally:
            db.close()
    except Exception as e:
        logger.error("Error processing MQTT message: %s", e)


def _connect_async():
    global mqtt_client
    if not mqtt_client:
        return
    broker_host = settings.MQTT_BROKER_HOST
    broker_port = settings.MQTT_BROKER_PORT
    try:
        mqtt_client.connect(broker_host, broker_port, keepalive=60)
        mqtt_client.loop_start()
        logger.info("MQTT loop started, broker=%s:%d", broker_host, broker_port)
    except Exception as e:
        logger.warning("Could not connect to MQTT broker %s:%d: %s", broker_host, broker_port, e)
        try:
            mqtt_client.connect("localhost", 1883, keepalive=60)
            mqtt_client.loop_start()
            logger.info("MQTT loop started (fallback localhost:1883)")
        except Exception:
            logger.info("MQTT broker offline — publishing will fail silently")


def start_mqtt_client():
    global mqtt_client
    import socket
    # A stable client_id is required when clean_session=False (broker needs to retain session)
    client_id = f"ipcamera-{socket.gethostname()[:20]}"
    mqtt_client = mqtt.Client(client_id=client_id, clean_session=False)
    mqtt_client.on_connect = on_connect
    mqtt_client.on_disconnect = on_disconnect
    mqtt_client.on_message = on_message
    # Exponential backoff reconnect: min 1s, max 30s
    mqtt_client.reconnect_delay_set(min_delay=1, max_delay=30)

    if settings.MQTT_USERNAME:
        mqtt_client.username_pw_set(settings.MQTT_USERNAME, settings.MQTT_PASSWORD or "")

    threading.Thread(target=_connect_async, daemon=True, name="mqtt-connect").start()


def stop_mqtt_client():
    global mqtt_client
    if mqtt_client:
        try:
            mqtt_client.loop_stop()
            mqtt_client.disconnect()
        except Exception:
            pass
        mqtt_client = None
        logger.info("MQTT client disconnected")


def publish_otp_to_device(device_name: str, otp1: str, otp2: str = "") -> bool:
    global mqtt_client
    if not mqtt_client:
        logger.error("MQTT client not initialized")
        return False

    clean_device_name = (device_name or "").strip().lstrip("/")
    topic = f"/OTP/{clean_device_name}" if not clean_device_name.startswith("OTP/") else f"/{clean_device_name}"

    val2 = otp2 if otp2 else otp1
    payload = f"*OTP, ,{otp1},{val2}#"

    try:
        info = mqtt_client.publish(topic, payload, qos=1)
        info.wait_for_publish()
        logger.info("Published OTP to %s: %s", topic, payload)
        return True
    except Exception as e:
        logger.error("Failed to publish MQTT message to %s: %s", topic, e)
        return False
