// ── State ──
const state = {
    token: localStorage.getItem("token") || null,
    user: null,
    devices: [],
    selectedDeviceId: null,
    currentMode: "thread",
    otpTimer: null,
};

// ── API Helper ──
async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json" };
    if (state.token) headers["Authorization"] = `Bearer ${state.token}`;

    const res = await fetch(path, { ...options, headers });
    if (res.status === 204) return null;

    const data = await res.json();
    if (!res.ok) {
        const msg = typeof data.detail === "string" ? data.detail : (data.detail?.[0]?.msg || "An error occurred");
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
function showToast(message, type = "success") {
    const container = qs("#toast-container");
    const iconMap = {
        success: "bi bi-check-circle-fill",
        error: "bi bi-exclamation-circle-fill",
        info: "bi bi-info-circle-fill",
    };
    const el = document.createElement("div");
    el.className = `toast-notification toast-${type}`;
    el.innerHTML = `<i class="${iconMap[type] || iconMap.info}"></i><span>${escapeHtml(message)}</span>`;
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = "0";
        el.style.transform = "translateX(100%)";
        el.style.transition = "all 0.4s ease";
        setTimeout(() => el.remove(), 400);
    }, 3500);
}


let cameraTimestampInterval = null;
let currentStreamMode = null; // "mjpeg" or "webrtc"

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

function setStreamStatus(text, type) {
    const el = qs("#stream-status");
    if (!el) return;
    el.textContent = text;
    el.className = "stream-status " + (type || "info");
}

// ── MJPEG Streaming (Exclusive) ──
function startMjpegStream(deviceId) {
    stopAllStreams();
    currentStreamMode = "mjpeg";

    const mjpegEl = qs("#camera-feed-mjpeg");

    if (mjpegEl) {
        mjpegEl.style.display = "block";
        setStreamStatus("Connecting...", "info");

        // Set MJPEG source — browser handles the multipart streaming automatically, pass token as query param
        mjpegEl.src = `/api/camera/${deviceId}/mjpeg${state.token ? `?token=${state.token}` : ""}`;

        mjpegEl.onload = () => {
            setStreamStatus("Live", "live");
        };

        mjpegEl.onerror = () => {
            setStreamStatus("Stream failed. Click refresh to retry.", "error");
        };
    }
}

function stopMjpeg() {
    const mjpegEl = qs("#camera-feed-mjpeg");
    if (mjpegEl) {
        mjpegEl.removeAttribute("src");
        mjpegEl.src = "";
        mjpegEl.style.display = "none";
    }
}

function stopAllStreams() {
    stopMjpeg();
    currentStreamMode = null;
    setStreamStatus("Stopped", "info");
}

// Poll OTP requests every 5 seconds
let otpRequestsInterval = null;

async function loadOtpRequests() {
    if (!state.token) return;
    try {
        const requests = await api("/api/camera/otp-requests");
        console.log("Requests: ", requests);
        renderOtpRequests(requests);
    } catch (err) {
        console.error("Failed to load OTP requests:", err);
    }
}

function renderOtpRequests(requests) {
    const list = qs("#otp-requests-list");
    const countBadge = qs("#otp-request-count");
    if (!list || !countBadge) return;

    countBadge.textContent = requests.length;

    if (requests.length === 0) {
        list.innerHTML = `<div class="empty-state text-muted py-3 text-center"><p class="mb-0 small">No active requests.</p></div>`;
        return;
    }

    list.innerHTML = requests.map(req => {
        const timeStr = formatTime(req.created_at);
        const devId = req.payload?.device_id || req.device_name;
        return `
            <div class="device-item otp-req-item" onclick="selectDevice(${req.device_id})">
                <div class="d-flex align-items-center justify-content-between">
                    <span class="device-name text-warning font-weight-bold"><i class="bi bi-shield-exclamation mr-1"></i> OTP Request</span>
                    <span class="text-muted small">${timeStr}</span>
                </div>
                <div class="device-location">Device ID: ${escapeHtml(String(devId))}</div>
                <div class="device-info">Time: ${escapeHtml(req.payload?.time || '')} | Relay: ${req.payload?.relay || 0}</div>
                <div class="mt-1"><span class="badge badge-warning text-dark">Click to Confirm</span></div>
            </div>
        `;
    }).join("");
}

