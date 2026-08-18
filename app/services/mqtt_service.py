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
        client.subscribe("/OTP/#", qos=1)
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
            parts = msg.topic.strip("/").split("/")
            jdata = data if isinstance(data, dict) else {}
            payload_type = str(jdata.get("type", "")).strip()

            # Determine if this message is an offline OTP pool update / status message:
            # 1. Topic is /OTP/STATUS/{device_name}, /OTP/RESPONSE/{device_name}, /OTP/POOL/{device_name}
            # 2. Payload type is 'offline_otp_pool'
            # 3. Payload contains 'otps' list or '*OFFOTP' header
            is_otp_status = False
            if len(parts) >= 2 and parts[1].upper() in ("STATUS", "RESPONSE", "POOL", "OFFLINE_OTP"):
                is_otp_status = True
            elif payload_type == "offline_otp_pool":
                is_otp_status = True
            elif jdata.get("otps") or ("OFFOTP" in payload_str):
                is_otp_status = True

            if is_otp_status:
                # Topic identifier candidate
                topic_ident = ""
                if len(parts) >= 2:
                    if parts[1].upper() in ("STATUS", "RESPONSE", "POOL", "OFFLINE_OTP"):
                        topic_ident = parts[-1] if len(parts) > 2 and parts[-1].upper() not in ("STATUS", "RESPONSE", "POOL", "OFFLINE_OTP") else ""
                    else:
                        topic_ident = parts[1]

                # Collect candidate device identifiers from topic and JSON payload
                candidates = []
                if topic_ident:
                    candidates.append(topic_ident)
                if isinstance(jdata, dict):
                    for key in ["device_id", "device_name", "deviceId", "deviceName"]:
                        val = jdata.get(key)
                        if val and str(val).strip() not in candidates:
                            candidates.append(str(val).strip())

                # Query device strictly by candidate identifiers (name or numeric ID)
                device = None
                for ident in candidates:
                    if not ident:
                        continue
                    device = db.query(Device).filter(Device.name == ident).first()
                    if not device and ident.isdigit():
                        device = db.query(Device).filter(Device.id == int(ident)).first()
                    if not device:
                        device = db.query(Device).filter(Device.name.ilike(ident)).first()
                    if device:
                        break

                if not device:
                    logger.warning("Device not available in database for MQTT status/pool topic %s (candidates: %s)", msg.topic, candidates)
                    return

                from app.models.otp_bulk import DeviceOfflineOTP
                clean_p = payload_str.strip().rstrip("#").lstrip("*")
                otps_extracted = []

                if isinstance(jdata, dict) and (jdata.get("otps") or jdata.get("data")):
                    if jdata.get("otps") and isinstance(jdata["otps"], list):
                        otps_extracted = [str(x).strip() for x in jdata["otps"]]
                    elif jdata.get("data"):
                        d_str = str(jdata["data"]).strip()
                        if "," in d_str:
                            otps_extracted = [x.strip() for x in d_str.split(",") if x.strip()]
                        else:
                            content_str = d_str
                            # bcdhex-v1 structure (e.g. 506 chars total: 102 chars header, 400 chars 4-digit OTPs, 4 chars trailer)
                            if len(d_str) >= 502 and d_str.startswith("01") and d_str[2:102] == "4" * 100:
                                content_str = d_str[102:502]
                            elif len(d_str) == 506:
                                content_str = d_str[102:502]
                            elif len(d_str) > 400:
                                if len(d_str) >= 502:
                                    content_str = d_str[102:502]
                                else:
                                    content_str = d_str[:400]
                            elif len(d_str) % 4 == 2:
                                content_str = d_str[2:]

                            otps_extracted = [content_str[i:i+4] for i in range(0, len(content_str), 4) if content_str[i:i+4]]
                elif "OFFOTP" in clean_p:
                    p_parts = clean_p.split(",")
                    otps_extracted = [x.strip() for x in p_parts[3:] if x.strip()]
                else:
                    otps_extracted = [x.strip() for x in clean_p.split(",") if x.strip()]

                if otps_extracted:
                    existing_otps = {o.slot_number: o for o in db.query(DeviceOfflineOTP).filter(DeviceOfflineOTP.device_id == device.id).all()}
                    max_slots = len(otps_extracted) if len(otps_extracted) > 100 else 100
                    for idx in range(1, max_slots + 1):
                        val = otps_extracted[idx - 1] if (idx - 1) < len(otps_extracted) else ""
                        if idx in existing_otps:
                            existing_otps[idx].otp_code = str(val).strip()
                            existing_otps[idx].status = "active"
                        else:
                            new_o = DeviceOfflineOTP(device_id=device.id, slot_number=idx, otp_code=str(val).strip(), status="active")
                            db.add(new_o)

                    status_ack_msg = ThreadMessage(
                        device_id=device.id,
                        sender_id=device.owner_id or 1,
                        content=f"Offline OTP Pool sync updated for {device.name} via {msg.topic}",
                        message_type="otp_status",
                        payload={
                            "topic": msg.topic,
                            "raw_payload": payload_str,
                            "data": data,
                            "status": "Processed",
                            "slots_updated": len(otps_extracted),
                            "device_name": device.name,
                            "device_id": device.id,
                        },
                    )
                    db.add(status_ack_msg)
                    db.commit()
                    logger.info("Updated bulk offline OTPs for device %s (id: %d) from MQTT topic %s", device.name, device.id, msg.topic)
                return

            # Default/Request: Topic format: /OTP/REQUEST/{device_ident} or /OTP/{device_ident}
            candidates = []
            if len(parts) >= 2 and parts[-1].upper() not in ("REQUEST", "OTP"):
                candidates.append(parts[-1])

            if isinstance(jdata, dict):
                for key in ["device_id", "device_name", "deviceId", "deviceName", "name", "id"]:
                    val = jdata.get(key)
                    if val and str(val).strip() and str(val).strip() not in candidates:
                        candidates.append(str(val).strip())

            device = None
            for ident in candidates:
                if not ident:
                    continue
                device = db.query(Device).filter(Device.name == ident).first()
                if not device and ident.isdigit():
                    device = db.query(Device).filter(Device.id == int(ident)).first()
                if not device:
                    device = db.query(Device).filter(Device.name.ilike(ident)).first()
                if device:
                    break

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
                        "device_id": device.id,
                    },
                )
                db.add(ack_msg)
                db.commit()
                logger.info("OTP request saved for device %s (id: %d)", device.name, device.id)
            else:
                logger.warning("No device found for MQTT topic %s (candidates: %s)", msg.topic, candidates)
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


