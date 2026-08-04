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
JPEG_QUALITY = 75
# Target framerate (fps)
TARGET_FPS = 25
FRAME_DELAY = 1.0 / TARGET_FPS
# Frame dimensions for resize
FRAME_WIDTH = 640
FRAME_HEIGHT = 360

# OpenCV CAP_PROP_FFMPEG_CMD_PREFIX constant (value 85)
try:
    CAP_PROP_FFMPEG_CMD_PREFIX = cv2.CAP_PROP_FFMPEG_CMD_PREFIX
except AttributeError:
    CAP_PROP_FFMPEG_CMD_PREFIX = 85


import threading

_capture_lock = threading.Lock()


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
        """Open the RTSP stream synchronously with thread safety and ultra-fast FFmpeg flags."""
        with _capture_lock:
            self._release_sync_locked()

            try:
                import os
                t_str = self.transport or "tcp"
                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
                    f"rtsp_transport;{t_str}|"
                    "fflags;nobuffer|flags;low_delay|max_delay;500000|"
                    "probesize;500000|analyzeduration;500000|reorder_queue_size;0|stimeout;3000000"
                )
            except Exception as e:
                logger.warning("Could not set FFMPEG capture options env: %s", e)

            # Retry up to 3 times with brief pause for socket release
            for attempt in range(1, 4):
                try:
                    self._cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
                except Exception as cap_err:
                    logger.warning("OpenCV VideoCapture exception on attempt %d: %s", attempt, cap_err)
                    self._cap = None

                if self._cap is not None:
                    # Force minimal 1-frame buffer for real-time low latency
                    try:
                        self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    except Exception:
                        pass

                    if self._cap.isOpened():
                        logger.info("OpenCV camera opened successfully: %s (attempt %d)", self.rtsp_url, attempt)
                        return True

                logger.warning("OpenCV attempt %d failed to open RTSP: %s. Retrying...", attempt, self.rtsp_url)
                if self._cap:
                    try:
                        self._cap.release()
                    except Exception:
                        pass
                    self._cap = None
                import time
                time.sleep(0.3)

            logger.error("OpenCV failed to open RTSP after retries: %s", self.rtsp_url)
            return False

    def _read_frame_sync(self) -> Optional[bytes]:
        """
        Read one frame and return JPEG bytes.
        Returns None if frame could not be captured.
        """
        if self._cap is None:
            return None

        try:
            ret, frame = self._cap.read()
            if not ret or frame is None:
                logger.warning("OpenCV frame read failed")
                return None

            # Fast hardware-optimized linear resize
            if frame.shape[1] != FRAME_WIDTH or frame.shape[0] != FRAME_HEIGHT:
                frame = cv2.resize(frame, (FRAME_WIDTH, FRAME_HEIGHT), interpolation=cv2.INTER_LINEAR)

            # Fast JPEG encoding
            ret, jpeg_data = cv2.imencode(".jpg", frame, [
                cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY,
            ])
            if not ret:
                return None

            return jpeg_data.tobytes()
        except Exception as frame_err:
            logger.warning("Exception reading frame from OpenCV: %s", frame_err)
            return None

    def _release_sync_locked(self) -> None:
        """Release the camera resource synchronously while holding _capture_lock."""
        if self._cap is not None:
            try:
                self._cap.release()
                logger.debug("OpenCV camera released successfully")
            except Exception as e:
                logger.warning("Error releasing OpenCV capture: %s", e)
            self._cap = None

    def _release_sync(self) -> None:
        """Release the camera resource synchronously under lock."""
        with _capture_lock:
            self._release_sync_locked()

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

    async def release_async(self) -> None:
        """Release the camera resource asynchronously without blocking thread pool."""
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
                await asyncio.sleep(reconnect_delay * attempt)
                continue
            else:
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
            await asyncio.sleep(reconnect_delay * attempt)
        else:
            return


import gc

_cleanup_task: Optional[asyncio.Task] = None


async def _auto_cleanup_loop():
    """
    Background worker that runs every 30 seconds to clean up unreferenced RTSP sockets,
    garbage-collect closed OpenCV frame objects, and prevent memory growth without server restarts.
    """
    logger.info("Automatic RTSP resource cleaner started")
    while True:
        try:
            await asyncio.sleep(30)
            # Run garbage collection under capture lock to free unreferenced VideoCapture handles
            with _capture_lock:
                gc.collect()
            logger.debug("Automatic stream memory and socket cleanup performed")
        except asyncio.CancelledError:
            logger.info("Automatic RTSP resource cleaner stopped")
            break
        except Exception as e:
            logger.warning("Error in auto cleanup worker: %s", e)


def start_auto_cleanup():
    global _cleanup_task
    if _cleanup_task is None or _cleanup_task.done():
        _cleanup_task = asyncio.create_task(_auto_cleanup_loop())


def stop_auto_cleanup():
    global _cleanup_task
    if _cleanup_task and not _cleanup_task.done():
        _cleanup_task.cancel()
        _cleanup_task = None