// ══════════════════════════════════════════
//  INITIALIZATION
// ══════════════════════════════════════════
async function init() {
    try {
        state.user = await api("/api/users/me");
        showPage("dashboard-page");
        qs("#user-display span").textContent = state.user.username;
        await loadDevices();

        // Start polling OTP requests
        loadOtpRequests();
        if (otpRequestsInterval) clearInterval(otpRequestsInterval);
        otpRequestsInterval = setInterval(loadOtpRequests, 5000);
    } catch (err) {
        console.error("Auto-login failed:", err);
        state.token = null;
        localStorage.removeItem("token");
        showPage("login-page");
    }
}

// ══════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════

// Login
qs("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = qs("#login-username").value.trim();
    const password = qs("#login-password").value.trim();

    try {
        const data = await api("/api/users/login", {
            method: "POST",
            body: JSON.stringify({ username, password }),
        });
        state.token = data.access_token;
        localStorage.setItem("token", data.access_token);
        state.user = await api("/api/users/me");
        showPage("dashboard-page");
        qs("#user-display span").textContent = state.user.username;
        await loadDevices();
    } catch (err) {
        qs("#login-error").textContent = err.message;
    }
});

// Register
qs("#register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = qs("#reg-username").value.trim();
    const email = qs("#reg-email").value.trim();
    const password = qs("#reg-password").value.trim();

    if (username.length < 3) {
        qs("#register-error").textContent = "Username must be at least 3 characters.";
        return;
    }
    if (password.length < 6) {
        qs("#register-error").textContent = "Password must be at least 6 characters.";
        return;
    }

    try {
        await api("/api/users/register", {
            method: "POST",
            body: JSON.stringify({ username, email, password }),
        });
        // Switch to login tab
        const loginTab = document.querySelector('.auth-tabs .nav-link');
        if (loginTab) loginTab.click();
        qs("#login-username").value = username;
        qs("#register-error").textContent = "";
        showToast("Registration successful! Please sign in.");
    } catch (err) {
        qs("#register-error").textContent = err.message;
    }
});

// Logout
qs("#logout-btn").addEventListener("click", () => {
    state.token = null;
    state.user = null;
    state.devices = [];
    state.selectedDeviceId = null;
    localStorage.removeItem("token");
    showPage("login-page");
    stopAllStreams();
    stopCameraTimestamp();
    if (otpRequestsInterval) {
        clearInterval(otpRequestsInterval);
        otpRequestsInterval = null;
    }
});

// ══════════════════════════════════════════
//  DEVICES
// ══════════════════════════════════════════

async function loadDevices() {
    try {
        state.devices = await api("/api/devices/");
        renderDeviceList();
        populateCameraDropdown();
    } catch (err) {
        console.error("Failed to load devices:", err);
    }
}

function renderDeviceList() {
    const list = qs("#device-list");
    list.innerHTML = "";
    const countBadge = qs("#device-count");

    countBadge.textContent = state.devices.length;

    if (state.devices.length === 0) {
        list.innerHTML = `<div class="empty-state text-muted py-4"><i class="bi bi-camera fs-2 mb-2"></i><p class="mb-0 small">No devices yet. Add one!</p></div>`;
        return;
    }

    state.devices.forEach((device) => {
        const item = document.createElement("div");
        item.className = `device-item${device.id === state.selectedDeviceId ? " active" : ""}`;
        const typeIcon = device.device_type === "usb_camera" ? "bi-usb" : "bi-camera-video";
        item.innerHTML = `
            <div class="device-name"><i class="bi ${typeIcon} mr-1 text-muted"></i> ${escapeHtml(device.name)}</div>
            <div class="device-location"><i class="bi bi-geo-alt mr-1"></i>${device.location || "No location"}</div>
            <div class="device-info">${device.host || "N/A"} : ${device.port || 554}</div>
            <span class="device-status ${device.is_online ? "online" : "offline"}">
                ${device.is_online ? "● Online" : "○ Offline"}
            </span>
        `;
        item.addEventListener("click", () => selectDevice(device.id));
        list.appendChild(item);
    });
}

// ── Camera Dropdown ──
function populateCameraDropdown() {
    const dropdown = qs("#camera-dropdown");
    if (!dropdown) return;

    // Keep the placeholder
    dropdown.innerHTML = '<option value="">— Select a camera —</option>';

    state.devices.forEach((device) => {
        const opt = document.createElement("option");
        opt.value = device.id;
        const statusDot = device.is_online ? "🟢" : "🔴";
        opt.textContent = `${statusDot} ${device.name} — ${device.location || "No location"}`;
        if (device.id === state.selectedDeviceId) opt.selected = true;
        dropdown.appendChild(opt);
    });

    // Show camera selector bar if devices exist
    const bar = qs("#camera-selector-bar");
    if (state.devices.length > 0) {
        bar.classList.remove("hidden");
    } else {
        bar.classList.add("hidden");
    }
}

