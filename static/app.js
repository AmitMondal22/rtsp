// ── State ──
const state = {
    token: localStorage.getItem("token") || null,
    user: null,
    devices: [],
    selectedDeviceId: null,
    currentMode: "thread",
    otpTimer: null,
};

// Immediate redirect to login if no token
if (!state.token) {
    window.location.href = "/";
}

// ── API Helper ──
async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json" };
    if (state.token) headers["Authorization"] = `Bearer ${state.token}`;

    const res = await fetch(path, { ...options, headers });
    if (res.status === 204) return null;

    const contentType = res.headers.get("content-type") || "";
    let data;
    if (contentType.includes("application/json")) {
        try {
            data = await res.json();
        } catch (e) {
            data = null;
        }
    } else {
        const text = await res.text();
        data = { detail: text || `HTTP ${res.status} ${res.statusText}` };
    }

    if (!res.ok) {
        const msg = typeof data?.detail === "string" ? data.detail : (data?.detail?.[0]?.msg || data?.message || `Request failed (${res.status})`);
        throw new Error(msg);
    }
    return data;
}

// ── DOM Shortcuts (avoid $ conflict with jQuery) ──
const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => document.querySelectorAll(sel);

// ── Page Navigation ──
function showPage(pageId) {
    qsa(".page").forEach((p) => p.classList.remove("active"));
    qs(`#${pageId}`).classList.add("active");
}

// ── Toast Notification ──
function showToast(messageOrTitle, typeOrMessage = "success", optionalType = null) {
    let message = messageOrTitle;
    let type = typeOrMessage;
    if (optionalType !== null) {
        message = `${messageOrTitle}: ${typeOrMessage}`;
        type = optionalType;
    }
    if (type === "danger") type = "error";

    const container = qs("#toast-container");
    if (!container) return;

    const iconMap = {
        success: "bi bi-check-circle-fill",
        error: "bi bi-exclamation-circle-fill",
        info: "bi bi-info-circle-fill",
    };
    const el = document.createElement("div");
    el.className = `toast-notification toast-${type || 'info'}`;
    el.innerHTML = `<i class="${iconMap[type] || iconMap.info}"></i><span>${escapeHtml(String(message))}</span>`;
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = "0";
        el.style.transform = "translateX(100%)";
        el.style.transition = "all 0.4s ease";
        setTimeout(() => el.remove(), 400);
    }, 4000);
}


let cameraTimestampInterval = null;
let currentStreamMode = null; // "mjpeg" or "webrtc"

// Module state flags
let banksModuleInitialized = false;
let branchesModuleInitialized = false;
let selectedBranchBankFilter = "all";
let currentEditingBranch = null;
let usersModuleInitialized = false;
let offlineOtpModuleInitialized = false;
let currentOtpBankId = null;
let currentOtpBranchId = null;
let currentOtpDeviceId = null;
let currentOtpDeviceName = "";
let selectedSiteFilter = "all";

function startCameraTimestamp() {
    if (cameraTimestampInterval) clearInterval(cameraTimestampInterval);
    const el = qs("#camera-timestamp");
    if (!el) return;
    function update() {
        const now = new Date();
        el.textContent = now.toLocaleTimeString("en-US", { hour12: false }) + ":" +
            String(now.getMilliseconds()).padStart(3, "0");
    }
    update();
    cameraTimestampInterval = setInterval(update, 1000);
}

function stopCameraTimestamp() {
    if (cameraTimestampInterval) {
        clearInterval(cameraTimestampInterval);
        cameraTimestampInterval = null;
    }
}

function setStreamStatus(text, type = "info") {
    const el = qs("#stream-status");
    const overlay = qs(".camera-overlay");
    const timestamp = qs("#camera-timestamp");

    if (type === "live") {
        if (el) {
            el.classList.add("hidden");
            el.style.display = "none";
        }
        if (overlay) {
            overlay.classList.remove("hidden");
            overlay.style.display = "flex";
        }
        if (timestamp) {
            timestamp.classList.remove("hidden");
            timestamp.style.display = "block";
        }
    } else {
        if (overlay) {
            overlay.classList.add("hidden");
            overlay.style.display = "none";
        }
        if (timestamp) {
            timestamp.classList.add("hidden");
            timestamp.style.display = "none";
        }
        if (el) {
            el.classList.remove("hidden");
            el.style.display = "flex";
            if (type === "info" || type === "warning") {
                el.className = "stream-skeleton-placeholder absolute inset-0 z-5 flex flex-col items-center justify-center skeleton-shimmer-dark bg-slate-950 pointer-events-none";
                el.innerHTML = `
                    <div class="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 mb-3 shadow-inner">
                        <i class="bi bi-camera-video text-2xl text-slate-400"></i>
                    </div>
                    <div class="h-3 w-40 bg-slate-800/90 rounded-full mb-1.5"></div>
                    <div class="h-2 w-24 bg-slate-800/50 rounded-full mb-2"></div>
                    <span class="text-[11px] font-mono ${type === 'warning' ? 'text-amber-400' : 'text-slate-400'} tracking-wide mt-1">${escapeHtml(text)}</span>
                    <div class="absolute top-3 left-3 h-5 w-24 bg-slate-900/90 rounded border border-slate-800/80"></div>
                    <div class="absolute top-3 right-3 h-6 w-16 bg-slate-900/90 rounded border border-slate-800/80"></div>
                `;
            } else if (type === "error") {
                el.className = "flex flex-col items-center justify-center text-xs font-medium text-center p-4 text-rose-400";
                el.innerHTML = `<i class="bi bi-camera-video-off text-3xl text-rose-400 block mb-2"></i><span>${escapeHtml(text)}</span>`;
            } else {
                el.className = "flex flex-col items-center justify-center text-xs font-medium text-center p-4 text-slate-400";
                el.innerHTML = `<i class="bi bi-camera-video text-3xl text-slate-500 block mb-2 opacity-40"></i><span>${escapeHtml(text)}</span>`;
            }
        }
    }
}

let activeWebSocket = null;
let currentBlobUrl = null;

let streamRetryTimer = null;
let streamRetryCount = 0;

function cancelStreamRetry() {
    if (streamRetryTimer) {
        clearTimeout(streamRetryTimer);
        streamRetryTimer = null;
    }
}

function handleStreamFailure(deviceId) {
    cancelStreamRetry();
    if (state.selectedDeviceId !== deviceId) return;

    if (streamRetryCount >= 5) {
        setStreamStatus("Stream currently unavailable. Please verify RTSP URL and camera connectivity.", "error");
        return;
    }

    streamRetryCount++;
    setStreamStatus(`Reconnecting stream (attempt ${streamRetryCount}/5)...`, "warning");

    streamRetryTimer = setTimeout(() => {
        if (state.selectedDeviceId === deviceId) {
            startWebSocketStream(deviceId);
        }
    }, 2500);
}

// ── WebSocket RTSP Streaming (Primary - GPU Accelerated) ──
function startWebSocketStream(deviceId) {
    stopAllStreams();
    currentStreamMode = "websocket";

    const canvas = qs("#camera-feed-canvas");
    const mjpegEl = qs("#camera-feed-mjpeg");

    if (canvas) {
        canvas.classList.remove("hidden");
        canvas.style.display = "block";
    }
    if (mjpegEl) {
        mjpegEl.classList.add("hidden");
        mjpegEl.style.display = "none";
    }
    if (streamRetryCount > 0) {
        setStreamStatus(`Connecting live camera feed (attempt ${streamRetryCount})...`, "warning");
    } else {
        setStreamStatus("Connecting Ultra-Fast RTSP stream...", "info");
    }

    const ctx = canvas ? canvas.getContext("2d", { alpha: false, desynchronized: true }) : null;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/camera/${deviceId}/ws${state.token ? `?token=${encodeURIComponent(state.token)}` : ""}`;

    // Instant connection — no arbitrary setTimeout delay
    try {
        activeWebSocket = new WebSocket(wsUrl);
        activeWebSocket.binaryType = "blob";

        activeWebSocket.onopen = () => {
            cancelStreamRetry();
            setStreamStatus("Live (WebSocket)", "live");
            startCameraTimestamp();
        };

        activeWebSocket.onmessage = async (event) => {
            if (typeof event.data === "string") {
                try {
                    const parsed = JSON.parse(event.data);
                    if (parsed.ping) return; // Keepalive ping
                    if (parsed.connecting) {
                        setStreamStatus("Connecting camera feed...", "info");
                        return;
                    }
                    if (parsed.error && !parsed.offline) {
                        startMjpegStream(deviceId);
                    }
                } catch (e) {}
                return;
            }

            if (event.data instanceof Blob) {
                streamRetryCount = 0;
                cancelStreamRetry();
                setStreamStatus("Live (WebSocket)", "live");

                if (canvas && ctx && window.createImageBitmap) {
                    try {
                        const bitmap = await createImageBitmap(event.data);
                        if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
                            canvas.width = bitmap.width;
                            canvas.height = bitmap.height;
                        }
                        ctx.drawImage(bitmap, 0, 0);
                        bitmap.close();

                        // Keep canvas visible and active
                        if (canvas.style.display === "none") {
                            canvas.style.display = "block";
                            canvas.classList.remove("hidden");
                        }
                        if (mjpegEl && mjpegEl.style.display !== "none") {
                            mjpegEl.style.display = "none";
                            mjpegEl.classList.add("hidden");
                        }
                        return;
                    } catch (e) {
                        // Corrupted single network packet / frame drop — ignore frame and wait for next
                        return;
                    }
                }

                // Fallback for browsers without createImageBitmap
                if (mjpegEl) {
                    if (canvas) {
                        canvas.classList.add("hidden");
                        canvas.style.display = "none";
                    }
                    mjpegEl.classList.remove("hidden");
                    mjpegEl.style.display = "block";
                    const newUrl = URL.createObjectURL(event.data);
                    mjpegEl.src = newUrl;
                    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
                    currentBlobUrl = newUrl;
                }
            }
        };

        activeWebSocket.onerror = (err) => {
            console.warn("WebSocket stream error:", err);
        };

        activeWebSocket.onclose = () => {
            if (currentStreamMode === "websocket" && state.selectedDeviceId === deviceId) {
                if (streamRetryCount < 2) {
                    streamRetryCount++;
                    setTimeout(() => {
                        if (currentStreamMode === "websocket" && state.selectedDeviceId === deviceId) {
                            startWebSocketStream(deviceId);
                        }
                    }, 400);
                } else {
                    startMjpegStream(deviceId);
                }
            }
        };
    } catch (e) {
        console.error("Failed to initialize WebSocket stream:", e);
        startMjpegStream(deviceId);
    }
}

function stopWebSocket() {
    if (activeWebSocket) {
        activeWebSocket.onclose = null;
        activeWebSocket.onerror = null;
        try {
            activeWebSocket.close();
        } catch (e) {}
        activeWebSocket = null;
    }
    if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = null;
    }
    const canvas = qs("#camera-feed-canvas");
    if (canvas) {
        canvas.classList.add("hidden");
        canvas.style.display = "none";
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

// ── MJPEG Streaming (Fallback) ──
function startMjpegStream(deviceId) {
    stopWebSocket();
    currentStreamMode = "mjpeg";

    const mjpegEl = qs("#camera-feed-mjpeg");
    const canvas = qs("#camera-feed-canvas");

    if (canvas) {
        canvas.classList.add("hidden");
        canvas.style.display = "none";
    }

    if (mjpegEl) {
        mjpegEl.classList.remove("hidden");
        mjpegEl.style.display = "block";
        if (streamRetryCount > 0) {
            setStreamStatus(`Reconnecting MJPEG Stream (attempt ${streamRetryCount})...`, "warning");
        } else {
            setStreamStatus("Connecting MJPEG Stream...", "info");
        }

        const cacheBuster = `&t=${Date.now()}`;
        mjpegEl.src = `/api/camera/${deviceId}/mjpeg${state.token ? `?token=${encodeURIComponent(state.token)}` : ""}${cacheBuster}`;

        mjpegEl.onload = () => {
            streamRetryCount = 0;
            cancelStreamRetry();
            setStreamStatus("Live (Stream)", "live");
            startCameraTimestamp();
        };

        mjpegEl.onerror = () => {
            if (state.selectedDeviceId === deviceId) {
                handleStreamFailure(deviceId);
            }
        };
    }
}

function stopMjpeg() {
    const mjpegEl = qs("#camera-feed-mjpeg");
    if (mjpegEl) {
        mjpegEl.onload = null;
        mjpegEl.onerror = null;
        mjpegEl.removeAttribute("src");
        mjpegEl.src = "";
        mjpegEl.classList.add("hidden");
        mjpegEl.style.display = "none";
    }
}

function stopAllStreams() {
    cancelStreamRetry();
    stopWebSocket();
    stopMjpeg();
    stopCameraTimestamp();
    currentStreamMode = null;
    resetStreamZoom();
    setStreamStatus("Select a device from the left to start live surveillance stream", "idle");
}
window.stopAllStreams = stopAllStreams;

// ══════════════════════════════════════════
//  LIVE VIEW ZOOM & FULLSCREEN CONTROLS
// ══════════════════════════════════════════
let streamZoom = 1.0;
let streamPanX = 0;
let streamPanY = 0;
let isStreamPanning = false;
let streamPanStartX = 0;
let streamPanStartY = 0;
let liveViewControlsInitialized = false;

function updateStreamTransform(animate = false) {
    const wrapper = qs("#stream-feed-wrapper");
    const container = qs("#live-player-container");
    const zoomLevelEl = qs("#stream-zoom-level");
    const zoomOutBtn = qs("#stream-zoom-out-btn");
    const zoomInBtn = qs("#stream-zoom-in-btn");
    const resetBtn = qs("#stream-zoom-reset-btn");

    if (!wrapper) return;

    if (streamZoom <= 1.0) {
        streamZoom = 1.0;
        streamPanX = 0;
        streamPanY = 0;
        wrapper.style.cursor = "default";
    } else {
        if (container) {
            const rect = container.getBoundingClientRect();
            const maxPanX = Math.max(0, (rect.width * (streamZoom - 1)) / 2);
            const maxPanY = Math.max(0, (rect.height * (streamZoom - 1)) / 2);
            streamPanX = Math.max(-maxPanX, Math.min(maxPanX, streamPanX));
            streamPanY = Math.max(-maxPanY, Math.min(maxPanY, streamPanY));
        }
        wrapper.style.cursor = isStreamPanning ? "grabbing" : "grab";
    }

    if (animate) {
        wrapper.style.transition = "transform 0.15s ease-out";
    } else {
        wrapper.style.transition = "none";
    }

    wrapper.style.transform = `translate(${streamPanX}px, ${streamPanY}px) scale(${streamZoom})`;

    if (zoomLevelEl) {
        zoomLevelEl.textContent = `${Math.round(streamZoom * 100)}%`;
        if (streamZoom > 1.0) {
            zoomLevelEl.classList.remove("text-slate-300");
            zoomLevelEl.classList.add("text-sky-400");
        } else {
            zoomLevelEl.classList.remove("text-sky-400");
            zoomLevelEl.classList.add("text-slate-300");
        }
    }

    if (zoomOutBtn) {
        zoomOutBtn.disabled = streamZoom <= 1.0;
        zoomOutBtn.style.opacity = streamZoom <= 1.0 ? "0.4" : "1";
    }
    if (zoomInBtn) {
        zoomInBtn.disabled = streamZoom >= 5.0;
        zoomInBtn.style.opacity = streamZoom >= 5.0 ? "0.4" : "1";
    }
    if (resetBtn) {
        resetBtn.style.opacity = (streamZoom === 1.0 && streamPanX === 0 && streamPanY === 0) ? "0.6" : "1";
    }
}

function zoomInStream(delta = 0.25) {
    if (streamZoom >= 5.0) return;
    streamZoom = Math.min(5.0, Math.round((streamZoom + delta) * 100) / 100);
    updateStreamTransform(true);
}

function zoomOutStream(delta = 0.25) {
    if (streamZoom <= 1.0) return;
    streamZoom = Math.max(1.0, Math.round((streamZoom - delta) * 100) / 100);
    if (streamZoom === 1.0) {
        streamPanX = 0;
        streamPanY = 0;
    }
    updateStreamTransform(true);
}

function resetStreamZoom() {
    streamZoom = 1.0;
    streamPanX = 0;
    streamPanY = 0;
    updateStreamTransform(true);
}

function toggleStreamFullscreen() {
    const container = qs("#live-player-container");
    if (!container) return;

    const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    if (!isFs) {
        if (container.requestFullscreen) {
            container.requestFullscreen().catch(err => console.warn("Fullscreen request error:", err));
        } else if (container.webkitRequestFullscreen) {
            container.webkitRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen().catch(err => console.warn("Exit fullscreen error:", err));
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
    }
}

function updateFullscreenIcon() {
    const icon = qs("#stream-fullscreen-icon");
    const btn = qs("#stream-fullscreen-btn");
    const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    if (icon) {
        if (isFs) {
            icon.className = "bi bi-fullscreen-exit text-xs";
        } else {
            icon.className = "bi bi-arrows-fullscreen text-xs";
        }
    }
    if (btn) {
        btn.title = isFs ? "Exit Full View (Esc)" : "Full View / Fullscreen (Double-click player)";
    }
}

function initLiveViewControls() {
    const container = qs("#live-player-container");
    const wrapper = qs("#stream-feed-wrapper");
    const zoomInBtn = qs("#stream-zoom-in-btn");
    const zoomOutBtn = qs("#stream-zoom-out-btn");
    const resetBtn = qs("#stream-zoom-reset-btn");
    const fsBtn = qs("#stream-fullscreen-btn");

    if (zoomInBtn) {
        zoomInBtn.onclick = (e) => {
            e.stopPropagation();
            zoomInStream(0.25);
        };
    }
    if (zoomOutBtn) {
        zoomOutBtn.onclick = (e) => {
            e.stopPropagation();
            zoomOutStream(0.25);
        };
    }
    if (resetBtn) {
        resetBtn.onclick = (e) => {
            e.stopPropagation();
            resetStreamZoom();
        };
    }
    if (fsBtn) {
        fsBtn.onclick = (e) => {
            e.stopPropagation();
            toggleStreamFullscreen();
        };
    }

    if (liveViewControlsInitialized) {
        updateStreamTransform(false);
        updateFullscreenIcon();
        return;
    }
    liveViewControlsInitialized = true;

    if (container) {
        // Mouse wheel zoom
        container.addEventListener("wheel", (e) => {
            if (e.target.closest("button") || e.target.closest("select")) return;
            e.preventDefault();
            if (e.deltaY < 0) {
                zoomInStream(0.2);
            } else if (e.deltaY > 0) {
                zoomOutStream(0.2);
            }
        }, { passive: false });

        // Double click to toggle fullscreen
        container.addEventListener("dblclick", (e) => {
            if (e.target.closest("button") || e.target.closest("select") || e.target.closest("span")) return;
            toggleStreamFullscreen();
        });

        // Mouse drag pan when zoomed in
        container.addEventListener("mousedown", (e) => {
            if (streamZoom <= 1.0) return;
            if (e.button !== 0) return;
            if (e.target.closest("button") || e.target.closest("select")) return;

            isStreamPanning = true;
            streamPanStartX = e.clientX - streamPanX;
            streamPanStartY = e.clientY - streamPanY;
            if (wrapper) wrapper.classList.add("panning");
            updateStreamTransform(false);
            e.preventDefault();
        });

        window.addEventListener("mousemove", (e) => {
            if (!isStreamPanning) return;
            streamPanX = e.clientX - streamPanStartX;
            streamPanY = e.clientY - streamPanStartY;
            updateStreamTransform(false);
        });

        window.addEventListener("mouseup", () => {
            if (isStreamPanning) {
                isStreamPanning = false;
                if (wrapper) wrapper.classList.remove("panning");
                updateStreamTransform(false);
            }
        });
    }

    document.addEventListener("fullscreenchange", updateFullscreenIcon);
    document.addEventListener("webkitfullscreenchange", updateFullscreenIcon);

    updateStreamTransform(false);
    updateFullscreenIcon();
}

window.zoomInStream = zoomInStream;
window.zoomOutStream = zoomOutStream;
window.resetStreamZoom = resetStreamZoom;
window.toggleStreamFullscreen = toggleStreamFullscreen;
window.initLiveViewControls = initLiveViewControls;

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLiveViewControls);
} else {
    initLiveViewControls();
}


// Smart OTP request poller — pauses when OTP panel is not visible
let otpRequestsInterval = null;
let _otpPanelVisible = true;

async function loadOtpRequests() {
    if (!state.token) return;
    try {
        const requests = await api("/api/camera/otp-requests?only_pending=false");
        const allList = requests || [];
        const pendingOnly = allList.filter(r => r.status === "Pending");
        state.otpRequests = pendingOnly;
        state.allOtpRequests = allList;
        state.sentOtpRequests = allList.filter(r => r.status !== "Pending");
        renderOtpRequests(allList);
        updateSendButtonState();
    } catch (err) {
        // Silently ignore — polling errors are non-fatal
    }
}

function startOtpPolling() {
    if (otpRequestsInterval) return; // already running
    loadOtpRequests();
    otpRequestsInterval = setInterval(() => {
        if (_otpPanelVisible) {
            loadOtpRequests();
        }
    }, 5000);
}

function stopOtpPolling() {
    if (otpRequestsInterval) {
        clearInterval(otpRequestsInterval);
        otpRequestsInterval = null;
    }
}

// Pause polling when tab/window is hidden, resume when visible
document.addEventListener("visibilitychange", () => {
    _otpPanelVisible = !document.hidden;
    if (!document.hidden) {
        loadOtpRequests(); // immediate refresh on tab focus
    }
});

function createRequestCardHtml(req) {
    const timeStr = formatTime(req.created_at);
    const devName = req.device_name || `Device #${req.device_id}`;
    const bankStr = req.bank_name ? `${escapeHtml(req.bank_name)}${req.branch_name ? ' — ' + escapeHtml(req.branch_name) : ''}` : '';
    const otp1 = req.otp1 || req.payload?.otp1 || req.payload?.otp1_code || req.payload?.otp_code || req.payload?.code;
    const otp2 = req.otp2 || req.payload?.otp2 || req.payload?.otp2_code;
    const u1 = req.recipient1 || req.payload?.recipient1 || "1st User";
    const u2 = req.recipient2 || req.payload?.recipient2 || "2nd User";
    const status = req.status || req.payload?.status || (req.message_type === 'otp_request' ? 'Pending' : 'Acknowledged');
    const isPending = status === 'Pending';

    return `
        <div class="bg-slate-50 border ${isPending ? 'border-amber-300 ring-1 ring-amber-100 hover:border-sky-500 hover:shadow-md cursor-pointer' : 'border-slate-200 hover:border-slate-300'} rounded-xl p-4 transition space-y-3" ${isPending ? `onclick="window.location.href='/devices?device=' + encodeURIComponent('${req.device_id}')"` : ''}>
            <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2">
                    <span class="text-xs text-slate-900 font-bold flex items-center">
                        <i class="bi bi-shield-lock text-sky-600 mr-1.5"></i> ${escapeHtml(devName)}
                    </span>
                    ${bankStr ? `<span class="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-medium">${bankStr}</span>` : ''}
                </div>
                <div class="flex items-center space-x-2">
                    <span class="text-[10px] ${isPending ? 'text-amber-700 bg-amber-100 border border-amber-300' : 'text-emerald-700 bg-emerald-100 border border-emerald-300'} px-2.5 py-0.5 rounded-full font-bold flex items-center">
                        ${isPending ? '<span class="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5 animate-pulse"></span>' : '<i class="bi bi-check-circle-fill text-emerald-500 mr-1 text-[10px]"></i>'}
                        ${escapeHtml(status)}
                    </span>
                    ${isPending ? `
                        <a href="/devices?device=${encodeURIComponent(req.device_id)}" onclick="event.stopPropagation();" class="px-2.5 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center transition cursor-pointer">
                            <i class="bi bi-box-arrow-up-right mr-1"></i> Open Device
                        </a>
                    ` : ''}
                </div>
            </div>

            <div class="text-[11px] text-slate-500 flex items-center justify-between">
                <span class="flex items-center">
                    <i class="bi bi-broadcast text-slate-400 mr-1"></i>
                    ${escapeHtml(req.payload?.topic || `/OTP/REQUEST/${devName}`)}
                </span>
                <span class="flex items-center">
                    <i class="bi bi-clock text-slate-400 mr-1"></i>
                    ${timeStr}
                </span>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <div class="flex items-center justify-between ${isPending ? 'bg-amber-50/80 border border-amber-200' : 'bg-emerald-50 border border-emerald-200'} px-3 py-2 rounded-lg text-xs shadow-xs">
                    <span class="text-[11px] text-slate-700 font-semibold truncate mr-2 flex items-center">
                        <i class="bi bi-key-fill ${isPending ? 'text-amber-600' : 'text-emerald-600'} mr-1.5"></i>1st OTP (${escapeHtml(u1)}):
                    </span>
                    <span class="font-mono font-extrabold text-slate-500 tracking-widest text-sm bg-white px-2.5 py-0.5 rounded border border-slate-200 shadow-xs flex items-center select-none" title="Hidden for security — dispatched via Email & MQTT">
                        <i class="bi bi-shield-lock-fill text-slate-400 mr-1.5 text-xs"></i>••••
                    </span>
                </div>
                <div class="flex items-center justify-between ${isPending ? 'bg-amber-50/80 border border-amber-200' : 'bg-sky-50 border border-sky-200'} px-3 py-2 rounded-lg text-xs shadow-xs">
                    <span class="text-[11px] text-slate-700 font-semibold truncate mr-2 flex items-center">
                        <i class="bi bi-key-fill ${isPending ? 'text-amber-600' : 'text-sky-600'} mr-1.5"></i>2nd OTP (${escapeHtml(u2)}):
                    </span>
                    <span class="font-mono font-extrabold text-slate-500 tracking-widest text-sm bg-white px-2.5 py-0.5 rounded border border-slate-200 shadow-xs flex items-center select-none" title="Hidden for security — dispatched via Email & MQTT">
                        <i class="bi bi-shield-lock-fill text-slate-400 mr-1.5 text-xs"></i>••••
                    </span>
                </div>
            </div>
        </div>
    `;
}

