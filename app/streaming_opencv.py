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
import json
from fastapi import WebSocket

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


class CameraBroadcaster:
    """
    Multi-client stream broadcaster for a single camera device_id.

    Maintains exactly ONE RTSP VideoCapture connection to the physical IP camera,
    and broadcasts incoming JPEG frames to all connected WebSockets and MJPEG stream clients.
    """
    def __init__(self, device_id: int, rtsp_url: str, transport: str = "tcp"):
        self.device_id = device_id
        self.rtsp_url = rtsp_url
        self.transport = transport
        self._subscribers: set[asyncio.Queue] = set()
        self._websockets: set[WebSocket] = set()
        self._task: Optional[asyncio.Task] = None
        self._camera: Optional[OpenCVCamera] = None
        self._lock = asyncio.Lock()
        self._last_frame: Optional[bytes] = None

    async def add_websocket(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._websockets.add(websocket)
            if self._task is None or self._task.done():
                self._start_capture_loop()

    async def remove_websocket(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._websockets.discard(websocket)

    def subscribe_queue(self) -> asyncio.Queue:
        q = asyncio.Queue(maxsize=5)
        if self._last_frame:
            try:
                q.put_nowait(self._last_frame)
            except Exception:
                pass
        self._subscribers.add(q)
        if self._task is None or self._task.done():
            self._start_capture_loop()
        return q

    def unsubscribe_queue(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def _start_capture_loop(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run_capture_loop())

    async def _run_capture_loop(self) -> None:
        logger.info("[Broadcaster %d] Starting single RTSP capture loop for URL: %s", self.device_id, self.rtsp_url)
        self._camera = OpenCVCamera(self.rtsp_url, transport=self.transport)
        opened = await self._camera.open()
        if not opened:
            logger.warning("[Broadcaster %d] Failed to open RTSP stream", self.device_id)
            for ws in list(self._websockets):
                try:
                    await ws.send_text(json.dumps({"error": "Failed to connect to RTSP camera stream"}))
                except Exception:
                    pass
            self._task = None
            return

        try:
            while self._websockets or self._subscribers:
                deadline = asyncio.get_event_loop().time() + FRAME_DELAY
                frame_bytes = await self._camera.read_frame()
                if frame_bytes is None:
                    await asyncio.sleep(0.1)
                    continue

                self._last_frame = frame_bytes

                # Broadcast to WebSockets
                stale_ws = []
                for ws in list(self._websockets):
                    try:
                        await ws.send_bytes(frame_bytes)
                    except Exception:
                        stale_ws.append(ws)

                for ws in stale_ws:
                    self._websockets.discard(ws)

                # Broadcast to Queues (MJPEG streams)
                stale_q = []
                for q in list(self._subscribers):
                    try:
                        if q.full():
                            try:
                                q.get_nowait()
                            except Exception:
                                pass
                        q.put_nowait(frame_bytes)
                    except Exception:
                        stale_q.append(q)

                for q in stale_q:
                    self._subscribers.discard(q)

                remaining = deadline - asyncio.get_event_loop().time()
                if remaining > 0:
                    await asyncio.sleep(remaining)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.warning("[Broadcaster %d] Capture loop exception: %s", self.device_id, e)
        finally:
            logger.info("[Broadcaster %d] Stopping single RTSP capture loop", self.device_id)
            if self._camera:
                await self._camera.release_async()
                self._camera = None
            self._task = None


class CameraBroadcasterHub:
    """Registry for camera broadcasters indexed by device_id."""
    def __init__(self):
        self._broadcasters: dict[int, CameraBroadcaster] = {}
        self._lock = threading.Lock()

    def get_broadcaster(self, device_id: int, rtsp_url: str, transport: str = "tcp") -> CameraBroadcaster:
        with self._lock:
            bc = self._broadcasters.get(device_id)
            if bc and bc.rtsp_url != rtsp_url:
                if bc._task and not bc._task.done():
                    bc._task.cancel()
                bc = None

            if bc is None:
                bc = CameraBroadcaster(device_id, rtsp_url, transport=transport)
                self._broadcasters[device_id] = bc
            return bc

    def close_broadcaster(self, device_id: int) -> None:
        with self._lock:
            bc = self._broadcasters.pop(device_id, None)
            if bc and bc._task and not bc._task.done():
                bc._task.cancel()


camera_broadcaster_hub = CameraBroadcasterHub()


async def generate_mjpeg_frames(
    rtsp_url: str,
    transport: str = "tcp",
    max_reconnect: int = 3,
    reconnect_delay: float = 1.0,
):
    """
    Async generator yielding MJPEG multipart frames from an RTSP camera.
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