// Camera dropdown change handler
qs("#camera-dropdown").addEventListener("change", (e) => {
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
}

function showDeviceView(device) {
    qs("#add-device-form").classList.add("hidden");
    qs("#empty-state").classList.add("hidden");
    qs("#device-view").classList.remove("hidden");

    qs("#view-device-name").textContent = `${device.name}`;

    // Status
    const online = device.is_online;
    qs("#view-device-status").textContent = online ? "● Online" : "○ Offline";
    qs("#view-device-status").className = `status-badge ${online ? "online" : "offline"}`;



    qs("#view-device-location").textContent = `📍 ${device.location || "No location set"}`;
    qs("#view-device-rtsp").textContent = `🔗 ${device.rtsp_url || "Auto-configured"}`;

    // Device config bar
    renderDeviceConfig(device);

    // Start MJPEG streaming (primary, reliable)
    startMjpegStream(device.id);
    startCameraTimestamp();

    // Hide action result when switching devices
    qs("#action-result").classList.add("hidden");
}

function renderDeviceConfig(device) {
    const bar = qs("#device-config-display");
    const configs = [
        { label: "Host", value: device.host || "—" },
        { label: "Port", value: device.port || 554 },
        { label: "Stream", value: device.stream_path || "/stream1" },
        { label: "Transport", value: device.transport || "tcp" },
        { label: "Type", value: device.device_type || "ip_camera" },
    ];

    bar.innerHTML = configs.map(c =>
        `<span class="config-item"><strong>${c.label}</strong>${escapeHtml(String(c.value))}</span>`
    ).join("");
}

// ── Edit/Delete Device ──
let editingDeviceId = null;

function updateFormFields() {
    const deviceType = qs("#device-type").value;
    const manualCard = qs("#manual-rtsp-card");
    const rtspLabel = qs("#device-rtsp-label");
    const rtspInput = qs("#device-rtsp");

    if (deviceType === "usb_camera") {
        if (manualCard) manualCard.classList.add("hidden");
        if (rtspLabel) rtspLabel.textContent = "CAMERA INDEX (e.g. 0)";
        if (rtspInput) rtspInput.placeholder = "e.g. 0, 1, 2";
    } else {
        if (manualCard) manualCard.classList.remove("hidden");
        if (rtspLabel) rtspLabel.textContent = "FULL RTSP URL (optional)";
        if (rtspInput) rtspInput.placeholder = "rtsp://username:password@192.168.1.100:554/stream1";
    }
}

// Listen for device connection type changes
qs("#device-type").addEventListener("change", updateFormFields);

// ── Auto-parse RTSP URL into form fields ──
function parseRtspUrl(url) {
    if (!url || !url.startsWith("rtsp://")) return null;
    try {
        // Parse: rtsp://[username:password@]host[:port][/path]
        const urlObj = new URL(url.replace("rtsp://", "http://"));
        return {
            host: urlObj.hostname || null,
            port: urlObj.port ? parseInt(urlObj.port) : 554,
            username: urlObj.username ? decodeURIComponent(urlObj.username) : null,
            password: urlObj.password ? decodeURIComponent(urlObj.password) : null,
            stream_path: urlObj.pathname || "/stream1",
        };
    } catch (e) {
        return null;
    }
}

// Auto-populate manual fields when RTSP URL is entered
qs("#device-rtsp").addEventListener("blur", () => {
    const rtspVal = qs("#device-rtsp").value.trim();
    if (!rtspVal) return;
    const parsed = parseRtspUrl(rtspVal);
    if (!parsed) return;

    // Only fill in empty fields — don't overwrite user-entered data
    if (!qs("#device-host").value.trim() && parsed.host) {
        qs("#device-host").value = parsed.host;
    }
    if (qs("#device-port").value === "554" && parsed.port && parsed.port !== 554) {
        qs("#device-port").value = parsed.port;
    } else if (parsed.port) {
        qs("#device-port").value = parsed.port;
    }
    if (!qs("#device-rtsp-user").value.trim() && parsed.username) {
        qs("#device-rtsp-user").value = parsed.username;
    }
    if (!qs("#device-rtsp-pass").value.trim() && parsed.password) {
        qs("#device-rtsp-pass").value = parsed.password;
    }
    if ((qs("#device-stream-path").value === "/stream1" || !qs("#device-stream-path").value.trim()) && parsed.stream_path) {
        qs("#device-stream-path").value = parsed.stream_path;
    }
});

function resetDeviceForm() {
    qs("#device-name").value = "";
    qs("#device-rtsp").value = "";
    qs("#device-host").value = "";
    qs("#device-port").value = "554";
    qs("#device-rtsp-user").value = "";
    qs("#device-rtsp-pass").value = "";
    qs("#device-stream-path").value = "/stream1";
    qs("#device-transport").value = "tcp";
    qs("#device-location").value = "";
    qs("#device-manufacturer").value = "";
    qs("#device-error").textContent = "";
    editingDeviceId = null;
    qs("#device-form-title").textContent = "Add New Device";
    qs("#save-device-btn").innerHTML = '<i class="bi bi-floppy mr-1"></i> Save Device';
    updateFormFields();
}

function populateDeviceForm(device) {
    qs("#device-name").value = device.name || "";
    qs("#device-rtsp").value = device.rtsp_url || "";
    qs("#device-host").value = device.host || "";
    qs("#device-port").value = device.port || "554";
    qs("#device-rtsp-user").value = device.username || "";
    qs("#device-rtsp-pass").value = "";  // Don't populate password for security
    qs("#device-stream-path").value = device.stream_path || "/stream1";
    qs("#device-transport").value = device.transport || "tcp";
    qs("#device-location").value = device.location || "";
    qs("#device-manufacturer").value = device.manufacturer || "";
    qs("#device-type").value = device.device_type || "ip_camera";
    editingDeviceId = device.id;
    qs("#device-form-title").textContent = "Edit Device";
    qs("#save-device-btn").innerHTML = '<i class="bi bi-pencil mr-1"></i> Update Device';
    qs("#device-error").textContent = "";
    updateFormFields();
}

// Add Device button
qs("#add-device-btn").addEventListener("click", () => {
    qs("#add-device-form").classList.remove("hidden");
    qs("#device-view").classList.add("hidden");
    qs("#empty-state").classList.add("hidden");
    resetDeviceForm();
});

// Edit Device button
qs("#edit-device-btn").addEventListener("click", () => {
    if (!state.selectedDeviceId) return;
    const device = state.devices.find(d => d.id === state.selectedDeviceId);
    if (!device) return;
    qs("#add-device-form").classList.remove("hidden");
    qs("#device-view").classList.add("hidden");
    qs("#empty-state").classList.add("hidden");
    populateDeviceForm(device);
});

// Delete Device button
qs("#delete-device-btn").addEventListener("click", async () => {
    if (!state.selectedDeviceId) return;
    const device = state.devices.find(d => d.id === state.selectedDeviceId);
    if (!device) return;
    if (!confirm(`Delete device "${device.name}"? This cannot be undone.`)) return;
    try {
        await api(`/api/devices/${state.selectedDeviceId}`, { method: "DELETE" });
        state.selectedDeviceId = null;
        await loadDevices();
        qs("#device-view").classList.add("hidden");
        qs("#empty-state").classList.remove("hidden");
        stopAllStreams();
        showToast(`Device "${device.name}" deleted!`, "success");
    } catch (err) {
        showToast(err.message, "error");
    }
});

qs("#cancel-device-btn").addEventListener("click", () => {
    qs("#add-device-form").classList.add("hidden");
    resetDeviceForm();
    if (state.selectedDeviceId) {
        const device = state.devices.find((d) => d.id === state.selectedDeviceId);
        if (device) showDeviceView(device);
    } else {
        qs("#empty-state").classList.remove("hidden");
    }
});

// Build device data from form
function getDeviceFormData() {
    const name = qs("#device-name").value.trim();
    const rtsp_url = qs("#device-rtsp").value.trim();
    const device_type = qs("#device-type").value;
    const host = qs("#device-host").value.trim();
    const port = parseInt(qs("#device-port").value) || 554;
    const username = qs("#device-rtsp-user").value.trim();
    const password = qs("#device-rtsp-pass").value.trim();
    const stream_path = qs("#device-stream-path").value.trim() || "/stream1";
    const transport = qs("#device-transport").value;
    const location = qs("#device-location").value.trim();
    const manufacturer = qs("#device-manufacturer").value.trim();

    return { name, rtsp_url, device_type, host, port, username, password, stream_path, transport, location, manufacturer };
}

qs("#save-device-btn").addEventListener("click", async () => {
    const data = getDeviceFormData();
    if (!data.name) {
        qs("#device-error").textContent = "Device name is required.";
        return;
    }

    try {
        if (editingDeviceId) {
            // Don't send empty password on edit
            if (!data.password) delete data.password;
            if (!data.rtsp_url) delete data.rtsp_url;

            const device = await api(`/api/devices/${editingDeviceId}`, {
                method: "PUT",
                body: JSON.stringify(data),
            });
            await loadDevices();
            qs("#add-device-form").classList.add("hidden");
            resetDeviceForm();
            selectDevice(device.id);
            showToast(`Device "${device.name}" updated!`);
        } else {
            const device = await api("/api/devices/", {
                method: "POST",
                body: JSON.stringify(data),
            });
            await loadDevices();
            qs("#add-device-form").classList.add("hidden");
            selectDevice(device.id);
            showToast(`Device "${device.name}" added successfully!`);
        }
    } catch (err) {
        qs("#device-error").textContent = err.message;
    }
});

// Validate Stream
qs("#validate-stream-btn").addEventListener("click", async () => {
    if (!state.selectedDeviceId) return;
    const btn = qs("#validate-stream-btn");
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm mr-1" role="status" aria-hidden="true"></span> Validating...';

    try {
        const result = await api(`/api/camera/${state.selectedDeviceId}/validate`, {
            method: "POST",
        });
        if (result.reachable) {
            showToast("Stream reachable! ✓", "success");
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
qs("#refresh-stream-btn").addEventListener("click", () => {
    if (!state.selectedDeviceId) return;
    startMjpegStream(state.selectedDeviceId);
    showToast("Stream restarting...", "info");
});

// ══════════════════════════════════════════
//  SEND ACTION (Thread / No Thread)
// ══════════════════════════════════════════

qs("#send-action-btn").addEventListener("click", async () => {
    if (!state.selectedDeviceId) {
        showToast("Please select a device first.", "error");
        return;
    }

    const mode = qs("#mode-dropdown").value;
    const btn = qs("#send-action-btn");
    const statusIndicator = qs("#mode-status-indicator");

    // Update UI to sending state
    btn.classList.add("sending");
    btn.innerHTML = '<span class="spinner-border spinner-border-sm mr-1" role="status" aria-hidden="true"></span> Sending...';
    statusIndicator.innerHTML = '<i class="bi bi-circle-fill text-warning mr-1" style="font-size:8px;animation:livePulse 1s infinite;"></i><span class="text-warning small">Processing...</span>';

    try {
        const result = await api(`/api/camera/${state.selectedDeviceId}/send-action`, {
            method: "POST",
            body: JSON.stringify({ mode }),
        });

        // Show action result
        showActionResult(result);

        // Show toast based on mode
        if (mode === "thread") {
            const emailStatus = result.email_sent ? "📧 Email sent!" : "⚠️ Email not configured";
            showToast(`Thread: OTP generated. ${emailStatus}`, result.email_sent ? "success" : "info");
        } else {
            showToast("No Thread — message saved locally. No email.", "info");
        }

        // Update status indicator
        statusIndicator.innerHTML = '<i class="bi bi-check-circle-fill text-success mr-1" style="font-size:10px;"></i><span class="text-success small">Sent!</span>';

    } catch (err) {
        showToast(err.message, "error");
        statusIndicator.innerHTML = '<i class="bi bi-x-circle-fill text-danger mr-1" style="font-size:10px;"></i><span class="text-danger small">Failed</span>';
    } finally {
        btn.classList.remove("sending");
        btn.innerHTML = '<i class="bi bi-send mr-1"></i> Send';

        // Reset status after 5 seconds
        setTimeout(() => {
            statusIndicator.innerHTML = '<i class="bi bi-circle-fill text-muted mr-1" style="font-size:8px;"></i><span class="text-muted small">Ready</span>';
        }, 5000);
    }
});

// ── Show Action Result ──
function showActionResult(result) {
    const panel = qs("#action-result");
    const body = qs("#action-result-body");
    const title = qs("#action-result-title");

    panel.classList.remove("hidden");

    if (result.mode === "thread") {
        title.innerHTML = '<i class="bi bi-lock mr-2 text-warning"></i> Thread — OTP Generated';
        body.innerHTML = `
            <div class="text-center mb-3">
                <div class="otp-display-inline">${escapeHtml(result.otp_code || "------")}</div>
            </div>
            <div class="result-item">
                <div class="result-icon ${result.email_sent ? 'success' : 'warning'}">
                    <i class="bi ${result.email_sent ? 'bi-envelope-open' : 'bi-envelope'}"></i>
                </div>
                <div>
                    <strong>Email</strong><br>
                    <span class="text-muted small">${result.email_sent ? 'OTP sent to your email' : 'SMTP not configured — email not sent'}</span>
                </div>
            </div>
            ${result.otp_expires_at ? `
            <div class="result-item">
                <div class="result-icon info">
                    <i class="bi bi-clock"></i>
                </div>
                <div>
                    <strong>Expires</strong><br>
                    <span class="text-muted small" id="otp-countdown">${formatExpiry(result.otp_expires_at)}</span>
                </div>
            </div>` : ''}
        `;

        // Start countdown if expiry provided
        if (result.otp_expires_at) {
            startOtpCountdown(result.otp_expires_at);
        }
    } else if (result.mode === "no_threat") {
        title.innerHTML = '<i class="bi bi-shield-check mr-2 text-success"></i> NO THREAT — Double OTP Sent';
        body.innerHTML = `
            <div class="text-center mb-3">
                <div class="d-flex justify-content-center">
                    <div class="mx-3 text-center">
                        <small class="text-muted d-block mb-1">1st OTP (Requested User)</small>
                        <div class="font-weight-bold px-3 py-1" style="font-size: 24px; border: 2px dashed #28a745; border-radius: 8px; background: rgba(40,167,69,0.1); color: #28a745; display: inline-block;">${escapeHtml(result.otp1 || "----")}</div>
                    </div>
                    <div class="mx-3 text-center">
                        <small class="text-muted d-block mb-1">2nd OTP (Mapped User: ${escapeHtml(result.mapped_user)})</small>
                        <div class="font-weight-bold px-3 py-1" style="font-size: 24px; border: 2px dashed #17a2b8; border-radius: 8px; background: rgba(23,162,184,0.1); color: #17a2b8; display: inline-block;">${escapeHtml(result.otp2 || "----")}</div>
                    </div>
                </div>
            </div>
            <div class="result-item mt-3">
                <div class="result-icon success">
                    <i class="bi bi-broadcast"></i>
                </div>
                <div>
                    <strong>MQTT Publisher</strong><br>
                    <span class="text-muted small">${result.mqtt_sent ? 'Sent successfully to topic <code>/OTP/' + escapeHtml(state.devices.find(d => d.id === state.selectedDeviceId)?.name || '') + '</code>' : 'MQTT Broker connection failed or skipped'}</span>
                </div>
            </div>
            <div class="result-item">
                <div class="result-icon success">
                    <i class="bi bi-envelope-check"></i>
                </div>
                <div>
                    <strong>Email Delivery</strong><br>
                    <span class="text-muted small">OTPs sent to users' emails successfully</span>
                </div>
            </div>
        `;
    } else {
        title.innerHTML = '<i class="bi bi-database mr-2 text-info"></i> No Thread — Local Message';
        body.innerHTML = `
            <div class="result-item">
                <div class="result-icon info">
                    <i class="bi bi-database"></i>
                </div>
                <div>
                    <strong>Message Saved Locally</strong><br>
                    <span class="text-muted small">No Thread — stored in database only</span>
                </div>
            </div>
            <div class="result-item">
                <div class="result-icon warning">
                    <i class="bi bi-envelope-open"></i>
                </div>
                <div>
                    <strong>Email</strong><br>
                    <span class="text-muted small">Not sent (No Thread mode)</span>
                </div>
            </div>
        `;
    }
}

// Close result panel
qs("#close-result-btn").addEventListener("click", () => {
    qs("#action-result").classList.add("hidden");
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
            el.textContent = "⏰ Expired — generate a new OTP";
            el.style.color = "var(--danger)";
            return;
        }

        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        el.textContent = `⏱ Valid for ${minutes}:${String(seconds).padStart(2, "0")}`;
    }, 1000);
}

function formatExpiry(isoStr) {
    const expiry = new Date(isoStr);
    const diff = expiry.getTime() - Date.now();
    if (diff <= 0) return "Expired";
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `⏱ Valid for ${minutes}:${String(seconds).padStart(2, "0")}`;
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

// ── Start App ──
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}