function renderOtpRequests(requests) {
    const list = qs("#otp-requests-list");
    const fullList = qs("#full-requests-list");
    const countBadge = qs("#otp-request-count");

    const allRequests = requests || [];
    const pendingRequests = allRequests.filter(req => req.status === "Pending");
    const sentRequests = allRequests.filter(req => req.status !== "Pending");

    if (countBadge) countBadge.textContent = pendingRequests.length;

    // Full requests list (Pending Access Requests page) — ONLY Pending requests
    if (fullList) {
        fullList.innerHTML = pendingRequests.length === 0
            ? `<div class="text-slate-400 text-xs py-10 text-center flex flex-col items-center justify-center space-y-2">
                <i class="bi bi-inbox text-3xl text-slate-300"></i>
                <p class="mb-0 font-medium text-slate-500">No pending access requests in the queue.</p>
                <span class="text-[11px] text-slate-400">Incoming dual-key requests from hardware will appear here live.</span>
              </div>`
            : pendingRequests.map(req => createRequestCardHtml(req)).join("");
    }

    // Online OTP page list — ONLY Sent / Dispatched OTP requests
    if (list) {
        list.innerHTML = sentRequests.length === 0
            ? `<div class="text-slate-400 text-xs py-10 text-center flex flex-col items-center justify-center space-y-2">
                <i class="bi bi-send-check text-3xl text-slate-300"></i>
                <p class="mb-0 font-medium text-slate-500">No sent OTP requests in the log.</p>
                <span class="text-[11px] text-slate-400">Dual-key OTP actions dispatched to devices will appear here.</span>
              </div>`
            : sentRequests.map(req => createRequestCardHtml(req)).join("");
    }

    renderOverviewDashboard();
    // Also update the device-specific OTP request panel if a device is selected
    if (state.selectedDeviceId) {
        renderDeviceOtpRequestList(state.selectedDeviceId);
    }
}

window.fastProcessRequest = async function(requestId, btnEl) {
    if (!requestId) return;
    let originalHtml = '';
    if (btnEl) {
        originalHtml = btnEl.innerHTML;
        btnEl.disabled = true;
        btnEl.innerHTML = `<i class="bi bi-arrow-repeat animate-spin mr-1"></i> Authorizing...`;
    }
    try {
        const res = await api(`/api/camera/requests/${requestId}/process`, { method: "POST" });
        if (res && res.success) {
            showToast("Fast Process Complete", `Device ${res.device_name}: Dual OTP authorized and dispatched via Email & MQTT!`, "success");
            await loadOtpRequests();
        } else {
            showToast("Error", res?.message || "Failed to process request", "danger");
        }
    } catch (err) {
        showToast("Error", err.message || "Failed to process request", "danger");
    } finally {
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = originalHtml;
        }
    }
};

window.processAllRequests = async function(btnEl) {
    let originalHtml = '';
    if (btnEl) {
        originalHtml = btnEl.innerHTML;
        btnEl.disabled = true;
        btnEl.innerHTML = `<i class="bi bi-arrow-repeat animate-spin mr-1"></i> Processing All...`;
    }
    try {
        const res = await api("/api/camera/requests/process-all", { method: "POST" });
        if (res && res.success) {
            if (res.count > 0) {
                showToast("Batch Fast Process Complete", `Successfully authorized ${res.count} request(s)!`, "success");
            } else {
                showToast("Queue Empty", "No pending requests in queue.", "info");
            }
            await loadOtpRequests();
        } else {
            showToast("Error", res?.message || "Failed to batch process requests", "danger");
        }
    } catch (err) {
        showToast("Error", err.message || "Failed to batch process requests", "danger");
    } finally {
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = originalHtml;
        }
    }
};

window.loadOtpRequests = loadOtpRequests;
window.renderOtpRequests = renderOtpRequests;

// ══════════════════════════════════════════
//  ONLINE OTP MANAGEMENT PAGE
// ══════════════════════════════════════════

let _onlineOtpSelectedDeviceId = null;
let _onlineOtpPollingInterval = null;

async function loadOnlineOtpPage() {
    // Load devices for dropdown + status grid
    try {
        state.devices = await api("/api/devices/");
    } catch (e) {
        console.warn("Failed to load devices for online OTP:", e);
    }

    // Populate device dropdown
    const deviceSelect = qs("#online-otp-device-select");
    if (deviceSelect && state.devices) {
        deviceSelect.innerHTML = '<option value="">— Select Device —</option>' +
            state.devices.map(d => `<option value="${d.id}">${escapeHtml(d.name)} — ${escapeHtml(d.location || 'No Location')}</option>`).join("");
    }

    // Render device status grid
    renderOnlineOtpDeviceGrid();

    // Load OTP requests
    await loadOtpRequests();

    // Update stats
    updateOnlineOtpStats();

    // Auto-select device: pending device first, else first live/available device
    if (state.devices && state.devices.length > 0) {
        if (!_onlineOtpSelectedDeviceId || !state.devices.some(d => d.id === _onlineOtpSelectedDeviceId)) {
            const pendingDev = state.devices.find(d => (state.otpRequests || []).some(r => r.device_id === d.id && r.status === "Pending"));
            _onlineOtpSelectedDeviceId = pendingDev ? pendingDev.id : state.devices[0].id;
        }
        if (deviceSelect) {
            deviceSelect.value = String(_onlineOtpSelectedDeviceId);
        }
        await loadLastAcknowledgment(_onlineOtpSelectedDeviceId);
        updateOnlineOtpSendButton();
    }

    // Wire device select change
    if (deviceSelect && !deviceSelect._onlineOtpWired) {
        deviceSelect._onlineOtpWired = true;
        deviceSelect.addEventListener("change", async () => {
            _onlineOtpSelectedDeviceId = deviceSelect.value ? parseInt(deviceSelect.value) : null;
            updateOnlineOtpSendButton();
            if (_onlineOtpSelectedDeviceId) {
                await loadLastAcknowledgment(_onlineOtpSelectedDeviceId);
            } else {
                const ackContainer = qs("#last-ack-container");
                if (ackContainer) {
                    ackContainer.innerHTML = `<div class="text-center py-4 text-slate-400 text-xs">
                        <i class="bi bi-clock text-lg block mb-2 opacity-40"></i>
                        Select a device above to view its last request & acknowledgment.
                    </div>`;
                }
            }
        });
    }

    // Wire send button
    const sendBtn = qs("#online-otp-send-btn");
    if (sendBtn && !sendBtn._onlineOtpWired) {
        sendBtn._onlineOtpWired = true;
        sendBtn.addEventListener("click", onlineOtpSendAction);
    }

    // Wire refresh last ack
    const refreshAckBtn = qs("#refresh-last-ack-btn");
    if (refreshAckBtn && !refreshAckBtn._onlineOtpWired) {
        refreshAckBtn._onlineOtpWired = true;
        refreshAckBtn.addEventListener("click", async () => {
            if (_onlineOtpSelectedDeviceId) {
                await loadLastAcknowledgment(_onlineOtpSelectedDeviceId);
            }
        });
    }

    // Start polling
    if (_onlineOtpPollingInterval) clearInterval(_onlineOtpPollingInterval);
    _onlineOtpPollingInterval = setInterval(async () => {
        if (document.hidden) return;
        await loadOtpRequests();
        updateOnlineOtpStats();
        renderOnlineOtpDeviceGrid();
        if (_onlineOtpSelectedDeviceId) {
            await loadLastAcknowledgment(_onlineOtpSelectedDeviceId);
        }
    }, 5000);
}
window.loadOnlineOtpPage = loadOnlineOtpPage;

function updateOnlineOtpStats() {
    const devices = state.devices || [];
    const requests = state.otpRequests || [];

    const totalDevices = devices.length;
    const onlineDevices = devices.filter(d => d.is_online !== false).length;
    const pendingCount = requests.filter(r => r.status === "Pending").length;
    const ackedCount = requests.filter(r => r.status === "Acknowledged").length;

    const onlineEl = qs("#online-devices-count");
    if (onlineEl) onlineEl.textContent = `${onlineDevices} / ${totalDevices}`;
    const onlineDetailEl = qs("#online-devices-detail");
    if (onlineDetailEl) onlineDetailEl.textContent = `${totalDevices - onlineDevices} offline`;

    const pendingEl = qs("#pending-requests-count");
    if (pendingEl) pendingEl.textContent = String(pendingCount);
    const pendingDetailEl = qs("#pending-requests-detail");
    if (pendingDetailEl) pendingDetailEl.textContent = pendingCount > 0 ? `${pendingCount} awaiting authorization` : "Queue empty";

    const ackedEl = qs("#acked-requests-count");
    if (ackedEl) ackedEl.textContent = String(ackedCount);
    const ackedDetailEl = qs("#acked-requests-detail");
    if (ackedDetailEl) ackedDetailEl.textContent = `${ackedCount} dispatched`;
}

function renderOnlineOtpDeviceGrid() {
    const grid = qs("#online-otp-device-grid");
    if (!grid) return;

    const devices = state.devices || [];
    if (devices.length === 0) {
        grid.innerHTML = `<div class="text-center py-4 text-slate-400 text-xs col-span-full">
            <i class="bi bi-cpu text-2xl block mb-2 opacity-40"></i>
            No devices registered.
        </div>`;
        return;
    }

    grid.innerHTML = devices.map(d => {
        const isOnline = d.is_online !== false;
        const pendingForDevice = (state.otpRequests || []).filter(r => r.device_id === d.id && r.status === "Pending").length;

        return `
            <div class="bg-slate-50 border ${pendingForDevice > 0 ? 'border-amber-300 ring-1 ring-amber-100' : 'border-slate-200'} rounded-xl p-3.5 transition hover:shadow-md cursor-pointer" onclick="const sel = document.getElementById('online-otp-device-select'); if (sel) { sel.value='${d.id}'; sel.dispatchEvent(new Event('change')); }">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-xs font-bold text-slate-900 truncate flex items-center">
                        <i class="bi bi-cpu-fill ${isOnline ? 'text-emerald-500' : 'text-rose-400'} mr-1.5"></i>
                        ${escapeHtml(d.name)}
                    </span>
                    <span class="${isOnline ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-rose-100 text-rose-700 border-rose-200'} px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase inline-flex items-center">
                        <i class="bi bi-circle-fill ${isOnline ? 'text-emerald-500' : 'text-rose-500'} mr-1 text-[7px]"></i>${isOnline ? 'Live' : 'Off'}
                    </span>
                </div>
                <div class="text-[10px] text-slate-500 truncate">
                    <i class="bi bi-geo-alt mr-1 text-slate-400"></i>${escapeHtml(d.location || 'No location')}
                </div>
                <div class="mt-2.5 pt-2 border-t border-slate-200/60 flex items-center justify-between">
                    ${pendingForDevice > 0 ? `
                        <span class="text-[9px] text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full font-bold flex items-center">
                            <span class="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1 animate-pulse"></span>${pendingForDevice} pending
                        </span>` : `
                        <span class="text-[10px] text-slate-400">Click to view log</span>
                    `}
                    <a href="/devices?device=${d.id}" onclick="event.stopPropagation();" class="text-[10px] font-semibold text-sky-600 hover:text-sky-700 flex items-center">
                        Console <i class="bi bi-box-arrow-up-right ml-1 text-[9px]"></i>
                    </a>
                </div>
            </div>
        `;
    }).join("");
}

function updateOnlineOtpSendButton() {
    const sendBtn = qs("#online-otp-send-btn");
    const hintEl = qs("#online-otp-hint");
    const modeSelect = qs("#online-otp-mode-select");
    const mode = modeSelect ? modeSelect.value : "no_threat";

    if (!_onlineOtpSelectedDeviceId) {
        if (sendBtn) sendBtn.disabled = true;
        if (hintEl) hintEl.innerHTML = '<i class="bi bi-info-circle mr-1"></i> Select a device to send an OTP action';
        return;
    }

    // Offline OTP mode: always enabled
    if (mode === "offline_otp") {
        if (sendBtn) sendBtn.disabled = false;
        if (hintEl) hintEl.innerHTML = '<i class="bi bi-key text-purple-600 mr-1"></i> Offline OTP ready — Email only (MQTT bypassed)';
        return;
    }

    // Check if device has pending requests
    const deviceRequests = (state.otpRequests || []).filter(
        r => r.device_id === _onlineOtpSelectedDeviceId && r.status === "Pending"
    );

    if (deviceRequests.length > 0) {
        if (sendBtn) sendBtn.disabled = false;
        if (hintEl) hintEl.innerHTML = `<i class="bi bi-check-circle text-emerald-600 mr-1"></i> ${deviceRequests.length} active request(s) — Ready to send`;
    } else {
        // Allow send even without pending requests for direct authorization
        if (sendBtn) sendBtn.disabled = false;
        if (hintEl) hintEl.innerHTML = '<i class="bi bi-send text-sky-600 mr-1"></i> Direct authorization — No pending MQTT request';
    }
}

// Wire mode change
document.addEventListener("DOMContentLoaded", () => {
    const modeSelect = qs("#online-otp-mode-select");
    if (modeSelect) {
        modeSelect.addEventListener("change", updateOnlineOtpSendButton);
    }
});

async function onlineOtpSendAction() {
    if (!_onlineOtpSelectedDeviceId) {
        showToast("Please select a device first", "error");
        return;
    }

    const sendBtn = qs("#online-otp-send-btn");
    const statusEl = qs("#online-otp-action-status");
    const modeSelect = qs("#online-otp-mode-select");
    const mode = modeSelect ? modeSelect.value : "no_threat";

    const origHtml = sendBtn ? sendBtn.innerHTML : "";
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<i class="bi bi-arrow-repeat animate-spin mr-1.5"></i> Sending...';
    }
    if (statusEl) statusEl.innerHTML = '<i class="bi bi-circle-fill text-amber-500 mr-1" style="font-size:8px;animation:livePulse 1s infinite;"></i> <span class="text-amber-600">Processing...</span>';

    try {
        const result = await api(`/api/camera/${_onlineOtpSelectedDeviceId}/send-action`, {
            method: "POST",
            body: JSON.stringify({ mode }),
        });

        // Show toast
        if (mode === "thread") {
            const emailStatus = result.email_sent ? "Email dispatched!" : "Email not configured";
            showToast(`Thread: OTP generated. ${emailStatus}`, result.email_sent ? "success" : "info");
        } else if (mode === "no_threat") {
            showToast(`NO THREAT: Dual OTP dispatched to ${result.user1_username || "User 1"} & ${result.user2_username || "User 2"} via Email & MQTT`, "success");
        } else if (mode === "offline_otp") {
            showToast(`OFFLINE OTP: Sent to ${result.user1_username || "User 1"} & ${result.user2_username || "User 2"} (Email Only)`, "success");
        }

        // Refresh
        await loadOtpRequests();
        updateOnlineOtpStats();
        renderOnlineOtpDeviceGrid();
        if (_onlineOtpSelectedDeviceId) {
            await loadLastAcknowledgment(_onlineOtpSelectedDeviceId);
        }

        if (statusEl) statusEl.innerHTML = '<i class="bi bi-check-circle-fill text-emerald-600 mr-1" style="font-size:10px;"></i> <span class="text-emerald-600">Sent!</span>';
    } catch (err) {
        showToast(err.message || "Failed to send action", "error");
        if (statusEl) statusEl.innerHTML = '<i class="bi bi-x-circle-fill text-rose-600 mr-1" style="font-size:10px;"></i> <span class="text-rose-600">Failed</span>';
    } finally {
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = origHtml;
        }
        updateOnlineOtpSendButton();
        setTimeout(() => {
            if (statusEl) statusEl.innerHTML = '<i class="bi bi-circle-fill text-slate-400 mr-1" style="font-size:8px;"></i> <span class="text-slate-400">Ready</span>';
        }, 5000);
    }
}