def _get_device_name_topic(device_identifier: str) -> str:
    clean_ident = (str(device_identifier) or "").strip().lstrip("/")
    if clean_ident.startswith("OTP/"):
        clean_ident = clean_ident[4:]
    
    device_name = clean_ident

    db = SessionLocal()
    try:
        device = None
        if clean_ident.isdigit():
            device = db.query(Device).filter(Device.id == int(clean_ident)).first()
        if not device and clean_ident:
            device = db.query(Device).filter(Device.name == clean_ident).first()

        if device and device.name:
            device_name = device.name
    except Exception as e:
        logger.warning("Error querying device for MQTT topic: %s", e)
    finally:
        db.close()

    return f"/OTP/{device_name}"


def publish_otp_to_device(device_identifier: str, otp1: str, otp2: str = "") -> bool:
    global mqtt_client
    if not mqtt_client:
        logger.error("MQTT client not initialized")
        return False

    val2 = otp2 if otp2 else otp1
    payload = f"*OTP, ,{otp1},{val2}#"
    topic = _get_device_name_topic(device_identifier)

    try:
        info = mqtt_client.publish(topic, payload, qos=1)
        info.wait_for_publish()
        logger.info("Published OTP to %s: %s", topic, payload)
        return True
    except Exception as e:
        logger.error("Failed to publish MQTT message to %s: %s", topic, e)
        return False


def publish_bulk_otp_to_device(device_identifier: str, otp_list: list) -> bool:
    global mqtt_client
    if not mqtt_client:
        logger.error("MQTT client not initialized")
        return False

    # Ensure exactly 100 entries, formatted as string
    otps_padded = [(str(otp_list[i]) if i < len(otp_list) else "") for i in range(100)]
    payload = f"*OFFOTP,BULK,1,{','.join(otps_padded)}#"
    topic = _get_device_name_topic(device_identifier)

    try:
        info = mqtt_client.publish(topic, payload, qos=1)
        info.wait_for_publish()
        logger.info("Published Bulk OTP to %s (%d items)", topic, len(otp_list))
        return True
    except Exception as e:
        logger.error("Failed to publish bulk OTP MQTT message to %s: %s", topic, e)
        return False



