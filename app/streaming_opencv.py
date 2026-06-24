"""
OpenCV-based RTSP streaming module.

Uses OpenCV (cv2.VideoCapture) for reliable RTSP camera connectivity
and frame capture, then encodes frames as JPEG for MJPEG streaming.
Provides auto-reconnection and transport configuration via FFMPEG.
"""
import asyncio
import logging
from typing import Optional

import cv2

logger = logging.getLogger("streaming_opencv")

# JPEG quality (0-100, higher = better)
JPEG_QUALITY = 80
# Target framerate (fps)
TARGET_FPS = 15
FRAME_DELAY = 1.0 / TARGET_FPS
# Frame dimensions for resize
FRAME_WIDTH = 640
FRAME_HEIGHT = 360

# OpenCV CAP_PROP_FFMPEG_CMD_PREFIX constant (value 85)
# Some builds may not define this, so use the raw value as fallback
try:
    CAP_PROP_FFMPEG_CMD_PREFIX = cv2.CAP_PROP_FFMPEG_CMD_PREFIX
except AttributeError:
    CAP_PROP_FFMPEG_CMD_PREFIX = 85


class OpenCVCamera:
    """
    OpenCV-based RTSP camera capture wrapper.

    Handles connection, frame capture with timeout, and automatic cleanup.
    Uses run_in_executor for non-blocking frame reads from OpenCV.
    """

    def __init__(
        self,
        rtsp_url: str,
        transport: str = "tcp",
    ):
        self.rtsp_url = rtsp_url
        self.transport = transport
        self._cap: Optional[cv2.VideoCapture] = None

    def _open_sync(self) -> bool:
        """Open the RTSP stream synchronously (runs in thread pool)."""
        self._release_sync()

        # Set RTSP transport option in environment for FFmpeg backend
        try:
            import os
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = f"rtsp_transport;{self.transport or 'tcp'}"
        except Exception as e:
            logger.warning("Could not set FFMPEG capture options env: %s", e)

        self._cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)

        # Reduce buffer for lower latency
        try:
            self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass

        if not self._cap.isOpened():
            logger.warning("OpenCV failed to open RTSP: %s", self.rtsp_url)
            self._cap = None
            return False

        logger.info("OpenCV camera opened: %s (transport=%s)", self.rtsp_url, self.transport)
        return True

    def _read_frame_sync(self) -> Optional[bytes]:
        """
        Read one frame and return JPEG bytes.
        Returns None if frame could not be captured.
        """
        if self._cap is None:
            return None

        ret, frame = self._cap.read()
        if not ret or frame is None:
            logger.warning("OpenCV frame read failed")
            return None

        # Resize frame to reduce bandwidth
        if frame.shape[1] != FRAME_WIDTH or frame.shape[0] != FRAME_HEIGHT:
            frame = cv2.resize(frame, (FRAME_WIDTH, FRAME_HEIGHT), interpolation=cv2.INTER_AREA)

        # Encode to JPEG
        ret, jpeg_data = cv2.imencode(".jpg", frame, [
            cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY,
        ])
        if not ret:
            return None

        return jpeg_data.tobytes()

    def _release_sync(self) -> None:
        """Release the camera resource synchronously."""
        if self._cap is not None:
            self._cap.release()
            self._cap = None
            logger.debug("OpenCV camera released")

    async def open(self) -> bool:
        """Open the RTSP stream asynchronously."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._open_sync)

    async def read_frame(self) -> Optional[bytes]:
        """Read one frame and return JPEG bytes asynchronously."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._read_frame_sync)

    def release(self) -> None:
        """Release the camera resource."""
        self._release_sync()

    @property
    def is_opened(self) -> bool:
        return self._cap is not None and self._cap.isOpened()

    def __del__(self):
        self.release()


async def generate_mjpeg_frames(
    rtsp_url: str,
    transport: str = "tcp",
    max_reconnect: int = 3,
    reconnect_delay: int = 1,
):
    """
    Async generator that yields MJPEG multipart frames from an RTSP camera
    using OpenCV. Includes auto-reconnection and frame rate throttling.

    Yields:
        bytes: MJPEG multipart frame (boundary + header + JPEG data + newline)
    """
    boundary = b"--frame\r\n"
    content_type = b"Content-Type: image/jpeg\r\n\r\n"

    for attempt in range(1, max_reconnect + 1):
        camera = OpenCVCamera(rtsp_url, transport=transport)
        opened = await camera.open()

        if not opened:
            if attempt < max_reconnect:
                yield (
                    boundary
                    + b"Content-Type: text/plain\r\n\r\n"
                    + f"Connecting (attempt {attempt}/{max_reconnect})...\r\n".encode()
                )
                await asyncio.sleep(reconnect_delay * attempt)
                continue
            else:
                yield (
                    boundary
                    + b"Content-Type: text/plain\r\n\r\n"
                    + b"Failed to connect to camera. Refresh to retry.\r\n"
                )
                return

        logger.info("OpenCV stream started (attempt %d/%d)", attempt, max_reconnect)

        try:
            while True:
                jpeg_bytes = await camera.read_frame()
                if jpeg_bytes is None:
                    logger.warning("OpenCV frame read returned None, reconnecting...")
                    break

                yield boundary + content_type + jpeg_bytes + b"\r\n"

                # Frame rate throttling
                await asyncio.sleep(FRAME_DELAY)

        finally:
            camera.release()

        # Stream dropped — attempt reconnect
        if attempt < max_reconnect:
            yield (
                boundary
                + b"Content-Type: text/plain\r\n\r\n"
                + f"Reconnecting (attempt {attempt + 1}/{max_reconnect})...\r\n".encode()
            )
            await asyncio.sleep(reconnect_delay * attempt)
        else:
            yield (
                boundary
                + b"Content-Type: text/plain\r\n\r\n"
                + b"Stream disconnected. Refresh to reconnect.\r\n"
            )