async function loadLastAcknowledgment(deviceId) {
    const container = qs("#last-ack-container");
    if (!container) return;

    container.innerHTML = `<div class="text-center py-3 text-slate-400 text-xs">
        <i class="bi bi-arrow-repeat animate-spin text-sm"></i> Loading...
    </div>`;

    try {
        const data = await api(`/api/camera/${deviceId}/last-acknowledgment`);
        const device = (state.devices || []).find(d => d.id === deviceId);
        const deviceName = device ? device.name : `Device #${deviceId}`;

        if (!data.has_ack) {
            container.innerHTML = `
                <div class="bg-slate-50 border border-slate-200 rounded-lg p-4 text-center">
                    <i class="bi bi-clock text-xl text-slate-400 block mb-2"></i>
                    <p class="text-xs text-slate-500 font-medium">${escapeHtml(deviceName)}</p>
                    <p class="text-[11px] text-slate-400 mt-1">No recent OTP requests or acknowledgments.</p>
                </div>`;
            return;
        }

        const typeLabels = {
            "otp_request": { label: "MQTT OTP Request", icon: "bi-broadcast", color: "amber" },
            "otp_request_ack": { label: "Acknowledged", icon: "bi-check-circle-fill", color: "emerald" },
            "no_threat": { label: "No Threat Authorized", icon: "bi-shield-check", color: "sky" },
            "thread": { label: "Thread OTP", icon: "bi-lock-fill", color: "purple" },
            "offline_otp": { label: "Offline OTP Sent", icon: "bi-key-fill", color: "violet" }
        };
        const typeInfo = typeLabels[data.message_type] || { label: data.message_type, icon: "bi-info-circle", color: "slate" };
        const payload = data.payload || {};
        const timeStr = new Date(data.created_at).toLocaleString();

        let deliveryHtml = "";
        if (payload.email_sent1 || payload.email_sent2 || payload.email_sent) {
            deliveryHtml += '<span class="text-emerald-600 font-medium mr-2"><i class="bi bi-envelope-check mr-0.5"></i> Email</span>';
        }
        if (payload.whatsapp_sent1 || payload.whatsapp_sent2 || payload.whatsapp_sent) {
            deliveryHtml += '<span class="text-emerald-600 font-medium mr-2"><i class="bi bi-whatsapp mr-0.5"></i> WhatsApp</span>';
        }
        if (payload.mqtt_published) {
            deliveryHtml += `<span class="text-sky-600 font-medium"><i class="bi bi-broadcast mr-0.5"></i> MQTT (${escapeHtml(payload.mqtt_topic || '')})</span>`;
        }

        container.innerHTML = `
            <div class="bg-${typeInfo.color}-50 border border-${typeInfo.color}-200 rounded-xl p-4 space-y-3">
                <div class="flex items-center justify-between">
                    <div class="flex items-center space-x-2">
                        <span class="bg-${typeInfo.color}-100 text-${typeInfo.color}-700 border border-${typeInfo.color}-300 px-2.5 py-0.5 rounded-full text-[10px] font-bold flex items-center">
                            <i class="bi ${typeInfo.icon} mr-1"></i> ${escapeHtml(typeInfo.label)}
                        </span>
                        <span class="text-xs font-bold text-slate-900">${escapeHtml(deviceName)}</span>
                    </div>
                    <span class="text-[10px] text-slate-400 font-mono">
                        <i class="bi bi-clock mr-0.5"></i> ${escapeHtml(timeStr)}
                    </span>
                </div>

                <div class="text-xs text-slate-600 bg-white rounded-lg border border-slate-200 p-3">
                    ${escapeHtml(data.content || 'No details available')}
                </div>

                ${(payload.recipient1 || payload.recipient2) ? `
                <div class="grid grid-cols-2 gap-3">
                    ${payload.recipient1 ? `
                    <div class="bg-white rounded-lg border border-slate-200 p-2.5">
                        <div class="text-[10px] text-slate-400 font-bold uppercase mb-1">1st User</div>
                        <div class="text-xs font-semibold text-emerald-700">${escapeHtml(payload.recipient1)}</div>
                        ${payload.recipient1_email ? `<div class="text-[10px] text-slate-500 truncate">${escapeHtml(payload.recipient1_email)}</div>` : ''}
                    </div>` : ''}
                    ${payload.recipient2 ? `
                    <div class="bg-white rounded-lg border border-slate-200 p-2.5">
                        <div class="text-[10px] text-slate-400 font-bold uppercase mb-1">2nd User</div>
                        <div class="text-xs font-semibold text-sky-700">${escapeHtml(payload.recipient2)}</div>
                        ${payload.recipient2_email ? `<div class="text-[10px] text-slate-500 truncate">${escapeHtml(payload.recipient2_email)}</div>` : ''}
                    </div>` : ''}
                </div>` : ''}

                ${(payload.otp1 || payload.otp2) ? `
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    ${payload.otp1 ? `
                    <div class="flex items-center justify-between bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg text-xs shadow-xs">
                        <span class="text-[11px] text-slate-700 font-semibold truncate mr-2 flex items-center">
                            <i class="bi bi-key-fill text-emerald-600 mr-1.5"></i>1st OTP (${escapeHtml(payload.recipient1 || 'User 1')}):
                        </span>
                        <span class="font-mono font-extrabold text-emerald-700 tracking-widest text-sm bg-white px-2.5 py-0.5 rounded border border-emerald-300 shadow-xs">${escapeHtml(String(payload.otp1))}</span>
                    </div>` : ''}
                    ${payload.otp2 ? `
                    <div class="flex items-center justify-between bg-sky-50 border border-sky-200 px-3 py-2 rounded-lg text-xs shadow-xs">
                        <span class="text-[11px] text-slate-700 font-semibold truncate mr-2 flex items-center">
                            <i class="bi bi-key-fill text-sky-600 mr-1.5"></i>2nd OTP (${escapeHtml(payload.recipient2 || 'User 2')}):
                        </span>
                        <span class="font-mono font-extrabold text-sky-700 tracking-widest text-sm bg-white px-2.5 py-0.5 rounded border border-sky-300 shadow-xs">${escapeHtml(String(payload.otp2))}</span>
                    </div>` : ''}
                </div>` : ''}

                ${deliveryHtml ? `
                <div class="flex items-center text-[11px] pt-2 border-t border-${typeInfo.color}-200/50">
                    <span class="text-slate-500 font-medium mr-2">Delivery:</span>
                    ${deliveryHtml}
                </div>` : ''}
            </div>`;
    } catch (err) {
        container.innerHTML = `<div class="text-center py-3 text-rose-400 text-xs">
            <i class="bi bi-exclamation-circle block mb-1"></i> Failed to load: ${escapeHtml(err.message)}
        </div>`;
    }
}

function updateSendButtonState() {
    const btn = qs("#send-action-btn");
    if (!btn) return;

    if (btn.classList.contains("sending")) return;

    const modeEl = document.getElementById("mode-dropdown");
    const currentMode = modeEl ? modeEl.value : "no_threat";
    const hint = qs(".mode-action-hint");

    if (!state.selectedDeviceId) {
        btn.disabled = true;
        btn.className = "flex-1 py-2 bg-slate-200 text-slate-400 rounded text-xs font-semibold shadow-xs cursor-not-allowed";
        btn.innerHTML = '<i class="bi bi-send mr-1.5"></i> Send Action';
        if (hint) {
            hint.innerHTML = `<i class="bi bi-info-circle mr-1"></i> Select a camera device first`;
            hint.className = "mode-action-hint text-slate-400 text-[10px]";
        }
        renderDeviceOtpRequestList(null);
        return;
    }

    // OFFLINE OTP mode: always enabled anytime regardless of pending device request
    if (currentMode === "offline_otp") {
        btn.disabled = false;
        btn.className = "flex-1 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs font-semibold shadow-xs transition cursor-pointer";
        btn.innerHTML = '<i class="bi bi-key-fill mr-1.5"></i> Send Offline OTP (Anytime)';
        if (hint) {
            hint.innerHTML = `<i class="bi bi-check-circle-fill text-purple-600 mr-1"></i> Offline OTP Ready — Send anytime via Email`;
            hint.className = "mode-action-hint text-purple-600 text-[10px]";
        }
        renderDeviceOtpRequestList(state.selectedDeviceId);
        return;
    }

    // THREAT mode: always enabled when device selected — operator flags threat, access denied, NO OTP sent
    if (currentMode === "threat" || currentMode === "thread") {
        btn.disabled = false;
        btn.className = "flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-semibold shadow-xs transition cursor-pointer";
        btn.innerHTML = '<i class="bi bi-shield-slash-fill mr-1.5"></i> Deny Access (Threat — No OTP)';
        if (hint) {
            hint.innerHTML = `<i class="bi bi-shield-x text-rose-600 mr-1 font-bold"></i> THREAT: Access will be denied & NO OTP will be sent`;
            hint.className = "mode-action-hint text-rose-600 text-[10px] font-semibold";
        }
        renderDeviceOtpRequestList(state.selectedDeviceId);
        return;
    }

    // NO THREAT mode: sends Dual OTP and acknowledges incoming requests
    const deviceRequests = (state.otpRequests || []).filter(
        req => req.device_id === state.selectedDeviceId &&
               req.status === "Pending"
    );

    btn.disabled = false;
    btn.className = "flex-1 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded text-xs font-semibold shadow-xs transition cursor-pointer";
    btn.innerHTML = '<i class="bi bi-send-check-fill mr-1.5"></i> Send Dual OTP (No Threat)';

    if (deviceRequests.length > 0) {
        if (hint) {
            hint.innerHTML = `<i class="bi bi-check-circle-fill text-emerald-600 mr-1 font-bold"></i> ${deviceRequests.length} Active Request(s) — Ready to Dispatch Dual OTP & Acknowledge`;
            hint.className = "mode-action-hint text-emerald-600 text-[10px]";
        }
    } else {
        if (hint) {
            hint.innerHTML = `<i class="bi bi-info-circle text-sky-600 mr-1"></i> Direct Authorization — Ready to Dispatch Dual OTP`;
            hint.className = "mode-action-hint text-sky-600 text-[10px]";
        }
    }

    renderDeviceOtpRequestList(state.selectedDeviceId);
}

