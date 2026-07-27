"""
Email service for sending OTP codes via SMTP.

Uses Python built-in smtplib — no external dependencies needed.
"""
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from app.config import settings

logger = logging.getLogger("email")


def send_otp_email(to_email: str, otp_code: str, device_name: str, otp_label: str = "OTP Code") -> bool:
    """
    Send an OTP code to the user's email address.

    Args:
        to_email: Recipient email address
        otp_code: 4 or 6 digit OTP code
        device_name: Name of the device for context
        otp_label: Label for the OTP (e.g. "1st Authorization OTP", "2nd Authorization OTP")

    Returns:
        True if email was sent successfully, False otherwise
    """
    if not settings.SMTP_USERNAME or not settings.SMTP_PASSWORD:
        logger.warning("SMTP not configured — skipping OTP email")
        return False

    import datetime
    current_time_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    subject = f"IP Camera Manager — {otp_label} for {device_name} - {current_time_str}"

    html_body = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{ font-family: 'Segoe UI', Arial, sans-serif; background: #0a0e17; color: #e8eaed; padding: 20px; }}
            .container {{ max-width: 480px; margin: 0 auto; background: #1a2035; border-radius: 12px; padding: 32px; border: 1px solid #2a3250; }}
            .logo {{ text-align: center; margin-bottom: 24px; }}
            .logo h2 {{ color: #2979ff; margin: 0; font-size: 20px; }}
            .badge {{ display: inline-block; background: rgba(41, 121, 255, 0.15); border: 1px solid #2979ff; color: #2979ff; font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 4px 10px; border-radius: 20px; margin-bottom: 12px; }}
            .otp-box {{ text-align: center; padding: 24px; background: #0d1321; border-radius: 8px; border: 2px dashed #2a3250; margin: 20px 0; }}
            .otp-code {{ font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #2979ff; font-family: 'Courier New', monospace; }}
            .info {{ color: #8892a6; font-size: 14px; text-align: center; }}
            .device-name {{ color: #ffab00; font-weight: 600; }}
            .footer {{ text-align: center; color: #5a6480; font-size: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #2a3250; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="logo">
                <h2>IP Camera Manager</h2>
            </div>
            <div style="text-align: center;">
                <span class="badge">{otp_label}</span>
            </div>
            <p class="info">Your {otp_label} for device <span class="device-name">{device_name}</span>:</p>
            <div class="otp-box">
                <div class="otp-code">{otp_code}</div>
            </div>
            <p class="info">Sent to: <strong>{to_email}</strong></p>
            <p class="info">This code is valid for <strong>5 minutes</strong>. Do not share it with anyone.</p>
            <div class="footer">
                IP Camera Manager — Industrial Surveillance Platform<br>
                This is an automated message. Do not reply.
            </div>
        </div>
    </body>
    </html>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_FROM_EMAIL
    msg["To"] = to_email

    # Plain text fallback
    text_body = f"[{otp_label}]\nYour code for device '{device_name}' is: {otp_code}\nRecipient: {to_email}\nValid for 5 minutes."
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    try:
        if settings.SMTP_USE_TLS:
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10)
            server.ehlo()
            server.starttls()
            server.ehlo()
        else:
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10)

        server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        server.sendmail(settings.SMTP_FROM_EMAIL, to_email, msg.as_string())
        server.quit()
        logger.info("%s email sent to %s for device '%s'", otp_label, to_email, device_name)
        return True

    except Exception as e:
        logger.error("Failed to send %s email to %s: %s", otp_label, to_email, e)
        return False


def send_branch_user_email(to_email: str, username: str, branch_name: str, action: str = "assigned to") -> bool:
    """
    Send an email notification to a branch user when created or updated.
    """
    if not settings.SMTP_USERNAME or not settings.SMTP_PASSWORD:
        logger.warning("SMTP not configured — skipping branch user email notification for %s", to_email)
        return False

    subject = f"IP Camera Manager — Account {action.capitalize()} Branch '{branch_name}'"
    html_body = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{ font-family: 'Segoe UI', Arial, sans-serif; background: #0a0e17; color: #e8eaed; padding: 20px; }}
            .container {{ max-width: 480px; margin: 0 auto; background: #1a2035; border-radius: 12px; padding: 32px; border: 1px solid #2a3250; }}
            .logo h2 {{ color: #2979ff; margin: 0; font-size: 20px; text-align: center; }}
            .info {{ color: #8892a6; font-size: 14px; text-align: center; }}
            .highlight {{ color: #9060ff; font-weight: 700; }}
            .footer {{ text-align: center; color: #5a6480; font-size: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #2a3250; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="logo">
                <h2>IP Camera Manager</h2>
            </div>
            <p class="info">Hello <strong>{username}</strong>,</p>
            <p class="info">Your account has been {action} branch <span class="highlight">{branch_name}</span> in the Surveillance System.</p>
            <p class="info">Email: <strong>{to_email}</strong></p>
            <div class="footer">
                IP Camera Manager — Industrial Surveillance Platform<br>
                This is an automated message. Do not reply.
            </div>
        </div>
    </body>
    </html>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.SMTP_FROM_EMAIL
    msg["To"] = to_email

    text_body = f"Hello {username},\nYour account has been {action} branch '{branch_name}'.\nEmail: {to_email}"
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    try:
        if settings.SMTP_USE_TLS:
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10)
            server.ehlo()
            server.starttls()
            server.ehlo()
        else:
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10)

        server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        server.sendmail(settings.SMTP_FROM_EMAIL, to_email, msg.as_string())
        server.quit()
        logger.info("Branch user notification sent to %s for branch '%s'", to_email, branch_name)
        return True
    except Exception as e:
        logger.error("Failed to send branch user notification to %s: %s", to_email, e)
        return False

