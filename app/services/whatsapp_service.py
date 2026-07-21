"""
WhatsApp service for dispatching OTP codes and alerts.

Supports HTTP API dispatch (e.g., Twilio, Meta Cloud API, UltraMsg, Wati, etc.)
and gracefully logs messages when gateway credentials are not set.
"""
import logging
import urllib.request
import urllib.parse
import json

from app.config import settings

logger = logging.getLogger("whatsapp")


def send_whatsapp_otp(phone_number: str, otp_code: str, device_name: str, otp_label: str = "OTP Code") -> bool:
    """
    Send an OTP code to a user's WhatsApp number.

    Args:
        phone_number: Recipient phone number (e.g. +919876543210)
        otp_code: 4 or 6 digit OTP code
        device_name: Name of the surveillance device
        otp_label: Label for the OTP (e.g. "1st Authorization OTP", "2nd Authorization OTP")

    Returns:
        True if sent or dispatched, False if phone number missing or gateway error
    """
    if not phone_number or not phone_number.strip():
        logger.warning("No WhatsApp phone number provided — skipping WhatsApp OTP")
        return False

    phone = phone_number.strip()
    message_text = f"🔐 IP Camera Manager — {otp_label}\nDevice: {device_name}\nOTP Code: {otp_code}\nValid for 5 minutes."

    # If WhatsApp Gateway API URL is configured, make HTTP POST call
    if settings.WHATSAPP_API_URL:
        try:
            payload = {
                "to": phone,
                "body": message_text,
                "token": settings.WHATSAPP_API_TOKEN,
                "from": settings.WHATSAPP_FROM_NUMBER
            }
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                settings.WHATSAPP_API_URL,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                logger.info("WhatsApp %s sent to %s for device '%s' (Status %s)", otp_label, phone, device_name, resp.status)
                return True
        except Exception as e:
            logger.error("Failed to post WhatsApp %s to %s: %s", otp_label, phone, e)
            return False
    else:
        # Gateway URL not set — log payload delivery simulation
        logger.info("[WhatsApp Simulation] %s sent to %s for device '%s': OTP=%s", otp_label, phone, device_name, otp_code)
        print(f"[WhatsApp] {otp_label} dispatched to {phone} for device '{device_name}': Code = {otp_code}")
        return True