// ── Render OTP Request List for selected device (Devices page) ──
function renderDeviceOtpRequestList(deviceId) {
    const container = qs("#device-otp-requests-list");
    if (!container) return;

    const allPending = (state.otpRequests || []).filter(r => r.status === "Pending");

    if (!deviceId) {
        if (allPending.length === 0) {
            container.innerHTML = `<div class="text-center py-3 text-slate-400 text-[11px]"><i class="bi bi-info-circle mr-1"></i>Select a device from the left to view its pending requests.</div>`;
        } else {
            container.innerHTML = `
                <div class="text-[10px] text-amber-700 font-semibold mb-1.5 flex items-center justify-between">
                    <span><i class="bi bi-bell-fill text-amber-500 mr-1"></i>${allPending.length} Active Pending Request(s) across devices:</span>
                </div>
                <div class="space-y-1.5">
                    ${allPending.map(req => {
                        const timeStr = formatTime(req.created_at);
                        const devName = req.device_name || `Device #${req.device_id}`;
                        return `
                            <div class="bg-amber-50/80 hover:bg-amber-100 border border-amber-200 rounded-lg p-2 transition cursor-pointer" onclick="if(typeof selectDevice === 'function') selectDevice(${req.device_id})">
                                <div class="flex items-center justify-between">
                                    <span class="text-[11px] font-bold text-slate-900 flex items-center">
                                        <i class="bi bi-shield-lock text-amber-600 mr-1"></i>${escapeHtml(devName)}
                                    </span>
                                    <span class="text-[9px] text-amber-700 bg-amber-100 border border-amber-300 px-1.5 py-0.2 rounded-full font-bold">
                                        Pending
                                    </span>
                                </div>
                                <div class="text-[10px] text-slate-500 flex items-center justify-between mt-1">
                                    <span><i class="bi bi-clock mr-1 text-slate-400"></i>${timeStr}</span>
                                    <span class="text-[10px] text-sky-600 font-semibold flex items-center"><i class="bi bi-arrow-right mr-0.5"></i> Select Device</span>
                                </div>
                            </div>
                        `;
                    }).join("")}
                </div>
            `;
        }
        return;
    }

    const requests = allPending.filter(r => r.device_id === deviceId);

    if (requests.length === 0) {
        container.innerHTML = `
            <div class="bg-white/80 border border-slate-200 rounded-lg p-3 text-center text-slate-500 text-xs flex flex-col items-center justify-center space-y-1">
                <i class="bi bi-shield-check text-emerald-500 text-base"></i>
                <span class="font-medium">No pending incoming OTP requests for this device.</span>
                <span class="text-[10px] text-slate-400">You can still send Offline OTP anytime or issue direct authorization below.</span>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="space-y-2">
            ${requests.map(req => {
                const timeStr = formatTime(req.created_at);
                const devName = req.device_name || `Device #${req.device_id}`;
                const u1 = req.recipient1 || req.payload?.recipient1 || "1st User";
                const u2 = req.recipient2 || req.payload?.recipient2 || "2nd User";
                return `
                    <div class="bg-amber-50/90 border border-amber-300 rounded-lg p-3 space-y-2 shadow-xs">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-bold text-slate-900 flex items-center">
                                <i class="bi bi-broadcast-pin text-amber-600 mr-1.5"></i>
                                Incoming Access Request #${req.id}
                            </span>
                            <span class="text-[10px] text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full font-bold flex items-center">
                                <span class="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1 animate-pulse"></span>PENDING OPERATOR ACTION
                            </span>
                        </div>
                        <div class="text-[11px] text-slate-600 grid grid-cols-2 gap-1 bg-white/70 p-2 rounded border border-amber-200/60">
                            <div><span class="text-slate-400">Target:</span> <strong class="text-slate-800">${escapeHtml(devName)}</strong></div>
                            <div><span class="text-slate-400">Time:</span> <strong class="text-slate-800">${timeStr}</strong></div>
                            <div><span class="text-slate-400">1st User:</span> ${escapeHtml(u1)}</div>
                            <div><span class="text-slate-400">2nd User:</span> ${escapeHtml(u2)}</div>
                        </div>
                        <div class="text-[10px] text-amber-800 flex items-center">
                            <i class="bi bi-info-circle-fill mr-1 text-amber-600"></i>
                            Select <strong>NO THREAT</strong> below to dispatch Dual OTP, or <strong>THREAT</strong> to deny access without OTP.
                        </div>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}
window.renderDeviceOtpRequestList = renderDeviceOtpRequestList;

// ── Request OTP for camera from RTSP grid ──
window.requestOtpForCamera = function(deviceId) {
    // Navigate to devices page and auto-select the device to send OTP action
    window.location.href = `/devices?device=${deviceId}`;
};

// ══════════════════════════════════════════
//  DYNAMIC DASHBOARD & RTSP GRID RENDERING
// ══════════════════════════════════════════

function renderOverviewDashboard() {
    const devices = state.devices || [];
    const requests = state.otpRequests || [];

    // 1. Calculate Real Statistics
    const totalDevices = devices.length;
    const onlineDevices = devices.filter(d => d.is_online !== false).length;
    const offlineDevices = totalDevices - onlineDevices;

    const statDevicesCount = qs("#stat-devices-count");
    if (statDevicesCount) statDevicesCount.textContent = `${onlineDevices}/${totalDevices}`;

    const statDevicesOffline = qs("#stat-devices-offline");
    if (statDevicesOffline) statDevicesOffline.textContent = `${offlineDevices} offline`;

    const statPendingCount = qs("#stat-pending-count");
    if (statPendingCount) statPendingCount.textContent = String(requests.length);

    const statAlertsCount = qs("#stat-alerts-count");
    if (statAlertsCount) statAlertsCount.textContent = String(offlineDevices);

    const statAlertsSub = qs("#stat-alerts-sub");
    if (statAlertsSub) statAlertsSub.textContent = offlineDevices > 0 ? `${offlineDevices} critical` : "System healthy";

    const statCamerasCount = qs("#stat-cameras-count");
    if (statCamerasCount) statCamerasCount.textContent = `${onlineDevices}/${totalDevices}`;

    // 2. Real Fleet Table
    const fleetBody = qs("#fleet-table-body");
    if (fleetBody) {
        if (devices.length === 0) {
            fleetBody.innerHTML = `
                <tr>
                    <td colspan="5" class="py-8 text-center text-slate-400 text-xs">
                        <i class="bi bi-camera-video-off text-2xl block mb-2 opacity-40"></i>
                        No devices registered in database.
                        <div class="mt-2">
                            <button onclick="switchTab('devices'); document.getElementById('add-device-btn')?.click()" class="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded text-xs font-semibold shadow-xs">
                                <i class="bi bi-plus-lg mr-1"></i> Add Device
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        } else {
            fleetBody.innerHTML = devices.map(d => {
                const isOnline = d.is_online !== false;
                return `
                    <tr class="hover:bg-slate-50 transition">
                        <td class="py-3 px-2 font-semibold text-slate-900">
                            ${escapeHtml(d.name)}
                        </td>
                        <td class="py-3 px-2">
                            <span class="${isOnline ? 'badge-online' : 'badge-offline'} inline-flex items-center">
                                <i class="bi bi-circle-fill mr-1 text-[7px]"></i>${isOnline ? 'Online' : 'Offline'}
                            </span>
                        </td>
                        <td class="py-3 px-2">
                            <span class="badge-locked">Locked</span>
                        </td>
                        <td class="py-3 px-2 text-slate-500 font-medium">
                            ${escapeHtml(d.location || '—')}
                        </td>
                        <td class="py-3 px-2 text-right">
                            <button onclick="expandCamera(${d.id})" class="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded text-xs font-semibold border border-sky-200 transition">
                                <i class="bi bi-play-circle mr-1"></i> Stream
                            </button>
                        </td>
                    </tr>
                `;
            }).join("");
        }
    }

    // 3. Real Security Alerts
    renderDashboardRecentAlerts(_allSecurityAlerts);

    // 4. Real Pending Authorizations
    const pendingList = qs("#pending-authorizations-list");
    if (pendingList) {
        if (requests.length === 0) {
            pendingList.innerHTML = `<div class="text-center py-4 text-slate-400 text-xs">No pending authorizations awaiting review.</div>`;
        } else {
            pendingList.innerHTML = requests.map(r => `
                <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-bold text-slate-900">${escapeHtml(r.device_name || `Device #${r.device_id}`)}</span>
                        <span class="badge-pending">Pending</span>
                    </div>
                    <p class="text-[11px] text-slate-600">${escapeHtml(r.content || 'Dual OTP Authorization Request')}</p>
                    <div class="flex items-center justify-end space-x-2 pt-1 border-t border-slate-200/60">
                        <button onclick="window.selectDevice(${r.device_id}); switchTab('devices')" class="px-2.5 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded text-[11px] font-semibold">
                            Authorize / Send
                        </button>
                    </div>
                </div>
            `).join("");
        }
    }

    // 5. Live Event Logs
    const eventFeed = qs("#live-event-feed");
    const auditBody = qs("#audit-table-body");
    if (devices.length > 0) {
        const timeNow = new Date().toLocaleTimeString();
        if (eventFeed) {
            eventFeed.innerHTML = devices.map(d => `
                <div class="flex justify-between"><span>${timeNow} heartbeat ${escapeHtml(d.name)}</span><span class="text-emerald-600">ok</span></div>
            `).join("");
        }
        if (auditBody) {
            auditBody.innerHTML = devices.map(d => `
                <tr>
                    <td class="py-2.5 px-3 text-slate-500">${new Date().toISOString().slice(0, 19).replace('T', ' ')}</td>
                    <td class="py-2.5 px-3"><span class="badge-online font-sans">HEARTBEAT</span></td>
                    <td class="py-2.5 px-3 font-semibold text-slate-900 font-sans">${escapeHtml(d.name)}</td>
                    <td class="py-2.5 px-3 font-sans">${escapeHtml(d.location || 'Fleet System')}</td>
                    <td class="py-2.5 px-3 text-emerald-600 font-bold">200 OK</td>
                </tr>
            `).join("");
        }
    } else {
        if (eventFeed) eventFeed.innerHTML = '<div class="text-slate-400 text-center py-2">No active devices logged yet.</div>';
        if (auditBody) auditBody.innerHTML = '<tr><td colspan="5" class="py-6 text-center text-slate-400 font-sans">No audit events recorded yet.</td></tr>';
    }
}
window.renderOverviewDashboard = renderOverviewDashboard;

function renderRtspSkeletonLoading(count = 6) {
    const grid = qs("#camera-tiles-grid");
    if (!grid) return;
    let skeletonHtml = "";
    for (let i = 0; i < count; i++) {
        skeletonHtml += `
            <div class="camera-skeleton-card bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs flex flex-col">
                <div class="relative bg-slate-950 aspect-video overflow-hidden flex flex-col items-center justify-center skeleton-shimmer-dark">
                    <div class="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800/80 flex items-center justify-center text-slate-500 mb-2.5 shadow-inner">
                        <i class="bi bi-camera-video text-xl text-slate-400"></i>
                    </div>
                    <div class="h-2.5 w-32 bg-slate-800/90 rounded-full mb-1.5"></div>
                    <div class="h-2 w-20 bg-slate-800/50 rounded-full"></div>
                    <div class="absolute top-2.5 left-2.5 h-5 w-20 bg-slate-900/90 rounded border border-slate-800/70"></div>
                    <div class="absolute top-2.5 right-2.5 h-6 w-14 bg-slate-900/90 rounded border border-slate-800/70"></div>
                </div>
                <div class="p-4 space-y-3 bg-white flex-1 flex flex-col justify-between">
                    <div class="space-y-2.5">
                        <div class="h-3.5 w-36 bg-slate-200 rounded skeleton-shimmer"></div>
                        <div class="h-2.5 w-48 bg-slate-100 rounded skeleton-shimmer"></div>
                        <div class="flex items-center justify-between pt-1">
                            <div class="h-2.5 w-24 bg-slate-100 rounded skeleton-shimmer"></div>
                            <div class="h-2.5 w-16 bg-slate-100 rounded skeleton-shimmer"></div>
                        </div>
                    </div>
                    <div class="pt-2.5 border-t border-slate-100 flex items-center">
                        <div class="h-8 w-full bg-slate-200 rounded-lg skeleton-shimmer"></div>
                    </div>
                </div>
            </div>
        `;
    }
    grid.innerHTML = skeletonHtml;
}
window.renderRtspSkeletonLoading = renderRtspSkeletonLoading;

function renderLiveRtspGrid() {
    const grid = qs("#camera-tiles-grid");
    if (!grid) return;

    let devices = state.devices || [];
    if (selectedSiteFilter !== "all") {
        if (selectedSiteFilter.startsWith("bank_")) {
            const bId = parseInt(selectedSiteFilter.replace("bank_", ""));
            devices = devices.filter(d => d.bank_id === bId);
        } else if (selectedSiteFilter.startsWith("branch_")) {
            const brId = parseInt(selectedSiteFilter.replace("branch_", ""));
            devices = devices.filter(d => d.branch_id === brId);
        }
    }

    if (devices.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-400">
                <i class="bi bi-camera-video-off text-4xl block mb-2 opacity-40"></i>
                <h3 class="text-sm font-bold text-slate-800 mb-1">No Cameras Found</h3>
                <p class="text-xs text-slate-500 max-w-sm mx-auto mb-4">${selectedSiteFilter !== "all" ? "No cameras match the selected site filter." : "Add your surveillance cameras and RTSP stream URLs to monitor feeds in real time."}</p>
                <div class="flex items-center justify-center space-x-3">
                    ${selectedSiteFilter !== "all" ? `<button onclick="window.resetSiteFilter()" class="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold">Show All Cameras</button>` : ''}
                    <button onclick="switchTab('devices'); window.openAddDeviceModal?.()" class="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-semibold shadow-xs">
                        <i class="bi bi-plus-lg mr-1.5"></i> Register Camera
                    </button>
                </div>
            </div>
        `;
        return;
    }

    grid.innerHTML = devices.map(d => {
        const hasRtsp = Boolean(d.rtsp_url && d.rtsp_url.trim());
        const rtspUrl = hasRtsp ? d.rtsp_url : "RTSP Stream Not Configured";
        const tokenParam = state.token ? `?token=${encodeURIComponent(state.token)}` : "";
        const mjpegSrc = hasRtsp ? `/api/camera/${d.id}/mjpeg${tokenParam}&t=${Date.now()}` : "";

        return `
            <div class="camera-tile bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs flex flex-col hover:shadow-md transition">
                <div class="camera-screen-container relative bg-slate-950 aspect-video overflow-hidden flex items-center justify-center cursor-pointer group" onclick="expandCamera(${d.id})" title="Click to view camera stream in device console">
                    <!-- Live MJPEG Stream Image -->
                    ${hasRtsp ? `
                    <img id="grid-stream-${d.id}"
                         class="camera-grid-feed w-full h-full object-cover select-none transition-opacity duration-300 opacity-0"
                         src="${mjpegSrc}"
                         alt="${escapeHtml(d.name)}"
                         onload="this.classList.remove('opacity-0'); const sk = this.parentElement.querySelector('.stream-skeleton-placeholder'); if (sk) { sk.classList.add('opacity-0'); setTimeout(() => sk.classList.add('hidden'), 300); } this.parentElement.querySelector('.stream-offline-overlay')?.classList.add('hidden');"
                         onerror="this.classList.add('opacity-0'); this.parentElement.querySelector('.stream-skeleton-placeholder')?.classList.add('hidden'); this.parentElement.querySelector('.stream-offline-overlay')?.classList.remove('hidden');" />
                    ` : ''}

                    <!-- Video Screen Wireframe Skeleton (displayed while buffering stream) -->
                    <div class="stream-skeleton-placeholder ${hasRtsp ? '' : 'hidden'} absolute inset-0 flex flex-col items-center justify-center bg-slate-950 skeleton-shimmer-dark z-5 pointer-events-none transition-opacity duration-300">
                        <div class="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800/80 flex items-center justify-center text-slate-500 mb-2.5 shadow-inner">
                            <i class="bi bi-camera-video text-xl text-slate-400"></i>
                        </div>
                        <div class="h-2.5 w-32 bg-slate-800/90 rounded-full mb-1.5"></div>
                        <div class="h-2 w-20 bg-slate-800/50 rounded-full"></div>
                        <div class="absolute top-2.5 left-2.5 h-5 w-20 bg-slate-900/90 rounded border border-slate-800/70"></div>
                        <div class="absolute top-2.5 right-2.5 h-6 w-14 bg-slate-900/90 rounded border border-slate-800/70"></div>
                    </div>

                    <!-- Offline Fallback -->
                    <div class="stream-offline-overlay ${hasRtsp ? 'hidden' : ''} absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 text-slate-400 p-4 text-center z-5">
                        <i class="bi bi-camera-video-off text-3xl mb-1 text-slate-500"></i>
                        <span class="text-xs font-bold text-slate-200">${hasRtsp ? 'Stream Offline / Standby' : 'RTSP Not Configured'}</span>
                        <span class="text-[10px] text-slate-500 font-mono mt-0.5 truncate max-w-[200px]" title="${escapeHtml(rtspUrl)}">${escapeHtml(rtspUrl)}</span>
                        ${hasRtsp ? `
                        <button onclick="event.stopPropagation(); window.reloadGridStream(${d.id})" class="mt-2.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-semibold border border-slate-700 transition">
                            <i class="bi bi-arrow-clockwise mr-1"></i> Reconnect Stream
                        </button>
                        ` : ''}
                    </div>

                    <!-- Top Bar Camera Name Overlay -->
                    <div class="camera-screen-overlay absolute top-2.5 left-2.5 z-10 bg-black/70 backdrop-blur-xs px-2.5 py-1 rounded text-[11px] flex items-center space-x-1.5">
                        <i class="bi bi-camera-video-fill text-sky-400"></i>
                        <span class="text-white font-bold tracking-wide">${escapeHtml(d.name)}</span>
                    </div>

                    <!-- Top Right Quick Actions -->
                    <div class="absolute top-2.5 right-2.5 z-10 flex items-center space-x-1" onclick="event.stopPropagation()">
                        <button onclick="window.reloadGridStream(${d.id})" class="w-7 h-7 bg-black/60 hover:bg-black/90 text-slate-300 hover:text-white rounded flex items-center justify-center text-xs backdrop-blur-xs transition" title="Reload Feed">
                            <i class="bi bi-arrow-clockwise"></i>
                        </button>
                        <button onclick="expandCamera(${d.id})" class="w-7 h-7 bg-black/60 hover:bg-sky-600 text-slate-300 hover:text-white rounded flex items-center justify-center text-xs backdrop-blur-xs transition" title="Open Device Console">
                            <i class="bi bi-arrows-fullscreen"></i>
                        </button>
                    </div>
                </div>

                <!-- Card Body -->
                <div class="p-4 space-y-3 bg-white flex-1 flex flex-col justify-between">
                    <div class="space-y-1.5">
                        <div class="flex items-center justify-between">
                            <h4 class="text-xs font-bold text-slate-900 truncate">${escapeHtml(d.name)}</h4>
                        </div>
                        <div class="font-mono text-[11px] text-slate-400 truncate" title="${escapeHtml(rtspUrl)}">
                            <i class="bi bi-broadcast text-[10px] mr-1 text-slate-400"></i>${escapeHtml(rtspUrl)}
                        </div>
                        <div class="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                            <span class="truncate"><i class="bi bi-geo-alt text-[10px] mr-1 text-slate-400"></i>${escapeHtml(d.location || 'Default Site')}</span>
                            <span class="text-slate-400 text-[10px]">${escapeHtml(d.bank_name || 'No Entity')}</span>
                        </div>
                    </div>

                    <!-- Only View Feed Button — Click navigates to device console -->
                    <div class="pt-2.5 border-t border-slate-100 flex items-center">
                        <button onclick="expandCamera(${d.id})" class="w-full py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-semibold shadow-xs transition flex items-center justify-center cursor-pointer" title="View device live feed and console">
                            <i class="bi bi-play-circle mr-1.5"></i> View Feed
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join("");
}
window.renderLiveRtspGrid = renderLiveRtspGrid;

// ── Expand Camera: Navigate to Device Management Console ──
window.expandCamera = function(deviceId) {
    window.location.href = `/devices?device=${deviceId}`;
};

window.reloadGridStream = function(deviceId) {
    const img = qs(`#grid-stream-${deviceId}`);
    if (!img) return;
    img.classList.add("opacity-0");
    const parent = img.parentElement;
    if (parent) {
        const sk = parent.querySelector(".stream-skeleton-placeholder");
        if (sk) {
            sk.classList.remove("hidden", "opacity-0");
            sk.style.display = "";
        }
        parent.querySelector(".stream-offline-overlay")?.classList.add("hidden");
    }
    const tokenParam = state.token ? `?token=${encodeURIComponent(state.token)}` : "";
    img.src = `/api/camera/${deviceId}/mjpeg${tokenParam}&t=${Date.now()}`;
};

window.stopLiveRtspGrid = function() {
    const grid = qs("#camera-tiles-grid");
    if (!grid) return;
    grid.querySelectorAll("img.camera-grid-feed").forEach(img => {
        img.removeAttribute("src");
        img.src = "";
    });
};

window.resetSiteFilter = function() {
    selectedSiteFilter = "all";
    const el = qs("#site-filter-select");
    if (el) el.value = "all";
    renderRtspSkeletonLoading(4);
    setTimeout(() => {
        renderLiveRtspGrid();
    }, 250);
};

// Filter change handler
qs("#site-filter-select")?.addEventListener("change", (e) => {
    selectedSiteFilter = e.target.value;
    renderRtspSkeletonLoading(4);
    setTimeout(() => {
        renderLiveRtspGrid();
    }, 250);
});

async function loadOrganizationsDropdown() {
    try {
        const [banks, branches] = await Promise.all([
            api("/api/banks/"),
            api("/api/banks/branches")
        ]);
        const orgSelect = qs("#organization-select");
        const siteFilter = qs("#site-filter-select");

        if (orgSelect) {
            if (banks && banks.length > 0) {
                orgSelect.innerHTML = banks.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
            } else {
                orgSelect.innerHTML = `<option value="default">Default Organization</option>`;
            }
        }

        if (siteFilter) {
            let filterHtml = `<option value="all">All Sites & Branches</option>`;
            if (banks && banks.length > 0) {
                banks.forEach(b => {
                    filterHtml += `<option value="bank_${b.id}">Bank: ${escapeHtml(b.name)}</option>`;
                });
            }
            if (branches && branches.length > 0) {
                branches.forEach(br => {
                    filterHtml += `<option value="branch_${br.id}">Branch: ${escapeHtml(br.name)}</option>`;
                });
            }
            siteFilter.innerHTML = filterHtml;
            siteFilter.value = selectedSiteFilter;
        }
    } catch (e) {
        console.warn("Failed to load organizations dropdown:", e);
    }
}

// ══════════════════════════════════════════
//  INITIALIZATION
// ══════════════════════════════════════════
async function init() {
    // nav.js runs first and sets window._navUser after auth check.
    // Sync user state from nav.js if available, otherwise fetch it.
    if (window._navUser) {
        state.user = window._navUser;
    } else {
        try {
            state.user = await api("/api/users/me");
        } catch (err) {
            console.error("Auto-login failed:", err);
            state.token = null;
            localStorage.removeItem("token");
            window.location.href = "/";
            return;
        }
    }

    if (!state.user) {
        window.location.href = "/";
        return;
    }

    try {
        await loadOrganizationsDropdown();
    } catch (e) {}

    try {
        await loadDevices();
    } catch (err) {
        console.error("Devices loading warning:", err);
    }

    try {
        startOtpPolling();
    } catch (err) {
        console.error("OTP polling warning:", err);
    }

    try {
        await loadSecurityAlerts();
    } catch (err) {
        console.error("Security alerts loading warning:", err);
    }

    try {
        initLiveViewControls();
    } catch (err) {
        console.error("Live view controls init warning:", err);
    }
}

// ══════════════════════════════════════════
//  AUTH — logout handled by nav.js
// ══════════════════════════════════════════
// Also wire cleanup of streams/intervals when nav.js fires logout
document.addEventListener("click", function(e) {
    if (!e.target.closest("#logout-btn")) return;
    state.token = null;
    state.user = null;
    state.devices = [];
    state.selectedDeviceId = null;
    if (typeof stopAllStreams === "function") stopAllStreams();
    if (typeof stopCameraTimestamp === "function") stopCameraTimestamp();
    if (otpRequestsInterval) { clearInterval(otpRequestsInterval); otpRequestsInterval = null; }
    if (state.sendButtonInterval) { clearInterval(state.sendButtonInterval); state.sendButtonInterval = null; }
});

// Expose window helpers for pages that call them before nav.js resolves
window.initHeaderClock = window.initHeaderClock || function() {};
window.checkUserRoleAndPermissions = window.checkUserRoleAndPermissions || function() {};

// ══════════════════════════════════════════
//  DEVICES
// ══════════════════════════════════════════

async function loadDevices() {
    try {
        if (!state.devices || state.devices.length === 0) {
            renderRtspSkeletonLoading();
        }
        state.devices = await api("/api/devices/");
        renderDeviceList();
        populateCameraDropdown();
        renderOverviewDashboard();
        renderLiveRtspGrid();

        // Also load OTP requests so the device view shows current pending requests
        await loadOtpRequests();

        // Auto-select device if specified in query param ?device=ID or previously selected
        const urlParams = new URLSearchParams(window.location.search);
        const selId = urlParams.get('device') || urlParams.get('select') || state.selectedDeviceId;
        if (selId) {
            const devIdInt = parseInt(selId);
            if (devIdInt) {
                selectDevice(devIdInt);
            }
        }

    } catch (err) {
        console.error("Failed to load devices:", err);
    }
}
window.loadDevices = loadDevices;
window.loadOtpRequests = loadOtpRequests;
window.startOtpPolling = startOtpPolling;
window.stopOtpPolling = stopOtpPolling;

function renderDeviceList() {
    const list = qs("#device-list");
    if (!list) return;
    list.innerHTML = "";
    const countBadge = qs("#device-count");
    if (countBadge) {
        countBadge.textContent = state.devices.length;
    }

    if (state.devices.length === 0) {
        list.innerHTML = `
            <div class="empty-state text-slate-400 text-center py-6 text-xs">
                <i class="bi bi-camera-video text-3xl opacity-20 mb-2 block"></i>
                <p>No devices registered yet.</p>
            </div>
        `;
        return;
    }

    state.devices.forEach((device) => {
        const item = document.createElement("div");
        const isActive = device.id === state.selectedDeviceId;
        item.className = `p-3 rounded-lg border cursor-pointer transition flex flex-col space-y-1 ${
            isActive 
                ? "bg-sky-50 border-sky-500 text-sky-900 shadow-xs" 
                : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100 hover:border-slate-300"
        }`;
        
        item.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2 font-semibold text-xs text-slate-900 truncate">
                    <i class="bi bi-camera-video text-sky-600"></i>
                    <span class="truncate">${escapeHtml(device.name)}</span>
                </div>
                <div class="flex items-center space-x-1 shrink-0">
                    <button type="button" class="px-1.5 py-0.5 text-slate-400 hover:text-sky-600 hover:bg-slate-200/60 rounded transition text-xs" title="Edit Device" onclick="event.stopPropagation(); window.openEditDeviceModal(${device.id})">
                        <i class="bi bi-pencil-square"></i>
                    </button>
                    <button type="button" class="px-1.5 py-0.5 text-slate-400 hover:text-rose-600 hover:bg-slate-200/60 rounded transition text-xs" title="Delete Device" onclick="event.stopPropagation(); window.deleteDeviceById(${device.id})">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>
            <div class="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                <span class="truncate max-w-[120px]">${escapeHtml(device.location || "No location")}</span>
                <span class="truncate max-w-[120px]">${escapeHtml(device.rtsp_url || "RTSP")}</span>
            </div>
        `;
        
        item.addEventListener("click", () => selectDevice(device.id));
        list.appendChild(item);
    });
}

// ── Camera Dropdown ──
function populateCameraDropdown() {
    const dropdown = qs("#camera-dropdown");
    if (!dropdown) return;

    dropdown.innerHTML = '<option value="">— Select a camera —</option>';

    state.devices.forEach((device) => {
        const opt = document.createElement("option");
        opt.value = device.id;
        opt.textContent = `${device.name} — ${device.location || "No location"}`;
        if (device.id === state.selectedDeviceId) opt.selected = true;
        dropdown.appendChild(opt);
    });

    const bar = qs("#camera-selector-bar");
    if (bar) {
        if (state.devices.length > 0) {
            bar.classList.remove("hidden");
        } else {
            bar.classList.add("hidden");
        }
    }
}

// Camera dropdown change handler
qs("#camera-dropdown")?.addEventListener("change", (e) => {
    const deviceId = parseInt(e.target.value);
    if (deviceId) {
        selectDevice(deviceId);
    }
});

function selectDevice(deviceId) {
    state.selectedDeviceId = deviceId;
    renderDeviceList();
    // Sync dropdown
    const dropdown = qs("#camera-dropdown");
    if (dropdown) dropdown.value = deviceId;

    const device = state.devices.find((d) => d.id === deviceId);
    if (device) showDeviceView(device);

    updateSendButtonState();
}
window.selectDevice = selectDevice;

// Re-evaluate button state whenever the Action Control mode dropdown changes
qs("#mode-dropdown")?.addEventListener("change", () => {
    updateSendButtonState();
});

function showDeviceView(device) {
    stopAllStreams();

    qs("#add-device-form").classList.add("hidden");
    qs("#empty-state").classList.add("hidden");
    qs("#device-view").classList.remove("hidden");

    qs("#view-device-name").textContent = `${device.name}`;

    // Status (if element exists)
    const statusEl = qs("#view-device-status");
    if (statusEl) {
        statusEl.innerHTML = "";
    }

    qs("#view-device-location").textContent = ` ${device.location || "No location set"}`;
    qs("#view-device-rtsp").textContent = `${device.rtsp_url || "Auto-configured"}`;

    // Device config bar
    renderDeviceConfig(device);

    // Start WebSocket RTSP streaming (with MJPEG fallback)
    startWebSocketStream(device.id);

    // Hide action result when switching devices
    qs("#action-result")?.classList.add("hidden");

    // Render pending OTP requests for this device
    renderDeviceOtpRequestList(device.id);
}


function renderDeviceConfig(device) {
    const bar = qs("#device-config-display");
    const configs = [
        { label: "RTSP Stream URL", value: device.rtsp_url || "Auto-configured" },
        { label: "Type", value: "RTSP Connection" },
    ];

    bar.innerHTML = configs.map(c =>
        `<span class="config-item"><strong>${c.label}</strong>${escapeHtml(String(c.value))}</span>`
    ).join("");
}

// ── Edit/Delete Device ──
let editingDeviceId = null;

function updateFormFields() {
    const manualCard = qs("#manual-rtsp-card");
    const rtspLabel = qs("#device-rtsp-label");
    const rtspInput = qs("#device-rtsp");

    if (manualCard) manualCard.classList.remove("hidden");
    if (rtspLabel) rtspLabel.textContent = "RTSP STREAM URL *";
    if (rtspInput) rtspInput.placeholder = "rtsp://username:password@192.168.1.100:554/stream1";
}

// Listen for device connection type changes
qs("#device-type")?.addEventListener("change", updateFormFields);



// Auto-populate helper
async function loadBanksAndBranchesForDeviceForm() {
    try {
        state.banks = await api("/api/banks/");
        state.branches = await api("/api/banks/branches");

        const bankSelect = qs("#device-bank-id");
        if (bankSelect) {
            bankSelect.innerHTML = '<option value="">— Select Bank —</option>' +
                state.banks.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
            
            if (state.currentUser && state.currentUser.bank_id) {
                bankSelect.value = String(state.currentUser.bank_id);
                populateBranchSelectForDeviceForm(state.currentUser.bank_id);
            } else {
                populateBranchSelectForDeviceForm();
            }
        } else {
            populateBranchSelectForDeviceForm();
        }
    } catch (e) {
        console.error("Failed to load banks and branches for device form:", e);
    }
}

function populateBranchSelectForDeviceForm(bankId = null) {
    const branchSelect = qs("#device-branch-id");
    if (!branchSelect) return;

    let filtered = state.branches || [];
    if (bankId && bankId !== "all" && bankId !== "") {
        filtered = filtered.filter(b => String(b.bank_id) === String(bankId));
    }

    branchSelect.innerHTML = '<option value="">— Select Branch —</option>' +
        filtered.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
}

qs("#device-bank-id")?.addEventListener("change", (e) => {
    populateBranchSelectForDeviceForm(e.target.value);
});

async function resetDeviceForm() {
    await loadBanksAndBranchesForDeviceForm();

    qs("#device-name").value = "";
    qs("#device-rtsp").value = "";
    qs("#device-location").value = "";
    qs("#device-manufacturer").value = "";
    if (qs("#device-bank-id")) {
        if (state.currentUser && state.currentUser.bank_id) {
            qs("#device-bank-id").value = String(state.currentUser.bank_id);
            populateBranchSelectForDeviceForm(state.currentUser.bank_id);
        } else {
            qs("#device-bank-id").value = "";
            populateBranchSelectForDeviceForm();
        }
    }
    if (qs("#device-branch-id")) qs("#device-branch-id").value = "";
    if (qs("#device-enable-email")) qs("#device-enable-email").checked = true;
    if (qs("#device-enable-whatsapp")) qs("#device-enable-whatsapp").checked = true;
    qs("#device-error").textContent = "";
    editingDeviceId = null;
    qs("#device-form-title").textContent = "Add New Device";
    qs("#save-device-btn").innerHTML = '<i class="bi bi-floppy mr-1"></i> Save Device';
    updateFormFields();
}

async function populateDeviceForm(device) {
    await loadBanksAndBranchesForDeviceForm();

    qs("#device-name").value = device.name || "";
    qs("#device-rtsp").value = device.rtsp_url || "";
    qs("#device-location").value = device.location || "";
    qs("#device-manufacturer").value = device.manufacturer || "";
    if (qs("#device-type")) qs("#device-type").value = "rtsp";

    // 1. Resolve Target Bank ID (either directly or via branch lookup)
    let targetBankId = device.bank_id;
    if (!targetBankId && device.branch_id && state.branches) {
        const foundBranch = state.branches.find(b => String(b.id) === String(device.branch_id));
        if (foundBranch) targetBankId = foundBranch.bank_id;
    }

    // 2. Select Bank
    const bankSelect = qs("#device-bank-id");
    if (bankSelect && targetBankId) {
        bankSelect.value = String(targetBankId);
    }

    // 3. Populate Branches for Bank
    populateBranchSelectForDeviceForm(targetBankId);

    // 4. Select Branch
    const branchSelect = qs("#device-branch-id");
    if (branchSelect && device.branch_id) {
        branchSelect.value = String(device.branch_id);
    }

    if (qs("#device-enable-email")) qs("#device-enable-email").checked = device.enable_email !== false;
    if (qs("#device-enable-whatsapp")) qs("#device-enable-whatsapp").checked = device.enable_whatsapp !== false;
    editingDeviceId = device.id;
    qs("#device-form-title").textContent = "Edit Device";
    qs("#save-device-btn").innerHTML = '<i class="bi bi-pencil mr-1"></i> Update Device';
    qs("#device-error").textContent = "";
    updateFormFields();
}

// Modal open helpers
window.openAddDeviceModal = async function() {
    qs("#add-device-form")?.classList.remove("hidden");
    await resetDeviceForm();
};

window.openEditDeviceModal = async function(deviceId) {
    const device = state.devices.find(d => d.id === deviceId);
    if (!device) return;
    qs("#add-device-form")?.classList.remove("hidden");
    await populateDeviceForm(device);
};

window.deleteDeviceById = async function(deviceId) {
    const device = (state.devices || []).find(d => d.id === deviceId);
    if (!device) return;
    const confirmed = await window.confirmDelete({
        title: "Delete Camera Device",
        itemName: device.name,
        message: `Are you sure you want to delete device "${device.name}"? This action cannot be undone.`
    });
    if (!confirmed) return;
    try {
        await api(`/api/devices/${deviceId}`, { method: "DELETE" });
        if (state.selectedDeviceId === deviceId) {
            state.selectedDeviceId = null;
            qs("#device-view")?.classList.add("hidden");
            qs("#empty-state")?.classList.remove("hidden");
            stopAllStreams();
        }
        await loadDevices();
        showToast(`Device "${device.name}" deleted!`, "success");
    } catch (err) {
        showToast(err.message, "error");
    }
};

// Add Device button
qs("#add-device-btn")?.addEventListener("click", () => window.openAddDeviceModal());

// Edit Device button
qs("#edit-device-btn")?.addEventListener("click", () => {
    if (state.selectedDeviceId) {
        window.openEditDeviceModal(state.selectedDeviceId);
    } else {
        showToast("Please select a device first.", "info");
    }
});

// Delete Device button
qs("#delete-device-btn")?.addEventListener("click", () => {
    if (state.selectedDeviceId) {
        window.deleteDeviceById(state.selectedDeviceId);
    }
});

qs("#cancel-device-btn")?.addEventListener("click", () => {
    qs("#add-device-form")?.classList.add("hidden");
    resetDeviceForm();
    if (state.selectedDeviceId) {
        const device = state.devices.find((d) => d.id === state.selectedDeviceId);
        if (device) showDeviceView(device);
    } else {
        qs("#empty-state")?.classList.remove("hidden");
    }
});

qs("#close-device-modal-btn")?.addEventListener("click", () => {
    qs("#cancel-device-btn")?.click();
});

// Close modal when clicking backdrop outside modal content
qs("#add-device-form")?.addEventListener("click", (e) => {
    if (e.target === qs("#add-device-form")) {
        qs("#cancel-device-btn")?.click();
    }
});

// Build device data from form
function getDeviceFormData() {
    const name = qs("#device-name") ? qs("#device-name").value.trim() : "";
    let rtsp_url = qs("#device-rtsp") ? qs("#device-rtsp").value.trim() : "";

    if (rtsp_url) {
        rtsp_url = rtsp_url.replace(/^(?:rtsp:?\/*)+(?:554\/*|8554\/*)?(?:rtsp:?\/*)*/i, 'rtsp://');
        if (rtsp_url && !rtsp_url.toLowerCase().startsWith("rtsp://") && !rtsp_url.toLowerCase().startsWith("rtsps://")) {
            rtsp_url = "rtsp://" + rtsp_url;
        }
    }

    const payload = {
        name,
        device_type: "rtsp",
        rtsp_url: rtsp_url || null,
        location: qs("#device-location") ? qs("#device-location").value.trim() || null : null,
        manufacturer: qs("#device-manufacturer") ? qs("#device-manufacturer").value.trim() || null : null,
    };

    const bankVal = qs("#device-bank-id")?.value;
    payload.bank_id = bankVal ? parseInt(bankVal) : null;

    const branchVal = qs("#device-branch-id")?.value;
    payload.branch_id = branchVal ? parseInt(branchVal) : null;

    if (qs("#device-enable-email")) payload.enable_email = qs("#device-enable-email").checked;
    if (qs("#device-enable-whatsapp")) payload.enable_whatsapp = qs("#device-enable-whatsapp").checked;

    return payload;
}


qs("#save-device-btn")?.addEventListener("click", async () => {
    const btn = qs("#save-device-btn");
    if (!btn || btn.disabled || btn.getAttribute("data-submitting") === "true") return;

    const data = getDeviceFormData();
    if (!data.name) {
        qs("#device-error").textContent = "Device name is required.";
        return;
    }

    btn.disabled = true;
    btn.setAttribute("data-submitting", "true");
    const origText = btn.innerHTML;
    btn.innerHTML = `<i class="bi bi-arrow-repeat mr-1.5 animate-spin"></i> Saving Device...`;

    try {
        if (editingDeviceId) {
            if (!data.password && !data.rtsp_url) delete data.password;

            const prevDeviceId = editingDeviceId;
            const device = await api(`/api/devices/${editingDeviceId}`, {
                method: "PUT",
                body: JSON.stringify(data),
            });

            // Stop the existing RTSP stream immediately so backend releases the old socket
            stopAllStreams();

            // Signal backend to close the active RTSP WebSocket (releases old OpenCV socket)
            try {
                await api(`/api/camera/${prevDeviceId}/disconnect`, { method: "POST" });
            } catch (_) {}

            await loadDevices();
            qs("#add-device-form").classList.add("hidden");
            await resetDeviceForm();

            // Short delay lets backend fully release the old RTSP socket before new WS connects
            setTimeout(() => {
                selectDevice(device.id);
            }, 500);

            showToast(`Device "${device.name}" updated!`);
        } else {
            const device = await api("/api/devices/", {
                method: "POST",
                body: JSON.stringify(data),
            });
            await loadDevices();
            qs("#add-device-form").classList.add("hidden");
            await resetDeviceForm();
            selectDevice(device.id);
            showToast(`Device "${device.name}" added successfully!`);
        }
    } catch (err) {
        qs("#device-error").textContent = err.message;
    } finally {
        btn.disabled = false;
        btn.removeAttribute("data-submitting");
        btn.innerHTML = origText;
    }
});

// Validate Stream
qs("#validate-stream-btn")?.addEventListener("click", async () => {
    if (!state.selectedDeviceId) return;
    const btn = qs("#validate-stream-btn");
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm mr-1" role="status" aria-hidden="true"></span> Validating...';

    try {
        const result = await api(`/api/camera/${state.selectedDeviceId}/validate`, {
            method: "POST",
        });
        if (result.reachable) {
            showToast("Stream reachable!", "success");
            btn.innerHTML = '<i class="bi bi-check-lg mr-1"></i> Reachable';
            btn.className = 'btn btn-sm btn-outline-success';
        } else {
            showToast("Stream not reachable. Check URL.", "error");
            btn.innerHTML = '<i class="bi bi-x-lg mr-1"></i> Unreachable';
            btn.className = 'btn btn-sm btn-outline-danger';
        }
    } catch (err) {
        showToast(err.message, "error");
        btn.innerHTML = '<i class="bi bi-search mr-1"></i> Validate Stream';
        btn.className = 'btn btn-sm btn-outline-info';
    } finally {
        setTimeout(() => {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-search mr-1"></i> Validate Stream';
            btn.className = 'btn btn-sm btn-outline-info';
        }, 3000);
    }
});

// Refresh Stream
qs("#refresh-stream-btn")?.addEventListener("click", () => {
    if (!state.selectedDeviceId) return;
    startMjpegStream(state.selectedDeviceId);
    showToast("Stream restarting...", "info");
});

// ══════════════════════════════════════════
//  SEND ACTION (Thread / No Thread)
// ══════════════════════════════════════════

qs("#send-action-btn")?.addEventListener("click", async () => {
    if (!state.selectedDeviceId) {
        showToast("Please select a device first.", "error");
        return;
    }

    const _modeEl = document.getElementById("mode-dropdown");
    const mode = (_modeEl ? _modeEl.value : "no_threat").toLowerCase();
    const btn = qs("#send-action-btn");
    const statusIndicator = qs("#mode-status-indicator");

    const payload = { mode };

    // Update UI to sending state
    btn.classList.add("sending");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm mr-1" role="status" aria-hidden="true"></span> Processing...';
    if (statusIndicator) {
        statusIndicator.innerHTML = '<i class="bi bi-circle-fill text-amber-500 mr-1" style="font-size:8px;animation:livePulse 1s infinite;"></i><span class="text-amber-600 text-xs">Processing...</span>';
    }

    try {
        const result = await api(`/api/camera/${state.selectedDeviceId}/send-action`, {
            method: "POST",
            body: JSON.stringify(payload),
        });

        // Show action result
        showActionResult(result);

        // Immediately refresh OTP requests to clear acknowledged alert from UI
        await loadOtpRequests();

        // Update Last Ack card in device console
        const lastAckTime = qs("#last-ack-time");
        const lastAckContent = qs("#last-ack-content");
        const nowStr = new Date().toLocaleTimeString();
        if (lastAckTime) lastAckTime.textContent = nowStr;

        // Show toast and feedback based on mode
        if (mode === "threat" || mode === "thread") {
            showToast("THREAT DETECTED: Access denied. No OTP sent.", "danger");
            if (lastAckContent) {
                lastAckContent.innerHTML = `<span class="text-rose-600 font-bold"><i class="bi bi-shield-slash-fill mr-1"></i> Threat Detected (Access Denied / No OTP)</span>`;
            }
        } else if (mode === "no_threat") {
            showToast(`NO THREAT: Dual OTP dispatched to ${result.user1_username || "User 1"} & ${result.user2_username || "User 2"}!`, "success");
            if (lastAckContent) {
                lastAckContent.innerHTML = `<span class="text-emerald-600 font-bold"><i class="bi bi-check-circle-fill mr-1"></i> Dual OTP Dispatched & Acknowledged</span>`;
            }
        } else if (mode === "offline_otp") {
            showToast(`OFFLINE OTP: Dispatched to ${result.user1_username || "User 1"} & ${result.user2_username || "User 2"} via Email`, "success");
            if (lastAckContent) {
                lastAckContent.innerHTML = `<span class="text-purple-600 font-bold"><i class="bi bi-key-fill mr-1"></i> Offline OTP Dispatched</span>`;
            }
        } else {
            showToast("Action processed successfully.", "info");
        }

        if (statusIndicator) {
            statusIndicator.innerHTML = '<i class="bi bi-check-circle-fill text-emerald-600 mr-1" style="font-size:10px;"></i><span class="text-emerald-600 text-xs">Complete</span>';
        }

    } catch (err) {
        showToast(err.message || "Failed to send action request", "error");
        if (statusIndicator) {
            statusIndicator.innerHTML = '<i class="bi bi-x-circle-fill text-rose-600 mr-1" style="font-size:10px;"></i><span class="text-rose-600 text-xs">Failed</span>';
        }
    } finally {
        btn.classList.remove("sending");
        btn.disabled = false;
        updateSendButtonState();

        // Refresh OTP requests list
        loadOtpRequests();

        if (statusIndicator) {
            setTimeout(() => {
                statusIndicator.innerHTML = '<i class="bi bi-circle-fill text-slate-400 mr-1" style="font-size:8px;"></i><span class="text-slate-400 text-xs">Ready</span>';
            }, 5000);
        }
    }
});

// ── Show Action Result ──
function showActionResult(result) {
    const panel = qs("#action-result");
    const body = qs("#action-result-body");
    const title = qs("#action-result-title");
    if (!panel || !body || !title) return;

    panel.classList.remove("hidden");

    const m = (result.mode || "").toLowerCase();

    if (m === "threat" || m === "thread" || result.threat_detected || result.otp_sent === false) {
        panel.className = "bg-rose-50 border border-rose-300 rounded-lg p-3 text-xs space-y-2 mt-2";
        title.innerHTML = '<i class="bi bi-shield-slash-fill mr-1.5 text-rose-600"></i> <span class="text-rose-900 font-bold">SECURITY THREAT — Access Denied</span>';
        body.innerHTML = `
            <div class="space-y-2">
                <div class="bg-white border border-rose-200 rounded p-2.5 text-rose-900 shadow-xs">
                    <div class="text-xs font-bold flex items-center text-rose-700">
                        <i class="bi bi-shield-x mr-1.5 text-base text-rose-600"></i>
                        No OTP Sent — Access Request Denied
                    </div>
                    <div class="text-[11px] text-slate-600 mt-1">
                        ${escapeHtml(result.message || 'Security threat detected. Hardware unlock OTP dispatch blocked. Request acknowledged as threat and logged.')}
                    </div>
                </div>
                <div class="text-[10px] text-rose-700 font-mono text-center pt-0.5 flex items-center justify-center font-semibold">
                    <i class="bi bi-exclamation-octagon-fill mr-1 text-rose-600"></i> Critical Security Threat Alert Recorded
                </div>
            </div>
        `;
        return;
    }

    panel.className = "bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs space-y-2 mt-2";

    if (m === "no_threat") {
        title.innerHTML = '<i class="bi bi-shield-check mr-2 text-emerald-600"></i> <span class="text-slate-800 font-bold">NO THREAT — Dual OTP Dispatched</span>';
        body.innerHTML = `
            <div class="space-y-2">
                <div class="bg-white border border-slate-200 rounded p-2.5">
                    <div class="text-[10px] text-slate-500 uppercase font-bold mb-1">1st User (${escapeHtml(result.user1_username || "User 1")})</div>
                    <div class="text-[10px] text-slate-600 truncate flex items-center"><i class="bi bi-envelope mr-1 text-slate-400"></i>Email: ${escapeHtml(result.user1_email || "N/A")} ${result.email_sent1 ? '<span class="text-emerald-600 font-semibold ml-1 inline-flex items-center"><i class="bi bi-check-circle-fill mr-0.5 text-[9px]"></i>Sent</span>' : '<span class="text-slate-400 ml-1">(No email)</span>'}</div>
                </div>
                <div class="bg-white border border-slate-200 rounded p-2.5">
                    <div class="text-[10px] text-slate-500 uppercase font-bold mb-1">2nd User (${escapeHtml(result.user2_username || "User 2")})</div>
                    <div class="text-[10px] text-slate-600 truncate flex items-center"><i class="bi bi-envelope mr-1 text-slate-400"></i>Email: ${escapeHtml(result.user2_email || "N/A")} ${result.email_sent2 ? '<span class="text-emerald-600 font-semibold ml-1 inline-flex items-center"><i class="bi bi-check-circle-fill mr-0.5 text-[9px]"></i>Sent</span>' : '<span class="text-slate-400 ml-1">(No email)</span>'}</div>
                </div>
                <div class="text-[10px] text-emerald-600 font-mono text-center pt-1 flex items-center justify-center font-semibold">
                    <i class="bi bi-broadcast mr-1"></i> Published to MQTT: ${result.mqtt_sent ? "Success" : "Offline"}
                </div>
            </div>
        `;
    } else if (m === "offline_otp") {
        title.innerHTML = '<i class="bi bi-key mr-2 text-purple-600"></i> <span class="text-slate-800 font-bold">OFFLINE OTP — Dispatched</span>';
        body.innerHTML = `
            <div class="space-y-2">
                <div class="bg-white border border-slate-200 rounded p-2.5">
                    <div class="text-[10px] text-slate-500 uppercase font-bold mb-1">1st User (${escapeHtml(result.user1_username || "User 1")})</div>
                    <div class="text-[10px] text-slate-600 truncate flex items-center"><i class="bi bi-envelope mr-1 text-slate-400"></i>Email: ${escapeHtml(result.user1_email || "N/A")} ${result.email_sent1 ? '<span class="text-emerald-600 font-semibold ml-1 inline-flex items-center"><i class="bi bi-check-circle-fill mr-0.5 text-[9px]"></i>Sent</span>' : '<span class="text-slate-400 ml-1">(Skipped)</span>'}</div>
                    ${result.slot1 ? `<div class="text-[10px] text-purple-600 mt-1">Pool Slot: #${result.slot1}</div>` : ''}
                </div>
                <div class="bg-white border border-slate-200 rounded p-2.5">
                    <div class="text-[10px] text-slate-500 uppercase font-bold mb-1">2nd User (${escapeHtml(result.user2_username || "User 2")})</div>
                    <div class="text-[10px] text-slate-600 truncate flex items-center"><i class="bi bi-envelope mr-1 text-slate-400"></i>Email: ${escapeHtml(result.user2_email || "N/A")} ${result.email_sent2 ? '<span class="text-emerald-600 font-semibold ml-1 inline-flex items-center"><i class="bi bi-check-circle-fill mr-0.5 text-[9px]"></i>Sent</span>' : '<span class="text-slate-400 ml-1">(Skipped)</span>'}</div>
                    ${result.slot2 ? `<div class="text-[10px] text-purple-600 mt-1">Pool Slot: #${result.slot2}</div>` : ''}
                </div>
                <div class="text-[10px] text-amber-600 font-mono text-center pt-1 flex items-center justify-center font-semibold">
                    <i class="bi bi-envelope-check mr-1"></i> Email Only (MQTT Bypassed)
                </div>
            </div>
        `;
    } else {
        title.innerHTML = '<i class="bi bi-info-circle mr-2 text-slate-600"></i> Result';
        body.innerHTML = `
            <div class="bg-white border border-slate-200 rounded p-2.5 text-xs text-slate-600">
                ${escapeHtml(result.message || 'Action executed successfully.')}
            </div>
        `;
    }
}

// Close result panel
qs("#close-result-btn")?.addEventListener("click", () => {
    qs("#action-result")?.classList.add("hidden");
});

// OTP countdown
function startOtpCountdown(expiresAt) {
    if (state.otpTimer) clearInterval(state.otpTimer);

    state.otpTimer = setInterval(() => {
        const el = qs("#otp-countdown");
        if (!el) {
            clearInterval(state.otpTimer);
            return;
        }
        const now = Date.now();
        const expiry = new Date(expiresAt).getTime();
        const diff = expiry - now;

        if (diff <= 0) {
            clearInterval(state.otpTimer);
            el.innerHTML = '<i class="bi bi-clock-history mr-1 text-rose-500"></i> Expired — generate a new OTP';
            el.style.color = "var(--danger)";
            return;
        }

        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        el.innerHTML = `<i class="bi bi-stopwatch mr-1 text-sky-500"></i> Valid for ${minutes}:${String(seconds).padStart(2, "0")}`;
    }, 1000);
}

function formatExpiry(isoStr) {
    const expiry = new Date(isoStr);
    const diff = expiry.getTime() - Date.now();
    if (diff <= 0) return "Expired";
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `<i class="bi bi-stopwatch mr-1 text-sky-500"></i> Valid for ${minutes}:${String(seconds).padStart(2, "0")}`;
}

// ══════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function formatTime(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ══════════════════════════════════════════
//  BANK & USER MANAGEMENT (Super / Bank Admin)
// ══════════════════════════════════════════

// ══════════════════════════════════════════
//  DEBOUNCE HELPER
// ══════════════════════════════════════════
function debounce(fn, delay = 350) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// ══════════════════════════════════════════
//  BANK MANAGEMENT MODULE
// ══════════════════════════════════════════
// (banksModuleInitialized declared at top)

async function loadBanksModule() {
    if (!state.token) return;
    try {
        const banks = await api("/api/banks/");
        state.banks = banks;

        const countBadge = qs("#banks-count");
        if (countBadge) countBadge.textContent = `${banks.length} banks`;

        const tbody = qs("#banks-table-body");
        if (tbody) {
            if (banks.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-400 text-xs">No registered banks found. Click "Add Bank" to register one.</td></tr>`;
            } else {
                tbody.innerHTML = banks.map(b => {
                    const adminDisplay = b.admin_username
                        ? `<span class="block font-semibold text-slate-900">${escapeHtml(b.admin_username)}</span><span class="block text-slate-400 text-[11px]">${escapeHtml(b.admin_email || '')}</span>`
                        : `<span class="text-slate-400 text-xs">—</span>`;

                    return `
                        <tr class="hover:bg-slate-50 transition">
                            <td class="py-3 pr-4 font-semibold text-sky-600">${b.id}</td>
                            <td class="py-3 pr-4 font-bold text-slate-900">${escapeHtml(b.name)}</td>
                            <td class="py-3 pr-4 text-xs">${adminDisplay}</td>
                            <td class="py-3 pr-4 text-slate-500 font-mono text-[11px]">${new Date(b.created_at).toLocaleString()}</td>
                            <td class="py-3 text-right space-x-2">
                                <button class="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 font-semibold rounded text-xs transition" onclick="openEditBankModal(${b.id})">
                                    <i class="bi bi-pencil-square mr-1"></i> Edit
                                </button>
                                <button class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold rounded text-xs transition" onclick="deleteBank(${b.id}, '${escapeHtml(b.name).replace(/'/g, "\\'")}')">
                                    <i class="bi bi-trash mr-1"></i> Delete
                                </button>
                            </td>
                        </tr>
                    `;
                }).join("");
            }
        }
    } catch (err) {
        console.error("Failed to load banks:", err);
        showToast(err.message, "error");
    }

    if (!banksModuleInitialized) {
        banksModuleInitialized = true;
        initBankModalEvents();
    }
}
window.loadBanksModule = loadBanksModule;

function initBankModalEvents() {
    const addBankModal = qs("#add-bank-modal");
    const editBankModal = qs("#edit-bank-modal");

    qs("#open-add-bank-modal")?.addEventListener("click", () => {
        qs("#add-bank-form")?.reset();
        const errEl = qs("#add-bank-error");
        if (errEl) errEl.textContent = "";
        addBankModal?.classList.remove("hidden");
    });

    qs("#close-add-bank-modal")?.addEventListener("click", () => addBankModal?.classList.add("hidden"));
    qs("#cancel-add-bank")?.addEventListener("click", () => addBankModal?.classList.add("hidden"));

    qs("#add-bank-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.target;
        if (form.dataset.submitting === "true") return;
        form.dataset.submitting = "true";

        const submitBtn = form.querySelector('button[type="submit"]');
        const origBtnText = submitBtn ? submitBtn.innerHTML : "";
        if (submitBtn) submitBtn.innerHTML = `<i class="bi bi-arrow-repeat mr-1.5 animate-spin"></i> Creating...`;

        const bankName = qs("#bank-name").value.trim();
        const username = qs("#bank-admin-username").value.trim();
        const email = qs("#bank-admin-email").value.trim();
        const password = qs("#bank-admin-password").value.trim();
        const errEl = qs("#add-bank-error");
        if (errEl) errEl.textContent = "";

        try {
            await api("/api/banks/", {
                method: "POST",
                body: JSON.stringify({ bank_name: bankName, username, email, password })
            });
            addBankModal?.classList.add("hidden");
            showToast("Bank & Admin created successfully!");
            await loadBanksModule();
            await loadOrganizationsDropdown();
        } catch (err) {
            if (errEl) errEl.textContent = err.message;
        } finally {
            form.dataset.submitting = "false";
            if (submitBtn && origBtnText) submitBtn.innerHTML = origBtnText;
        }
    });

    qs("#close-edit-bank-modal")?.addEventListener("click", () => editBankModal?.classList.add("hidden"));
    qs("#cancel-edit-bank")?.addEventListener("click", () => editBankModal?.classList.add("hidden"));

    qs("#edit-bank-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.target;
        if (form.dataset.submitting === "true") return;
        form.dataset.submitting = "true";

        const submitBtn = form.querySelector('button[type="submit"]');
        const origBtnText = submitBtn ? submitBtn.innerHTML : "";
        if (submitBtn) submitBtn.innerHTML = `<i class="bi bi-arrow-repeat mr-1.5 animate-spin"></i> Saving...`;

        const bankId = qs("#edit-bank-id").value;
        const bankName = qs("#edit-bank-name").value.trim();
        const username = qs("#edit-bank-admin-username") ? qs("#edit-bank-admin-username").value.trim() : "";
        const email = qs("#edit-bank-admin-email") ? qs("#edit-bank-admin-email").value.trim() : "";
        const password = qs("#edit-bank-admin-password") ? qs("#edit-bank-admin-password").value.trim() : "";

        const errEl = qs("#edit-bank-error");
        if (errEl) errEl.textContent = "";

        const payload = { name: bankName };
        if (username) payload.username = username;
        if (email) payload.email = email;
        if (password) payload.password = password;

        try {
            await api(`/api/banks/${bankId}`, {
                method: "PUT",
                body: JSON.stringify(payload)
            });
            editBankModal?.classList.add("hidden");
            showToast("Bank & Admin updated successfully!");
            await loadBanksModule();
            await loadOrganizationsDropdown();
        } catch (err) {
            if (errEl) errEl.textContent = err.message;
        } finally {
            form.dataset.submitting = "false";
            if (submitBtn && origBtnText) submitBtn.innerHTML = origBtnText;
        }
    });
}

window.openEditBankModal = function(id) {
    const bank = (state.banks || []).find(b => b.id === id);
    if (!bank) return;

    qs("#edit-bank-id").value = bank.id;
    qs("#edit-bank-name").value = bank.name;
    if (qs("#edit-bank-admin-username")) qs("#edit-bank-admin-username").value = bank.admin_username || "";
    if (qs("#edit-bank-admin-email")) qs("#edit-bank-admin-email").value = bank.admin_email || "";
    if (qs("#edit-bank-admin-password")) qs("#edit-bank-admin-password").value = "";

    const errEl = qs("#edit-bank-error");
    if (errEl) errEl.textContent = "";
    qs("#edit-bank-modal")?.classList.remove("hidden");
};

window.deleteBank = async function(id, name) {
    const confirmed = await window.confirmDelete({
        title: "Delete Bank Organization",
        itemName: name,
        message: `Are you sure you want to delete bank "${name}"? This will affect its branches and devices.`
    });
    if (!confirmed) return;
    try {
        await api(`/api/banks/${id}`, { method: "DELETE" });
        showToast(`Bank "${name}" deleted successfully!`);
        await loadBanksModule();
        await loadOrganizationsDropdown();
    } catch (err) {
        showToast(err.message, "error");
    }
};


// ══════════════════════════════════════════
//  BRANCH MANAGEMENT MODULE
// ══════════════════════════════════════════
// (branchesModuleInitialized declared at top)

async function loadBranchesModule() {
    if (!state.token) return;
    try {
        const [banks, branches] = await Promise.all([
            api("/api/banks/"),
            api("/api/banks/branches")
        ]);
        state.banks = banks;
        state.branches = branches;

        // Populate Filter
        const filterEl = qs("#branch-bank-filter");
        if (filterEl) {
            let filterHtml = `<option value="all">All Banks (Show All Branches)</option>`;
            banks.forEach(b => {
                filterHtml += `<option value="${b.id}" ${String(b.id) === String(selectedBranchBankFilter) ? "selected" : ""}>Bank: ${escapeHtml(b.name)}</option>`;
            });
            filterEl.innerHTML = filterHtml;
        }

        // Populate Bank selects for Add & Edit branch modals
        const addBankSelect = qs("#branch-bank-id");
        const editBankSelect = qs("#edit-branch-bank-id");
        const bankOptions = '<option value="">— Select Bank —</option>' + banks.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
        if (addBankSelect) addBankSelect.innerHTML = bankOptions;
        if (editBankSelect) editBankSelect.innerHTML = bankOptions;

        renderBranchesTable();
    } catch (err) {
        console.error("Failed to load branches:", err);
        showToast(err.message, "error");
    }

    if (!branchesModuleInitialized) {
        branchesModuleInitialized = true;
        initBranchModalEvents();
    }
}
window.loadBranchesModule = loadBranchesModule;

function renderBranchesTable() {
    const tbody = qs("#branches-table-body");
    const countBadge = qs("#branches-count");

    let filtered = state.branches || [];
    if (selectedBranchBankFilter !== "all") {
        const bankId = parseInt(selectedBranchBankFilter);
        filtered = filtered.filter(b => b.bank_id === bankId);
    }

    if (countBadge) countBadge.textContent = `${filtered.length} branches`;
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400 text-xs">No branches found. Click "Add Branch" to create one.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(b => {
        const statusBadge = b.is_active !== false
            ? `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold uppercase">Active</span>`
            : `<span class="px-2 py-0.5 bg-rose-100 text-rose-700 rounded text-[10px] font-bold uppercase">Inactive</span>`;

        const u1 = b.user1_name || "—";
        const u2 = b.user2_name || "—";
        const u3 = b.user3_name || "—";

        const otp1User = b.otp1_user_name || u1;
        const otp2User = b.otp2_user_name || u2;

        const otp1Badge = (b.enable_otp1 !== false)
            ? `<span class="block text-emerald-700 font-semibold"><i class="bi bi-check-circle-fill text-[10px] mr-1 text-emerald-600"></i>1st OTP (${escapeHtml(otp1User)})</span>`
            : `<span class="block text-slate-400 line-through"><i class="bi bi-x-circle text-[10px] mr-1"></i>1st OTP (Disabled)</span>`;

        const otp2Badge = (b.enable_otp2 !== false)
            ? `<span class="block text-sky-700 font-semibold"><i class="bi bi-check-circle-fill text-[10px] mr-1 text-sky-600"></i>2nd OTP (${escapeHtml(otp2User)})</span>`
            : `<span class="block text-slate-400 line-through"><i class="bi bi-x-circle text-[10px] mr-1"></i>2nd OTP (Disabled)</span>`;

        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="py-3 pr-3 font-semibold text-purple-600">${b.id}</td>
                <td class="py-3 pr-3 font-bold text-slate-900">${escapeHtml(b.name)}</td>
                <td class="py-3 pr-3 text-slate-600 font-semibold">${escapeHtml(b.bank_name || "—")}</td>
                <td class="py-3 pr-3">${statusBadge}</td>
                <td class="py-3 pr-3 text-xs text-slate-600">
                    <span class="block text-emerald-700 font-medium">1. ${escapeHtml(u1)}</span>
                    <span class="block text-sky-700 font-medium">2. ${escapeHtml(u2)}</span>
                    <span class="block text-slate-500 font-medium">3. ${escapeHtml(u3)}</span>
                </td>
                <td class="py-3 pr-3 text-xs">
                    ${otp1Badge}
                    ${otp2Badge}
                </td>
                <td class="py-3 text-right space-x-2">
                    <button class="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 font-semibold rounded text-xs transition" onclick="openEditBranchModal(${b.id})">
                        <i class="bi bi-pencil-square mr-1"></i> Edit
                    </button>
                    <button class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold rounded text-xs transition" onclick="deleteBranch(${b.id}, '${escapeHtml(b.name).replace(/'/g, "\\'")}')">
                        <i class="bi bi-trash mr-1"></i> Delete
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

function setupBranchEmailValidation(prefix) {
    const inputs = [
        qs(`#${prefix}-user1-email`),
        qs(`#${prefix}-user2-email`),
        qs(`#${prefix}-user3-email`)
    ];

    const feedbackEls = [
        qs(`#${prefix}-user1-email-feedback`),
        qs(`#${prefix}-user2-email-feedback`),
        qs(`#${prefix}-user3-email-feedback`)
    ];

    if (!inputs[0] && !inputs[1] && !inputs[2]) return;

    const validateAll = async () => {
        const values = inputs.map(inp => inp ? inp.value.trim().toLowerCase() : "");

        for (let i = 0; i < inputs.length; i++) {
            const inputEl = inputs[i];
            const feedbackEl = feedbackEls[i];
            const val = values[i];

            if (!inputEl || !feedbackEl) continue;

            if (!val) {
                feedbackEl.innerHTML = "";
                inputEl.classList.remove("border-rose-500", "border-emerald-500");
                delete inputEl.dataset.isAvailable;
                continue;
            }

            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
                feedbackEl.innerHTML = `<span class="text-rose-600 font-semibold text-[11px] flex items-center"><i class="bi bi-exclamation-triangle-fill mr-1"></i> Invalid email</span>`;
                inputEl.classList.add("border-rose-500");
                inputEl.classList.remove("border-emerald-500");
                inputEl.dataset.isAvailable = "false";
                continue;
            }

            // Duplicate among 3 users in current branch form
            const otherIndices = [0, 1, 2].filter(idx => idx !== i);
            const duplicateWithOther = otherIndices.some(idx => values[idx] && values[idx] === val);

            if (duplicateWithOther) {
                feedbackEl.innerHTML = `<span class="text-rose-600 font-semibold text-[11px] flex items-center"><i class="bi bi-exclamation-triangle-fill mr-1"></i> Duplicate in branch</span>`;
                inputEl.classList.add("border-rose-500");
                inputEl.classList.remove("border-emerald-500");
                inputEl.dataset.isAvailable = "false";
                continue;
            }

            try {
                let excludeUserIds = [];
                if (prefix.startsWith("edit") && currentEditingBranch) {
                    const b = currentEditingBranch;
                    excludeUserIds = [b.user1_id, b.user2_id, b.user3_id].filter(Boolean);
                }
                const excludeId = excludeUserIds[i] || "";
                const query = `/api/banks/check-email?email=${encodeURIComponent(val)}${excludeId ? `&exclude_user_id=${excludeId}` : ""}`;
                const res = await api(query);

                if (inputEl.value.trim().toLowerCase() !== val) continue;

                if (res.available) {
                    feedbackEl.innerHTML = `<span class="text-emerald-600 font-semibold text-[11px] flex items-center"><i class="bi bi-check-circle-fill mr-1"></i> Available</span>`;
                    inputEl.classList.remove("border-rose-500");
                    inputEl.classList.add("border-emerald-500");
                    inputEl.dataset.isAvailable = "true";
                } else {
                    feedbackEl.innerHTML = `<span class="text-rose-600 font-semibold text-[11px] flex items-center"><i class="bi bi-x-circle-fill mr-1"></i> Already registered</span>`;
                    inputEl.classList.add("border-rose-500");
                    inputEl.classList.remove("border-emerald-500");
                    inputEl.dataset.isAvailable = "false";
                }
            } catch (err) {
                feedbackEl.innerHTML = "";
                delete inputEl.dataset.isAvailable;
            }
        }
    };

    const debouncedValidate = debounce(validateAll, 300);
    inputs.forEach(inp => {
        if (inp) {
            inp.addEventListener("input", debouncedValidate);
            inp.addEventListener("blur", validateAll);
        }
    });
}

