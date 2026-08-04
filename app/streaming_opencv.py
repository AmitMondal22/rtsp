"""
OpenCV-based RTSP streaming module.

Uses OpenCV (cv2.VideoCapture) for reliable RTSP camera connectivity
and frame capture, then encodes frames as JPEG for MJPEG streaming.
Provides auto-reconnection and transport configuration via FFMPEG.
"""
import asyncio
import gc
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import cv2

logger = logging.getLogger("streaming_opencv")

# JPEG quality (0-100, higher = better quality / slightly more bandwidth)
JPEG_QUALITY = 80
# Target framerate (fps)
TARGET_FPS = 25
FRAME_DELAY = 1.0 / TARGET_FPS
# Frame dimensions for resize
FRAME_WIDTH = 640
FRAME_HEIGHT = 360

# Shared lock for VideoCapture open/release (not for reads — reads use per-camera lock)
_capture_lock = threading.Lock()


class OpenCVCamera:
    """
    OpenCV-based RTSP camera capture wrapper.

    Each camera instance owns its own single-thread executor to avoid contention
    when multiple cameras stream simultaneously. Handles connection, frame capture
    with timeout, and automatic cleanup.
    """

    def __init__(self, rtsp_url: str, transport: str = "tcp"):
        self.rtsp_url = rtsp_url
        self.transport = transport
        self._cap: Optional[cv2.VideoCapture] = None
        # Dedicated single-thread executor — avoids shared pool starvation on multi-camera setups
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"cam-{id(self)}")

    def _open_sync(self) -> bool:
        """Open the RTSP stream synchronously with thread safety and ultra-fast FFmpeg flags."""
        with _capture_lock:
            self._release_sync_locked()

            t_str = self.transport or "tcp"
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
                f"rtsp_transport;{t_str}|"
                "fflags;nobuffer|flags;low_delay|max_delay;500000|"
                "probesize;500000|analyzeduration;500000|reorder_queue_size;0|stimeout;3000000"
            )

            # Retry up to 3 times with brief pause for socket release
            for attempt in range(1, 4):
                try:
                    self._cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
                except Exception as cap_err:
                    logger.warning("VideoCapture exception on attempt %d: %s", attempt, cap_err)
                    self._cap = None

                if self._cap is not None:
                    try:
                        self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # 1-frame buffer → minimal latency
                    except Exception:
                        pass
                    if self._cap.isOpened():
                        logger.info("Camera opened: %s (attempt %d)", self.rtsp_url, attempt)
                        return True

                logger.warning("Attempt %d failed: %s", attempt, self.rtsp_url)
                if self._cap:
                    try:
                        self._cap.release()
                    except Exception:
                        pass
                    self._cap = None
                time.sleep(0.3)

            logger.error("Failed to open RTSP after 3 retries: %s", self.rtsp_url)
            return False

    def _read_frame_sync(self) -> Optional[bytes]:
        """Read one frame synchronously. Returns JPEG bytes or None on failure."""
        if self._cap is None:
            return None
        try:
            ret, frame = self._cap.read()
            if not ret or frame is None:
                logger.warning("Frame read failed")
                return None

            # Linear resize — fastest interpolation mode
            if frame.shape[1] != FRAME_WIDTH or frame.shape[0] != FRAME_HEIGHT:
                frame = cv2.resize(frame, (FRAME_WIDTH, FRAME_HEIGHT), interpolation=cv2.INTER_LINEAR)

            ret, jpeg_data = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
            if not ret:
                return None
            return jpeg_data.tobytes()
        except Exception as e:
            logger.warning("Frame read exception: %s", e)
            return None

    def _release_sync_locked(self) -> None:
        """Release VideoCapture while already holding _capture_lock."""
        if self._cap is not None:
            try:
                self._cap.release()
                logger.debug("Camera released")
            except Exception as e:
                logger.warning("Release error: %s", e)
            self._cap = None

    def _release_sync(self) -> None:
        with _capture_lock:
            self._release_sync_locked()

    def _shutdown_executor(self) -> None:
        try:
            self._executor.shutdown(wait=False)
        except Exception:
            pass

    async def open(self) -> bool:
        """Open RTSP stream asynchronously using the per-camera executor."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, self._open_sync)

    async def read_frame(self) -> Optional[bytes]:
        """Read one frame asynchronously using the per-camera executor."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self._executor, self._read_frame_sync)

    def release(self) -> None:
        self._release_sync()
        self._shutdown_executor()

    async def release_async(self) -> None:
        self._release_sync()
        self._shutdown_executor()

    @property
    def is_opened(self) -> bool:
        return self._cap is not None and self._cap.isOpened()

    def __del__(self):
        try:
            self._release_sync()
            self._shutdown_executor()
        except Exception:
            pass


async def generate_mjpeg_frames(
    rtsp_url: str,
    transport: str = "tcp",
    max_reconnect: int = 3,
    reconnect_delay: float = 1.0,
):
    """
    Async generator yielding MJPEG multipart frames from an RTSP camera.
    Uses deadline-based pacing (vs naive sleep-after-encode) so slow encodes
    don't compound frame delay.
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
            return

        logger.info("MJPEG stream started (attempt %d/%d)", attempt, max_reconnect)

        try:
            while True:
                deadline = asyncio.get_event_loop().time() + FRAME_DELAY

                jpeg_bytes = await camera.read_frame()
                if jpeg_bytes is None:
                    logger.warning("Frame read returned None — reconnecting...")
                    break

                yield boundary + content_type + jpeg_bytes + b"\r\n"

                # Deadline-based sleep: subtract time already spent encoding
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining > 0:
                    await asyncio.sleep(remaining)

        finally:
            camera.release()

        if attempt < max_reconnect:
            await asyncio.sleep(reconnect_delay * attempt)
        else:
            return


_cleanup_task: Optional[asyncio.Task] = None


async def _auto_cleanup_loop():
    """
    Background worker that runs every 30 seconds to garbage-collect closed
    OpenCV VideoCapture handles and free RTSP sockets.
    """
    logger.info("RTSP resource cleaner started")
    while True:
        try:
            await asyncio.sleep(30)
            with _capture_lock:
                gc.collect()
            logger.debug("Stream memory + socket cleanup performed")
        except asyncio.CancelledError:
            logger.info("RTSP resource cleaner stopped")
            break
        except Exception as e:
            logger.warning("Cleanup error: %s", e)


def start_auto_cleanup():
    global _cleanup_task
    if _cleanup_task is None or _cleanup_task.done():
        _cleanup_task = asyncio.create_task(_auto_cleanup_loop())


def stop_auto_cleanup():
    global _cleanup_task
    if _cleanup_task and not _cleanup_task.done():
        _cleanup_task.cancel()
        _cleanup_task = None
