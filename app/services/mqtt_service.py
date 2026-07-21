import os
import json
import logging
import paho.mqtt.client as mqtt
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.device import Device
from app.models.message import ThreadMessage
from app.config import settings

logger = logging.getLogger("mqtt")

mqtt_client = None

def on_connect(client, userdata, flags, rc):
    logger.info(f"MQTT Connected with result code {rc}")
    print(f"[MQTT] Connected with result code {rc}")
    client.subscribe("/OTP/REQUEST/#")

def on_message(client, userdata, msg):
    logger.info(f"MQTT Message received on topic: {msg.topic}")
    print(f"[MQTT] Message received on topic: {msg.topic}")
    try:
        payload_str = msg.payload.decode("utf-8")
        logger.info(f"MQTT Payload: {payload_str}")
        print(f"[MQTT] Payload: {payload_str}")
        
        try:
            data = json.loads(payload_str)
        except Exception:
            data = {"raw": payload_str}

        db = SessionLocal()
        try:
            # Topic format example: /OTP/REQUEST/0000200043
            parts = msg.topic.strip("/").split("/")
            device_name = parts[-1] if len(parts) > 1 else "0000200043"

            device = db.query(Device).filter(Device.name == device_name).first()
            if not device:
                device = db.query(Device).first()

            if device:
                ack_msg = ThreadMessage(
                    device_id=device.id,
                    sender_id=device.owner_id or 1,
                    content=f"OTP Request Acknowledged from {device.name} via topic {msg.topic}",
                    message_type="otp_request_ack",
                    payload={
                        "topic": msg.topic,
                        "raw_payload": payload_str,
                        "data": data,
                        "status": "Acknowledged",
                        "device_name": device.name,
                    }
                )
                db.add(ack_msg)
                db.commit()
                logger.info(f"[MQTT] OTP Request Acknowledgment saved for device {device.name}")
                print(f"[MQTT] OTP Request Acknowledgment saved for device {device.name}")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Error processing MQTT message: {e}")
        print(f"[MQTT] Error processing MQTT message: {e}")

def start_mqtt_client():
    global mqtt_client
    broker_host = settings.MQTT_BROKER_HOST
    broker_port = settings.MQTT_BROKER_PORT
    
    mqtt_client = mqtt.Client()
    mqtt_client.on_connect = on_connect
    mqtt_client.on_message = on_message
    
    if settings.MQTT_USERNAME:
        mqtt_client.username_pw_set(settings.MQTT_USERNAME, settings.MQTT_PASSWORD or "")
    
    try:
        mqtt_client.connect(broker_host, broker_port, 60)
        mqtt_client.loop_start()
        logger.info(f"MQTT Client loop started, broker={broker_host}:{broker_port}")
    except Exception as e:
        logger.warning(f"Could not connect to configured MQTT broker {broker_host}:{broker_port}, trying localhost: {e}")
        try:
            mqtt_client.connect("localhost", 1883, 60)
            mqtt_client.loop_start()
            logger.info("MQTT Client loop started, broker=localhost:1883")
        except Exception as e2:
            logger.error(f"Failed to connect to MQTT broker on both {broker_host}:{broker_port} and localhost:1883: {e2}")

def stop_mqtt_client():
    global mqtt_client
    if mqtt_client:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()
        logger.info("MQTT Client disconnected")

def publish_otp_to_device(device_name: str, otp1: str, otp2: str = ""):
    global mqtt_client
    if not mqtt_client:
        logger.error("MQTT client not initialized")
        return False
    
    clean_device_name = (device_name or "0000200043").strip().lstrip("/")
    if clean_device_name.startswith("OTP/"):
        topic = f"/{clean_device_name}"
    else:
        topic = f"/OTP/{clean_device_name}"
    
    val2 = otp2 if otp2 else otp1
    payload = f"*OTP, ,{otp1},{val2}#"
    
    try:
        info = mqtt_client.publish(topic, payload, qos=1)
        info.wait_for_publish()
        logger.info(f"Published OTP packet to topic {topic}: {payload}")
        print(f"[MQTT] Published OTP packet to topic {topic}: {payload}")
        return True
    except Exception as e:
        logger.error(f"Failed to publish MQTT message to topic {topic}: {e}")
        return False