function initBranchModalEvents() {
    const addBranchModal = qs("#add-branch-modal");
    const editBranchModal = qs("#edit-branch-modal");

    qs("#branch-bank-filter")?.addEventListener("change", (e) => {
        selectedBranchBankFilter = e.target.value;
        renderBranchesTable();
    });

    setupBranchEmailValidation("branch");
    setupBranchEmailValidation("edit-branch");

    qs("#open-add-branch-modal")?.addEventListener("click", () => {
        qs("#add-branch-form")?.reset();
        const addBankSelect = qs("#branch-bank-id");
        if (addBankSelect && state.banks.length > 0) {
            addBankSelect.value = state.banks[0].id;
        }
        ["branch-user1-email-feedback", "branch-user2-email-feedback", "branch-user3-email-feedback"].forEach(id => {
            const el = qs(`#${id}`);
            if (el) el.innerHTML = "";
        });
        const errEl = qs("#add-branch-error");
        if (errEl) errEl.textContent = "";
        addBranchModal?.classList.remove("hidden");
    });

    qs("#close-add-branch-modal")?.addEventListener("click", () => addBranchModal?.classList.add("hidden"));
    qs("#cancel-add-branch")?.addEventListener("click", () => addBranchModal?.classList.add("hidden"));

    qs("#add-branch-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.target;
        if (form.dataset.submitting === "true") return;
        form.dataset.submitting = "true";

        const submitBtn = form.querySelector('button[type="submit"]');
        const origBtnText = submitBtn ? submitBtn.innerHTML : "";
        if (submitBtn) submitBtn.innerHTML = `<i class="bi bi-arrow-repeat mr-1.5 animate-spin"></i> Saving Branch...`;

        const bankId = parseInt(qs("#branch-bank-id").value);
        const name = qs("#branch-name").value.trim();
        const isActive = qs("#branch-is-active").checked;

        const u1Name = qs("#branch-user1-username")?.value.trim();
        const u1Email = qs("#branch-user1-email")?.value.trim();
        const u1Pass = qs("#branch-user1-password")?.value.trim();
        const u1Wa = qs("#branch-user1-whatsapp")?.value.trim();
        const u1OtpRole = qs("#branch-user1-otp-role")?.value || "otp1";

        const u2Name = qs("#branch-user2-username")?.value.trim();
        const u2Email = qs("#branch-user2-email")?.value.trim();
        const u2Pass = qs("#branch-user2-password")?.value.trim();
        const u2Wa = qs("#branch-user2-whatsapp")?.value.trim();
        const u2OtpRole = qs("#branch-user2-otp-role")?.value || "otp2";

        const u3Name = qs("#branch-user3-username")?.value.trim();
        const u3Email = qs("#branch-user3-email")?.value.trim();
        const u3Pass = qs("#branch-user3-password")?.value.trim();
        const u3Wa = qs("#branch-user3-whatsapp")?.value.trim();
        const u3OtpRole = qs("#branch-user3-otp-role")?.value || "none";

        const enableOtp1 = (u1OtpRole === "otp1" || u2OtpRole === "otp1" || u3OtpRole === "otp1");
        const enableOtp2 = (u1OtpRole === "otp2" || u2OtpRole === "otp2" || u3OtpRole === "otp2");

        const errEl = qs("#add-branch-error");
        if (errEl) errEl.textContent = "";

        const formEmails = [u1Email, u2Email, u3Email].filter(Boolean).map(e => e.toLowerCase());
        if (new Set(formEmails).size !== formEmails.length) {
            if (errEl) errEl.textContent = "Users in this branch cannot have duplicate emails.";
            form.dataset.submitting = "false";
            if (submitBtn && origBtnText) submitBtn.innerHTML = origBtnText;
            return;
        }

        const payload = {
            bank_id: bankId,
            name,
            is_active: isActive,
            enable_otp1: enableOtp1,
            enable_otp2: enableOtp2,
            user1_username: u1Name || null,
            user1_email: u1Email || null,
            user1_password: u1Pass || null,
            user1_whatsapp: u1Wa || null,
            user1_otp_role: u1OtpRole,
            user2_username: u2Name || null,
            user2_email: u2Email || null,
            user2_password: u2Pass || null,
            user2_whatsapp: u2Wa || null,
            user2_otp_role: u2OtpRole,
            user3_username: u3Name || null,
            user3_email: u3Email || null,
            user3_password: u3Pass || null,
            user3_whatsapp: u3Wa || null,
            user3_otp_role: u3OtpRole,
        };

        try {
            await api("/api/banks/branches", {
                method: "POST",
                body: JSON.stringify(payload)
            });
            addBranchModal?.classList.add("hidden");
            showToast("Branch and 3 Users created successfully!");
            await loadBranchesModule();
        } catch (err) {
            if (errEl) errEl.textContent = err.message;
        } finally {
            form.dataset.submitting = "false";
            if (submitBtn && origBtnText) submitBtn.innerHTML = origBtnText;
        }
    });

    qs("#close-edit-branch-modal")?.addEventListener("click", () => editBranchModal?.classList.add("hidden"));
    qs("#cancel-edit-branch")?.addEventListener("click", () => editBranchModal?.classList.add("hidden"));

    qs("#edit-branch-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.target;
        if (form.dataset.submitting === "true") return;
        form.dataset.submitting = "true";

        const submitBtn = form.querySelector('button[type="submit"]');
        const origBtnText = submitBtn ? submitBtn.innerHTML : "";
        if (submitBtn) submitBtn.innerHTML = `<i class="bi bi-arrow-repeat mr-1.5 animate-spin"></i> Saving...`;

        const branchId = qs("#edit-branch-id").value;
        const bankId = parseInt(qs("#edit-branch-bank-id").value);
        const name = qs("#edit-branch-name").value.trim();
        const isActive = qs("#edit-branch-is-active").checked;

        const u1Name = qs("#edit-branch-user1-username")?.value.trim();
        const u1Email = qs("#edit-branch-user1-email")?.value.trim();
        const u1Pass = qs("#edit-branch-user1-password")?.value.trim();
        const u1Wa = qs("#edit-branch-user1-whatsapp")?.value.trim();
        const u1OtpRole = qs("#edit-branch-user1-otp-role")?.value || "otp1";

        const u2Name = qs("#edit-branch-user2-username")?.value.trim();
        const u2Email = qs("#edit-branch-user2-email")?.value.trim();
        const u2Pass = qs("#edit-branch-user2-password")?.value.trim();
        const u2Wa = qs("#edit-branch-user2-whatsapp")?.value.trim();
        const u2OtpRole = qs("#edit-branch-user2-otp-role")?.value || "otp2";

        const u3Name = qs("#edit-branch-user3-username")?.value.trim();
        const u3Email = qs("#edit-branch-user3-email")?.value.trim();
        const u3Pass = qs("#edit-branch-user3-password")?.value.trim();
        const u3Wa = qs("#edit-branch-user3-whatsapp")?.value.trim();
        const u3OtpRole = qs("#edit-branch-user3-otp-role")?.value || "none";

        const enableOtp1 = (u1OtpRole === "otp1" || u2OtpRole === "otp1" || u3OtpRole === "otp1");
        const enableOtp2 = (u1OtpRole === "otp2" || u2OtpRole === "otp2" || u3OtpRole === "otp2");

        const errEl = qs("#edit-branch-error");
        if (errEl) errEl.textContent = "";

        const payload = {
            bank_id: bankId,
            name,
            is_active: isActive,
            enable_otp1: enableOtp1,
            enable_otp2: enableOtp2,
            user1_username: u1Name || null,
            user1_email: u1Email || null,
            user1_password: u1Pass || null,
            user1_whatsapp: u1Wa || null,
            user1_otp_role: u1OtpRole,
            user2_username: u2Name || null,
            user2_email: u2Email || null,
            user2_password: u2Pass || null,
            user2_whatsapp: u2Wa || null,
            user2_otp_role: u2OtpRole,
            user3_username: u3Name || null,
            user3_email: u3Email || null,
            user3_password: u3Pass || null,
            user3_whatsapp: u3Wa || null,
            user3_otp_role: u3OtpRole,
        };

        try {
            await api(`/api/banks/branches/${branchId}`, {
                method: "PUT",
                body: JSON.stringify(payload)
            });
            editBranchModal?.classList.add("hidden");
            showToast("Branch and Users updated successfully!");
            await loadBranchesModule();
        } catch (err) {
            if (errEl) errEl.textContent = err.message;
        } finally {
            form.dataset.submitting = "false";
            if (submitBtn && origBtnText) submitBtn.innerHTML = origBtnText;
        }
    });
}

