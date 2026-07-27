"""
RTSP streaming utilities.

Provides async RTSP stream validation with transport fallback (TCP → UDP → HTTP),
and periodic health monitoring to track device connectivity.
"""
import asyncio
import datetime
import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.device import Device
from app.services.device_service import build_rtsp_url

logger = logging.getLogger("rtsp")

# Ordered transport fallback list
TRANSPORT_FALLBACK = ["tcp", "udp", "http"]


async def validate_rtsp_connection_async(
    rtsp_url: str,
    transport: str = "tcp",
    timeout: int = 8,
) -> bool:
    """
    Validate that an RTSP URL or camera index is reachable by running ffprobe or OpenCV.

    Args:
        rtsp_url: Full RTSP URL or local index to validate
        transport: RTSP transport protocol (tcp, udp, http)
        timeout: Timeout in seconds for ffprobe

    Returns:
        True if the stream is accessible, False otherwise
    """
    if not rtsp_url:
        return False

    try:
        process = await asyncio.create_subprocess_exec(
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            "-rtsp_transport", transport,
            "-timeout", str(timeout * 1000000),
            rtsp_url,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            await asyncio.wait_for(
                process.wait(), timeout=timeout + 5
            )
            return process.returncode == 0
        except asyncio.TimeoutError:
            if process.returncode is None:
                process.kill()
                await process.wait()
            return False
    except FileNotFoundError:
        logger.error("ffprobe not found. Install ffmpeg.")
        return False


async def validate_rtsp_with_fallback(
    rtsp_url: str,
    preferred_transport: str = "tcp",
    timeout: int = 8,
) -> tuple[bool, str]:
    """
    Validate RTSP connection with automatic transport fallback.

    Tries the preferred transport first, then falls back through
    the remaining transports in order (TCP → UDP → HTTP).

    Args:
        rtsp_url: Full RTSP URL to validate
        preferred_transport: Preferred transport to try first
        timeout: Timeout per attempt in seconds

    Returns:
        Tuple of (is_reachable, transport_used)
    """
    transports_to_try = [preferred_transport]
    for t in TRANSPORT_FALLBACK:
        if t not in transports_to_try:
            transports_to_try.append(t)

    for transport in transports_to_try:
        logger.debug("Trying RTSP validation with transport=%s", transport)
        reachable = await validate_rtsp_connection_async(
            rtsp_url, transport=transport, timeout=timeout
        )
        if reachable:
            logger.info("RTSP reachable via transport=%s", transport)
            return True, transport

    return False, preferred_transport


async def check_device_health(
    device: Device, db: Session, timeout: int = 8
) -> bool:
    """
    Check if a device's RTSP stream is reachable and update its online status.

    Returns True if the device is online, False otherwise.
    Also updates the device's is_online and last_seen fields in DB.
    """
    rtsp_url = build_rtsp_url(device)
    if not rtsp_url:
        return False

    reachable, transport_used = await validate_rtsp_with_fallback(
        rtsp_url,
        preferred_transport=device.transport or "tcp",
        timeout=timeout,
    )

    was_online = device.is_online
    now = datetime.datetime.utcnow()

    if reachable:
        device.is_online = True
        device.last_seen = now
        device.transport = transport_used  # Update to working transport
    else:
        device.is_online = False

    # Only commit if state actually changed
    if device.is_online != was_online:
        db.commit()
    else:
        # Still update last_seen if online
        if reachable:
            db.commit()

    return reachable


# ── Background Health Monitor ──
_health_monitor_task: Optional[asyncio.Task] = None
HEALTH_CHECK_INTERVAL = 60  # seconds


async def _health_monitor_loop():
    """
    Background task that periodically checks all devices' RTSP health
    and updates their online/offline status in the database.
    """
    logger.info("RTSP health monitor started (interval=%ds)", HEALTH_CHECK_INTERVAL)

    while True:
        try:
            await asyncio.sleep(HEALTH_CHECK_INTERVAL)

            # Use a standalone session for the background task
            db = SessionLocal()
            try:
                devices = db.query(Device).all()
                logger.debug("Health check: scanning %d devices", len(devices))

                for device in devices:
                    try:
                        await check_device_health(device, db)
                    except Exception as e:
                        logger.error(
                            "Health check failed for device %d: %s",
                            device.id, e,
                        )
            finally:
                db.close()

        except asyncio.CancelledError:
            logger.info("RTSP health monitor stopped")
            break
        except Exception as e:
            logger.error("Health monitor error: %s", e)


def start_health_monitor():
    """Start the background RTSP health monitoring task."""
    global _health_monitor_task
    if _health_monitor_task is None or _health_monitor_task.done():
        _health_monitor_task = asyncio.create_task(_health_monitor_loop())
        logger.info("RTSP health monitor started")


def stop_health_monitor():
    """Stop the background RTSP health monitoring task."""
    global _health_monitor_task
    if _health_monitor_task and not _health_monitor_task.done():
        _health_monitor_task.cancel()
        _health_monitor_task = None
        logger.info("RTSP health monitor stopped")