window.openEditBranchModal = function(id) {
    const branch = (state.branches || []).find(b => b.id === id);
    if (!branch) return;

    currentEditingBranch = branch;
    qs("#edit-branch-id").value = branch.id;
    qs("#edit-branch-bank-id").value = branch.bank_id;
    qs("#edit-branch-name").value = branch.name;
    qs("#edit-branch-is-active").checked = branch.is_active !== false;

    // User 1
    if (qs("#edit-branch-user1-username")) qs("#edit-branch-user1-username").value = branch.user1_name || "";
    if (qs("#edit-branch-user1-email")) qs("#edit-branch-user1-email").value = branch.user1_email || "";
    if (qs("#edit-branch-user1-password")) qs("#edit-branch-user1-password").value = "";
    if (qs("#edit-branch-user1-whatsapp")) qs("#edit-branch-user1-whatsapp").value = branch.user1_whatsapp || "";
    if (qs("#edit-branch-user1-otp-role")) {
        qs("#edit-branch-user1-otp-role").value = (branch.otp1_user_id === branch.user1_id && branch.enable_otp1 !== false) ? "otp1" : ((branch.otp2_user_id === branch.user1_id && branch.enable_otp2 !== false) ? "otp2" : "none");
    }

    // User 2
    if (qs("#edit-branch-user2-username")) qs("#edit-branch-user2-username").value = branch.user2_name || "";
    if (qs("#edit-branch-user2-email")) qs("#edit-branch-user2-email").value = branch.user2_email || "";
    if (qs("#edit-branch-user2-password")) qs("#edit-branch-user2-password").value = "";
    if (qs("#edit-branch-user2-whatsapp")) qs("#edit-branch-user2-whatsapp").value = branch.user2_whatsapp || "";
    if (qs("#edit-branch-user2-otp-role")) {
        qs("#edit-branch-user2-otp-role").value = (branch.otp2_user_id === branch.user2_id && branch.enable_otp2 !== false) ? "otp2" : ((branch.otp1_user_id === branch.user2_id && branch.enable_otp1 !== false) ? "otp1" : "none");
    }

    // User 3
    if (qs("#edit-branch-user3-username")) qs("#edit-branch-user3-username").value = branch.user3_name || "";
    if (qs("#edit-branch-user3-email")) qs("#edit-branch-user3-email").value = branch.user3_email || "";
    if (qs("#edit-branch-user3-password")) qs("#edit-branch-user3-password").value = "";
    if (qs("#edit-branch-user3-whatsapp")) qs("#edit-branch-user3-whatsapp").value = branch.user3_whatsapp || "";
    if (qs("#edit-branch-user3-otp-role")) {
        qs("#edit-branch-user3-otp-role").value = (branch.otp1_user_id === branch.user3_id && branch.enable_otp1 !== false) ? "otp1" : ((branch.otp2_user_id === branch.user3_id && branch.enable_otp2 !== false) ? "otp2" : "none");
    }

    const errEl = qs("#edit-branch-error");
    if (errEl) errEl.textContent = "";
    qs("#edit-branch-modal")?.classList.remove("hidden");
};

window.deleteBranch = async function(id, name) {
    const confirmed = await window.confirmDelete({
        title: "Delete Branch Location",
        itemName: name,
        message: `Are you sure you want to delete branch "${name}"? This action cannot be undone.`
    });
    if (!confirmed) return;
    try {
        await api(`/api/banks/branches/${id}`, { method: "DELETE" });
        showToast(`Branch "${name}" deleted successfully!`);
        await loadBranchesModule();
    } catch (err) {
        showToast(err.message, "error");
    }
};


// ══════════════════════════════════════════
//  USER MANAGEMENT MODULE
// ══════════════════════════════════════════
// (usersModuleInitialized declared at top)

async function loadUsersModule() {
    if (!state.token) return;
    try {
        const [users, banks, branches] = await Promise.all([
            api("/api/banks/users"),
            api("/api/banks/"),
            api("/api/banks/branches")
        ]);
        state.bankUsers = users;
        state.banks = banks;
        state.branches = branches;

        const countBadge = qs("#users-count");
        if (countBadge) countBadge.textContent = `${users.length} users`;

        // Populate bank dropdowns for Add and Edit User modals
        populateUserModalBankDropdowns();

        const tbody = qs("#users-table-body");
        if (tbody) {
            if (users.length === 0) {
                tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-slate-400 text-xs">No registered users found. Click "Add User" to create one.</td></tr>`;
            } else {
                tbody.innerHTML = users.map(u => {
                    const bankName = u.bank_name || (state.banks.find(b => b.id === u.bank_id)?.name || "—");
                    const branchName = u.branch_name || (state.branches.find(br => br.id === u.branch_id)?.name || "");
                    const locationDisplay = bankName + (branchName ? ` / ${branchName}` : "");

                    const roleBadgeClass = {
                        super_admin: "bg-purple-100 text-purple-700",
                        admin: "bg-sky-100 text-sky-700",
                        bank_admin: "bg-amber-100 text-amber-700",
                        user: "bg-slate-100 text-slate-700"
                    }[u.role] || "bg-slate-100 text-slate-700";

                    const statusBadge = u.is_active !== false
                        ? `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold uppercase">Active</span>`
                        : `<span class="px-2 py-0.5 bg-rose-100 text-rose-700 rounded text-[10px] font-bold uppercase">Inactive</span>`;

                    return `
                        <tr class="hover:bg-slate-50 transition">
                            <td class="py-3 pr-3 font-semibold text-sky-600">${u.id}</td>
                            <td class="py-3 pr-3 font-bold text-slate-900">${escapeHtml(u.username)}</td>
                            <td class="py-3 pr-3 text-slate-600">${escapeHtml(u.email)}</td>
                            <td class="py-3 pr-3 text-slate-500 font-mono text-[11px]">${escapeHtml(u.whatsapp_number || "—")}</td>
                            <td class="py-3 pr-3 text-slate-600 text-xs">${escapeHtml(locationDisplay)}</td>
                            <td class="py-3 pr-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${roleBadgeClass}">${escapeHtml(u.role.replace('_', ' '))}</span></td>
                            <td class="py-3 pr-3">${statusBadge}</td>
                            <td class="py-3 text-right space-x-2">
                                <button class="px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 font-semibold rounded text-xs transition" onclick="openEditUserModal(${u.id})">
                                    <i class="bi bi-pencil-square mr-1"></i> Edit
                                </button>
                                <button class="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold rounded text-xs transition" onclick="deleteUser(${u.id}, '${escapeHtml(u.username).replace(/'/g, "\\'")}')">
                                    <i class="bi bi-trash mr-1"></i> Delete
                                </button>
                            </td>
                        </tr>
                    `;
                }).join("");
            }
        }
    } catch (err) {
        console.error("Failed to load users:", err);
        showToast(err.message, "error");
    }

    if (!usersModuleInitialized) {
        usersModuleInitialized = true;
        initUserModalEvents();
    }
}
window.loadUsersModule = loadUsersModule;

function populateUserModalBankDropdowns() {
    const banks = state.banks || [];
    const bankOptions = '<option value="">— Primary Bank —</option>' + banks.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");

    const addBankSelect = qs("#user-bank-id");
    const editBankSelect = qs("#edit-user-bank-id");
    if (addBankSelect) addBankSelect.innerHTML = bankOptions;
    if (editBankSelect) editBankSelect.innerHTML = bankOptions;
}

function populateUserModalBranchDropdowns(bankId, prefix = "user") {
    const branchSelect = qs(`#${prefix}-branch-id`);
    if (!branchSelect) return;

    let filtered = state.branches || [];
    if (bankId) {
        filtered = filtered.filter(br => String(br.bank_id) === String(bankId));
    }

    branchSelect.innerHTML = '<option value="">— Select Branch —</option>' +
        filtered.map(br => `<option value="${br.id}">${escapeHtml(br.name)}</option>`).join("");
}

function initUserModalEvents() {
    const addUserModal = qs("#add-user-modal");
    const editUserModal = qs("#edit-user-modal");

    // Dynamic bank -> branch change
    qs("#user-bank-id")?.addEventListener("change", (e) => {
        populateUserModalBranchDropdowns(e.target.value, "user");
    });
    qs("#edit-user-bank-id")?.addEventListener("change", (e) => {
        populateUserModalBranchDropdowns(e.target.value, "edit-user");
    });

    // Dynamic role -> bank/branch visibility
    const handleRoleVisibility = (roleSelectId, bankWrapId, branchWrapId) => {
        const role = qs(`#${roleSelectId}`)?.value;
        const needsBank = role === "user" || role === "bank_admin";
        const bankWrap = qs(`#${bankWrapId}`);
        const branchWrap = qs(`#${branchWrapId}`);
        if (bankWrap) bankWrap.style.display = needsBank ? "" : "none";
        if (branchWrap) branchWrap.style.display = (role === "user") ? "" : "none";
    };

    qs("#user-role")?.addEventListener("change", () => handleRoleVisibility("user-role", "user-bank-wrapper", "user-branch-wrapper"));
    qs("#edit-user-role")?.addEventListener("change", () => handleRoleVisibility("edit-user-role", "edit-user-bank-wrapper", "edit-user-branch-wrapper"));

    qs("#open-add-user-modal")?.addEventListener("click", () => {
        qs("#add-user-form")?.reset();
        populateUserModalBankDropdowns();
        populateUserModalBranchDropdowns(null, "user");
        handleRoleVisibility("user-role", "user-bank-wrapper", "user-branch-wrapper");
        const errEl = qs("#add-user-error");
        if (errEl) errEl.textContent = "";
        addUserModal?.classList.remove("hidden");
    });

    qs("#close-add-user-modal")?.addEventListener("click", () => addUserModal?.classList.add("hidden"));
    qs("#cancel-add-user")?.addEventListener("click", () => addUserModal?.classList.add("hidden"));

    qs("#add-user-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.target;
        if (form.dataset.submitting === "true") return;
        form.dataset.submitting = "true";

        const submitBtn = form.querySelector('button[type="submit"]');
        const origBtnText = submitBtn ? submitBtn.innerHTML : "";
        if (submitBtn) submitBtn.innerHTML = `<i class="bi bi-arrow-repeat mr-1.5 animate-spin"></i> Registering...`;

        const username = qs("#user-username").value.trim();
        const email = qs("#user-email").value.trim();
        const whatsapp = qs("#user-whatsapp") ? qs("#user-whatsapp").value.trim() : "";
        const role = qs("#user-role") ? qs("#user-role").value : "user";
        const bankIdVal = qs("#user-bank-id") ? qs("#user-bank-id").value : "";
        const branchIdVal = qs("#user-branch-id") ? qs("#user-branch-id").value : "";
        const password = qs("#user-password").value.trim();
        const isActive = qs("#user-is-active") ? qs("#user-is-active").checked : true;

        const errEl = qs("#add-user-error");
        if (errEl) errEl.textContent = "";

        const payload = {
            username,
            email,
            whatsapp_number: whatsapp || null,
            role,
            bank_id: bankIdVal ? parseInt(bankIdVal) : null,
            branch_id: branchIdVal ? parseInt(branchIdVal) : null,
            password,
            is_active: isActive
        };

        try {
            await api("/api/banks/users", {
                method: "POST",
                body: JSON.stringify(payload)
            });
            addUserModal?.classList.add("hidden");
            showToast("User registered successfully!");
            await loadUsersModule();
        } catch (err) {
            if (errEl) errEl.textContent = err.message;
        } finally {
            form.dataset.submitting = "false";
            if (submitBtn && origBtnText) submitBtn.innerHTML = origBtnText;
        }
    });

    qs("#close-edit-user-modal")?.addEventListener("click", () => editUserModal?.classList.add("hidden"));
    qs("#cancel-edit-user")?.addEventListener("click", () => editUserModal?.classList.add("hidden"));

    qs("#edit-user-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.target;
        if (form.dataset.submitting === "true") return;
        form.dataset.submitting = "true";

        const submitBtn = form.querySelector('button[type="submit"]');
        const origBtnText = submitBtn ? submitBtn.innerHTML : "";
        if (submitBtn) submitBtn.innerHTML = `<i class="bi bi-arrow-repeat mr-1.5 animate-spin"></i> Saving...`;

        const userId = qs("#edit-user-id").value;
        const username = qs("#edit-user-username").value.trim();
        const email = qs("#edit-user-email").value.trim();
        const whatsapp = qs("#edit-user-whatsapp") ? qs("#edit-user-whatsapp").value.trim() : "";
        const role = qs("#edit-user-role") ? qs("#edit-user-role").value : "user";
        const bankIdVal = qs("#edit-user-bank-id") ? qs("#edit-user-bank-id").value : "";
        const branchIdVal = qs("#edit-user-branch-id") ? qs("#edit-user-branch-id").value : "";
        const password = qs("#edit-user-password") ? qs("#edit-user-password").value.trim() : "";
        const isActive = qs("#edit-user-is-active") ? qs("#edit-user-is-active").checked : true;

        const errEl = qs("#edit-user-error");
        if (errEl) errEl.textContent = "";

        const payload = {
            username,
            email,
            whatsapp_number: whatsapp || null,
            role,
            bank_id: bankIdVal ? parseInt(bankIdVal) : null,
            branch_id: branchIdVal ? parseInt(branchIdVal) : null,
            is_active: isActive
        };
        if (password) payload.password = password;

        try {
            await api(`/api/banks/users/${userId}`, {
                method: "PUT",
                body: JSON.stringify(payload)
            });
            editUserModal?.classList.add("hidden");
            showToast("User updated successfully!");
            await loadUsersModule();
        } catch (err) {
            if (errEl) errEl.textContent = err.message;
        } finally {
            form.dataset.submitting = "false";
            if (submitBtn && origBtnText) submitBtn.innerHTML = origBtnText;
        }
    });
}

window.openEditUserModal = function(id) {
    const user = (state.bankUsers || []).find(u => u.id === id);
    if (!user) return;

    qs("#edit-user-id").value = user.id;
    qs("#edit-user-username").value = user.username;
    qs("#edit-user-email").value = user.email;
    if (qs("#edit-user-whatsapp")) qs("#edit-user-whatsapp").value = user.whatsapp_number || "";
    if (qs("#edit-user-role")) qs("#edit-user-role").value = user.role;
    if (qs("#edit-user-password")) qs("#edit-user-password").value = "";
    if (qs("#edit-user-is-active")) qs("#edit-user-is-active").checked = user.is_active !== false;

    populateUserModalBankDropdowns();
    if (qs("#edit-user-bank-id")) qs("#edit-user-bank-id").value = user.bank_id || "";
    populateUserModalBranchDropdowns(user.bank_id, "edit-user");
    if (qs("#edit-user-branch-id")) qs("#edit-user-branch-id").value = user.branch_id || "";

    const role = user.role;
    const needsBank = role === "user" || role === "bank_admin";
    if (qs("#edit-user-bank-wrapper")) qs("#edit-user-bank-wrapper").style.display = needsBank ? "" : "none";
    if (qs("#edit-user-branch-wrapper")) qs("#edit-user-branch-wrapper").style.display = (role === "user") ? "" : "none";

    const errEl = qs("#edit-user-error");
    if (errEl) errEl.textContent = "";
    qs("#edit-user-modal")?.classList.remove("hidden");
};

window.deleteUser = async function(id, username) {
    const confirmed = await window.confirmDelete({
        title: "Delete User Account",
        itemName: username,
        message: `Are you sure you want to delete user "${username}"? They will lose access immediately.`
    });
    if (!confirmed) return;
    try {
        await api(`/api/users/${id}`, { method: "DELETE" });
        showToast(`User "${username}" deleted successfully!`);
        await loadUsersModule();
    } catch (err) {
        showToast(err.message, "error");
    }
};


// ══════════════════════════════════════════
//  BULK OFFLINE OTP MODULE
// ══════════════════════════════════════════
// (offlineOtpModuleInitialized declared at top)

function initOfflineOtpModule() {
    build100OtpInputs();
    loadOfflineOtpBanks();

    if (!offlineOtpModuleInitialized) {
        offlineOtpModuleInitialized = true;
        initOfflineOtpEvents();
    }
}
window.initOfflineOtpModule = initOfflineOtpModule;

function build100OtpInputs() {
    const inputsGrid = qs("#otp-inputs-grid");
    if (!inputsGrid) return;
    if (inputsGrid.children.length === 100) return; // already built

    inputsGrid.innerHTML = "";
    for (let i = 1; i <= 100; i++) {
        const wrapper = document.createElement("div");
        wrapper.id = `otp-wrapper-${i}`;
        wrapper.className = "bg-slate-50 border border-slate-200 rounded-lg p-2 focus-within:border-sky-500 transition shadow-2xs";
        wrapper.innerHTML = `
            <div id="otp-badge-${i}" class="flex items-center justify-between text-[10px] text-slate-400 font-bold mb-1">
                <span>#${i}</span>
            </div>
            <input type="text" id="otp-input-${i}" maxlength="4" inputmode="numeric" pattern="[0-9]*" placeholder="0000"
                class="otp-digit-input w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-xs text-center text-emerald-600 font-mono focus:outline-none focus:border-sky-500 transition font-bold" />
        `;
        inputsGrid.appendChild(wrapper);
    }

    inputsGrid.addEventListener("input", (e) => {
        if (e.target && e.target.classList.contains("otp-digit-input")) {
            e.target.value = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
        }
    });

    inputsGrid.addEventListener("paste", (e) => {
        if (e.target && e.target.classList.contains("otp-digit-input")) {
            setTimeout(() => {
                e.target.value = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
            }, 0);
        }
    });
}

async function loadOfflineOtpBanks() {
    try {
        const banks = await api("/api/banks/");
        const bankSelect = qs("#otp-bank-select");
        if (bankSelect) {
            bankSelect.innerHTML = `<option value="">-- Choose Bank --</option>` +
                banks.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
        }
    } catch (err) {
        console.error("Failed to load banks for offline OTP:", err);
    }
}

function initOfflineOtpEvents() {
    const bankSelect = qs("#otp-bank-select");
    const branchSelect = qs("#otp-branch-select");
    const deviceSelect = qs("#otp-device-select");
    const deviceSelectedContainer = qs("#device-selected-container");
    const noDevicePrompt = qs("#no-device-prompt");

    const hideDeviceContainer = () => {
        if (deviceSelectedContainer) deviceSelectedContainer.classList.add("hidden");
        if (noDevicePrompt) noDevicePrompt.classList.remove("hidden");
    };

    bankSelect?.addEventListener("change", async () => {
        currentOtpBankId = bankSelect.value;
        if (branchSelect) {
            branchSelect.innerHTML = `<option value="">-- Choose Branch --</option>`;
            branchSelect.disabled = !currentOtpBankId;
        }
        if (deviceSelect) {
            deviceSelect.innerHTML = `<option value="">-- Select Branch First --</option>`;
            deviceSelect.disabled = true;
        }
        hideDeviceContainer();

        if (currentOtpBankId) {
            try {
                const branches = await api(`/api/banks/${currentOtpBankId}/branches`);
                if (branchSelect) {
                    branchSelect.innerHTML = `<option value="">-- Choose Branch --</option>` +
                        branches.map(br => `<option value="${br.id}">${escapeHtml(br.name)}</option>`).join("");
                }
            } catch (err) {
                showToast("Failed to load branches", "error");
            }
        }
    });

    branchSelect?.addEventListener("change", async () => {
        currentOtpBranchId = branchSelect.value;
        if (deviceSelect) {
            deviceSelect.innerHTML = `<option value="">-- Choose Device --</option>`;
            deviceSelect.disabled = !currentOtpBranchId;
        }
        hideDeviceContainer();

        if (currentOtpBranchId) {
            try {
                const devices = await api("/api/devices/");
                const branchDevs = devices.filter(d => String(d.branch_id) === String(currentOtpBranchId));
                if (deviceSelect) {
                    deviceSelect.innerHTML = `<option value="">-- Choose Device --</option>` +
                        branchDevs.map(d => `<option value="${d.id}" data-name="${escapeHtml(d.name)}">${escapeHtml(d.name)} (ID: ${d.id})</option>`).join("");
                    if (branchDevs.length === 0) {
                        showToast("No devices found under this branch", "info");
                    }
                }
            } catch (err) {
                showToast("Failed to load devices", "error");
            }
        }
    });

    deviceSelect?.addEventListener("change", () => {
        currentOtpDeviceId = deviceSelect.value;
        const selectedOpt = deviceSelect.options[deviceSelect.selectedIndex];
        currentOtpDeviceName = selectedOpt ? selectedOpt.getAttribute("data-name") || "" : "";

        if (!currentOtpDeviceId) {
            hideDeviceContainer();
            return;
        }

        const activeDevName = qs("#active-device-name");
        if (activeDevName) activeDevName.textContent = currentOtpDeviceName || `Device #${currentOtpDeviceId}`;

        loadDeviceOTPs(currentOtpDeviceId);
    });

    // Auto Random
    qs("#btn-auto-random")?.addEventListener("click", () => {
        const uniqueSet = new Set();
        while (uniqueSet.size < 100) {
            const code = String(Math.floor(1000 + Math.random() * 9000));
            uniqueSet.add(code);
        }
        const codes = Array.from(uniqueSet);
        for (let i = 1; i <= 100; i++) {
            const inp = qs(`#otp-input-${i}`);
            if (inp) inp.value = codes[i - 1];
        }
        showToast("Generated 100 unique 4-digit random OTPs", "info");
    });

    // Clear All
    qs("#btn-clear-all")?.addEventListener("click", async () => {
        const confirmed = await window.confirmDelete({
            title: "Clear All OTP Fields",
            message: "Are you sure you want to clear all 100 OTP input fields? This cannot be undone."
        });
        if (confirmed) {
            for (let i = 1; i <= 100; i++) {
                const inp = qs(`#otp-input-${i}`);
                if (inp) inp.value = "";
            }
            showToast("Cleared all OTP input fields", "info");
        }
    });

    // Reset Status
    qs("#btn-reset-status")?.addEventListener("click", async () => {
        if (!currentOtpDeviceId) {
            showToast("Please select a device first", "error");
            return;
        }
        if (confirm("Reset all sent OTP statuses to active for this device?")) {
            try {
                const data = await api(`/api/otp/device/${currentOtpDeviceId}/reset-status`, { method: "POST" });
                if (data.status === "success") {
                    showToast("All sent OTP statuses reset to active", "success");
                    loadDeviceOTPs(currentOtpDeviceId);
                } else {
                    showToast(data.detail || "Failed to reset statuses", "error");
                }
            } catch (err) {
                showToast("Error resetting statuses: " + err.message, "error");
            }
        }
    });

    // Save & Publish MQTT
    qs("#save-publish-otps-btn")?.addEventListener("click", () => saveBulkOTPs(true));
}

async function loadDeviceOTPs(deviceId) {
    try {
        const data = await api(`/api/otp/device/${deviceId}`);
        const container = qs("#device-selected-container");
        const prompt = qs("#no-device-prompt");
        if (container) container.classList.remove("hidden");
        if (prompt) prompt.classList.add("hidden");

        const lastSync = qs("#active-device-last-sync");
        if (lastSync) {
            lastSync.textContent = data.updated_at ? new Date(data.updated_at).toLocaleString() : "Never";
        }

        const otps = data.otps || [];
        const statuses = data.statuses || [];

        for (let i = 1; i <= 100; i++) {
            const inp = qs(`#otp-input-${i}`);
            const wrapper = qs(`#otp-wrapper-${i}`);
            const badge = qs(`#otp-badge-${i}`);
            const status = (statuses[i - 1] || "active").toString().toLowerCase();

            if (inp) {
                const rawVal = (otps[i - 1] || "").toString();
                inp.value = rawVal.replace(/[^0-9]/g, "").slice(0, 4);

                if (status === "sent" || status === "used") {
                    inp.className = "otp-digit-input w-full bg-rose-50 border border-rose-300 rounded px-1.5 py-1 text-xs text-center text-rose-600 font-mono focus:outline-none focus:border-rose-400 transition font-bold";
                    if (wrapper) wrapper.className = "bg-rose-50/50 border border-rose-200 rounded-lg p-2 focus-within:border-rose-400 transition shadow-2xs";
                    if (badge) badge.innerHTML = `<span>#${i}</span><span class="text-rose-600 font-bold text-[9px] uppercase tracking-wider">USED</span>`;
                } else {
                    inp.className = "otp-digit-input w-full bg-white border border-slate-200 rounded px-1.5 py-1 text-xs text-center text-emerald-600 font-mono focus:outline-none focus:border-sky-500 transition font-bold";
                    if (wrapper) wrapper.className = "bg-slate-50 border border-slate-200 rounded-lg p-2 focus-within:border-sky-500 transition shadow-2xs";
                    if (badge) badge.innerHTML = `<span>#${i}</span>`;
                }
            }
        }
    } catch (err) {
        showToast("Error loading device OTPs: " + err.message, "error");
    }
}

async function saveBulkOTPs(publishMqtt = true) {
    if (!currentOtpDeviceId) {
        showToast("Please select a device first", "error");
        return;
    }

    const otps = [];
    for (let i = 1; i <= 100; i++) {
        const inp = qs(`#otp-input-${i}`);
        otps.push(inp ? inp.value.trim() : "");
    }

    const payload = {
        device_id: parseInt(currentOtpDeviceId),
        otps: otps,
        publish_mqtt: publishMqtt
    };

    const targetBtn = qs("#save-publish-otps-btn");
    const origContent = targetBtn ? targetBtn.innerHTML : "";
    if (targetBtn) {
        targetBtn.disabled = true;
        targetBtn.innerHTML = `<i class="bi bi-arrow-repeat animate-spin mr-1"></i> Saving &amp; Publishing...`;
    }

    try {
        const resData = await api(`/api/otp/device/${currentOtpDeviceId}`, {
            method: "POST",
            body: JSON.stringify(payload)
        });

        if (resData.status === "success") {
            let msg = `Successfully saved 100 OTPs.`;
            if (publishMqtt) {
                msg += ` Published to MQTT topic /OTP/${currentOtpDeviceName || currentOtpDeviceId}`;
            }
            showToast(msg, "success");
            const lastSync = qs("#active-device-last-sync");
            if (lastSync) lastSync.textContent = new Date().toLocaleString();
            loadDeviceOTPs(currentOtpDeviceId);
        } else {
            showToast(resData.detail || "Failed to save OTPs", "error");
        }
    } catch (err) {
        showToast("Error saving OTPs: " + err.message, "error");
    } finally {
        if (targetBtn) {
            targetBtn.disabled = false;
            targetBtn.innerHTML = origContent;
        }
    }
}


// ══════════════════════════════════════════
//  DIGITAL CLOCK & REPORT HELPERS
// ══════════════════════════════════════════
function updateTopbarClock() {
    const clockEl = qs("#nav-clock");
    const dateEl = qs("#nav-date");
    if (!clockEl || !dateEl) return;

    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    const hoursStr = String(hours).padStart(2, "0");
    clockEl.textContent = `${hoursStr}:${minutes}:${seconds} ${ampm}`;

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    dateEl.textContent = `${year}/${month}/${day}`;
}
setInterval(updateTopbarClock, 1000);
updateTopbarClock();

async function generateOtpReport(deviceId) {
    if (!deviceId) {
        showToast("Please select a device first.", "error");
        return;
    }
    try {
        const data = await api(`/api/camera/${deviceId}/otp-report`);
        const devName = qs("#report-device-name");
        const devLoc = qs("#report-device-location");
        const totalCount = qs("#report-total-count");

        if (devName) devName.textContent = data.device_name;
        if (devLoc) devLoc.textContent = data.location || "—";
        if (totalCount) totalCount.textContent = data.total_records;

        const tbody = qs("#report-table-body");
        if (tbody) {
            if (data.report.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-slate-400 font-sans">No OTP activity records found for this device.</td></tr>';
            } else {
                tbody.innerHTML = data.report.map(r => `
                    <tr class="hover:bg-slate-50">
                        <td class="py-2 px-3">${new Date(r.created_at).toLocaleString()}</td>
                        <td class="py-2 px-3"><span class="bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase">${escapeHtml(r.message_type)}</span></td>
                        <td class="py-2 px-3">${escapeHtml(r.user1)}</td>
                        <td class="py-2 px-3">${escapeHtml(r.user2)}</td>
                        <td class="py-2 px-3 font-sans">
                            ${r.email_sent ? '<span class="text-emerald-600 font-medium inline-flex items-center"><i class="bi bi-envelope-fill mr-1 text-[10px]"></i>Email</span> ' : ''}
                            ${r.whatsapp_sent ? '<span class="text-emerald-600 font-medium inline-flex items-center"><i class="bi bi-whatsapp mr-1 text-[10px]"></i>WA</span>' : ''}
                        </td>
                        <td class="py-2 px-3"><span class="text-emerald-600 font-bold">${escapeHtml(r.status)}</span></td>
                    </tr>
                `).join("");
            }
        }

        qs("#otp-report-modal")?.classList.remove("hidden");
    } catch (err) {
        showToast(err.message, "error");
    }
}
window.generateOtpReport = generateOtpReport;

qs("#generate-report-btn")?.addEventListener("click", () => {
    generateOtpReport(state.selectedDeviceId);
});
qs("#close-report-modal-btn")?.addEventListener("click", () => qs("#otp-report-modal")?.classList.add("hidden"));
qs("#dismiss-report-btn")?.addEventListener("click", () => qs("#otp-report-modal")?.classList.add("hidden"));
qs("#print-report-btn")?.addEventListener("click", () => window.print());

// ══════════════════════════════════════════
//  SECURITY ALERTS MODULE
// ══════════════════════════════════════════
let _allSecurityAlerts = [];

async function loadSecurityAlerts(isBackground = false) {
    if (!state.token) return;
    try {
        const res = await api("/api/alerts/");
        if (res && res.success) {
            _allSecurityAlerts = res.alerts || [];

            // Update header & stat badges
            const countBadge = qs("#alerts-count-badge");
            if (countBadge) countBadge.textContent = String(res.count);

            const totalStat = qs("#stat-total-alerts");
            if (totalStat) totalStat.textContent = String(res.count);

            const openStat = qs("#stat-open-alerts");
            if (openStat) openStat.textContent = String(res.open_count);

            const critStat = qs("#stat-critical-alerts");
            if (critStat) critStat.textContent = String(res.critical_count + res.high_count);

            const overviewAlertCount = qs("#stat-alerts-count");
            if (overviewAlertCount) overviewAlertCount.textContent = String(res.open_count);

            renderSecurityAlertsTable(_allSecurityAlerts);
            renderDashboardRecentAlerts(_allSecurityAlerts);
        }
    } catch (e) {
        if (!isBackground) console.warn("Failed to load security alerts:", e);
    }
}

function renderSecurityAlertsTable(alerts) {
    const tbody = qs("#alerts-table-body");
    if (!tbody) return;

    if (!alerts || alerts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-slate-400 text-xs">No matching security alerts found.</td></tr>`;
        return;
    }

    tbody.innerHTML = alerts.map(item => {
        // Severity badge matching screenshot
        const sevLower = (item.severity || "").toLowerCase();
        let sevClass = "bg-amber-100 text-amber-800 border-amber-200";
        if (sevLower === "critical") sevClass = "bg-red-100 text-red-700 border-red-200";
        else if (sevLower === "high") sevClass = "bg-rose-100 text-rose-700 border-rose-200";
        else if (sevLower === "low") sevClass = "bg-slate-100 text-slate-700 border-slate-200";

        // Status badge matching screenshot
        const statLower = (item.status || "").toLowerCase();
        let statusBadge = `<span class="bg-rose-50 border border-rose-200 text-rose-600 px-2.5 py-0.5 rounded-full text-xs font-semibold">Open</span>`;
        if (statLower === "resolved") {
            statusBadge = `<span class="bg-emerald-50 border border-emerald-200 text-emerald-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">Resolved</span>`;
        } else if (statLower === "in progress") {
            statusBadge = `<span class="bg-amber-50 border border-amber-200 text-amber-700 px-2.5 py-0.5 rounded-full text-xs font-semibold">In Progress</span>`;
        }

        const isSimulatedBadge = item.is_simulated
            ? `<span class="ml-2 bg-purple-100 text-purple-700 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">SIMULATED</span>`
            : `<span class="ml-2 bg-rose-100 text-rose-700 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">LIVE</span>`;

        return `
            <tr class="hover:bg-slate-50/80 transition-colors">
                <td class="px-4 py-3 font-medium text-slate-900">
                    <div class="flex items-center">
                        <span class="font-semibold text-slate-900">${escapeHtml(item.title)}</span>
                        ${isSimulatedBadge}
                    </div>
                </td>
                <td class="px-4 py-3">
                    <span class="${sevClass} border px-2.5 py-0.5 rounded text-xs font-bold">${escapeHtml(item.severity)}</span>
                </td>
                <td class="px-4 py-3">
                    <span class="bg-slate-100 text-slate-700 rounded px-2 py-0.5 text-xs font-medium">${escapeHtml(item.alert_type)}</span>
                </td>
                <td class="px-4 py-3 font-semibold text-slate-800">${escapeHtml(item.device_name)}</td>
                <td class="px-4 py-3 font-medium text-slate-600">${escapeHtml(item.camera_name)}</td>
                <td class="px-4 py-3">${statusBadge}</td>
                <td class="px-4 py-3 text-slate-500">${escapeHtml(item.handled_by || '—')}</td>
                <td class="px-4 py-3 text-slate-500 font-mono text-[11px]">${escapeHtml(item.raised || '5d ago')}</td>
                <td class="px-4 py-3 text-right">
                    ${item.status === 'Open' ? `
                        <button onclick="window.updateAlertStatus(${item.id}, 'Resolved', this)" class="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded text-xs font-semibold transition cursor-pointer">
                            Resolve
                        </button>
                    ` : `
                        <button onclick="window.updateAlertStatus(${item.id}, 'Open', this)" class="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded text-xs font-semibold transition cursor-pointer">
                            Reopen
                        </button>
                    `}
                </td>
            </tr>
        `;
    }).join("");
}

function renderDashboardRecentAlerts(alerts) {
    const alertsList = qs("#recent-alerts-list");
    if (!alertsList) return;

    if (!alerts || alerts.length === 0) {
        alertsList.innerHTML = `<div class="text-center py-4 text-slate-400 text-xs">No active security alerts. Fleet is healthy.</div>`;
        return;
    }

    const openAlerts = alerts.filter(a => a.status === "Open").slice(0, 4);
    if (openAlerts.length === 0) {
        alertsList.innerHTML = `<div class="text-center py-4 text-emerald-600 text-xs font-medium"><i class="bi bi-shield-check mr-1"></i> All security alerts resolved. Fleet healthy.</div>`;
        return;
    }

    alertsList.innerHTML = openAlerts.map(a => {
        const sevLower = (a.severity || "").toLowerCase();
        let sevClass = "bg-amber-100 text-amber-800 border-amber-200";
        if (sevLower === "critical") sevClass = "bg-red-100 text-red-700 border-red-200";
        else if (sevLower === "high") sevClass = "bg-rose-100 text-rose-700 border-rose-200";

        return `
            <div class="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-lg hover:border-slate-300 transition">
                <div class="flex items-center space-x-2.5 min-w-0">
                    <span class="${sevClass} border px-2 py-0.5 rounded text-[10px] font-bold uppercase shrink-0">${escapeHtml(a.severity)}</span>
                    <span class="text-xs font-semibold text-slate-900 truncate">${escapeHtml(a.title)}</span>
                </div>
                <div class="flex items-center space-x-2 shrink-0 ml-2">
                    <span class="text-[10px] text-slate-400 font-mono">${escapeHtml(a.raised || '')}</span>
                    <a href="/alerts" class="text-sky-600 hover:text-sky-800 text-xs font-semibold">View</a>
                </div>
            </div>
        `;
    }).join("");
}

function filterAlerts() {
    const searchVal = (qs("#alerts-search-input")?.value || "").toLowerCase().trim();
    const sevVal = qs("#alerts-severity-filter")?.value || "all";
    const statusVal = qs("#alerts-status-filter")?.value || "all";

    let filtered = _allSecurityAlerts.filter(item => {
        if (sevVal !== "all" && item.severity.toLowerCase() !== sevVal.toLowerCase()) return false;
        if (statusVal !== "all" && item.status.toLowerCase() !== statusVal.toLowerCase()) return false;
        if (searchVal) {
            const corpus = `${item.title} ${item.device_name} ${item.camera_name} ${item.alert_type} ${item.severity} ${item.status}`.toLowerCase();
            if (!corpus.includes(searchVal)) return false;
        }
        return true;
    });

    const countBadge = qs("#alerts-count-badge");
    if (countBadge) countBadge.textContent = String(filtered.length);

    renderSecurityAlertsTable(filtered);
}

async function updateAlertStatus(alertId, newStatus, btnEl) {
    if (!alertId) return;
    let origHtml = "";
    if (btnEl) {
        origHtml = btnEl.innerHTML;
        btnEl.disabled = true;
        btnEl.innerHTML = `<i class="bi bi-arrow-repeat animate-spin"></i>`;
    }
    try {
        const res = await api(`/api/alerts/${alertId}/status`, {
            method: "POST",
            body: JSON.stringify({ status: newStatus })
        });
        if (res && res.success) {
            showToast(`Alert #${alertId} marked as ${newStatus}`, "success");
            await loadSecurityAlerts();
        } else {
            showToast(res?.message || "Failed to update alert", "error");
        }
    } catch (e) {
        showToast(e.message || "Failed to update alert", "error");
    } finally {
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerHTML = origHtml;
        }
    }
}

async function resetAlertsDefaults() {
    try {
        const res = await api("/api/alerts/reset-defaults", { method: "POST" });
        if (res && res.success) {
            showToast("Simulation alerts reset to default", "success");
            await loadSecurityAlerts();
        }
    } catch (e) {
        showToast(e.message || "Failed to reset alerts", "error");
    }
}

function exportAlertsCsv() {
    if (!_allSecurityAlerts || _allSecurityAlerts.length === 0) {
        showToast("No alert data to export", "info");
        return;
    }
    const headers = ["ID", "Alert", "Simulated", "Severity", "Type", "Device", "Camera", "Status", "Handled By", "Raised", "Details"];
    const rows = _allSecurityAlerts.map(a => [
        a.id,
        `"${(a.title || '').replace(/"/g, '""')}"`,
        a.is_simulated ? "SIMULATED" : "LIVE",
        a.severity,
        a.alert_type,
        `"${(a.device_name || '').replace(/"/g, '""')}"`,
        `"${(a.camera_name || '').replace(/"/g, '""')}"`,
        a.status,
        `"${(a.handled_by || '').replace(/"/g, '""')}"`,
        a.raised,
        `"${(a.details || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `security_alerts_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Security alerts exported to CSV", "success");
}

window.loadSecurityAlerts = loadSecurityAlerts;
window.filterAlerts = filterAlerts;
window.updateAlertStatus = updateAlertStatus;
window.resetAlertsDefaults = resetAlertsDefaults;
window.exportAlertsCsv = exportAlertsCsv;

// ── Start Application ──
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}

