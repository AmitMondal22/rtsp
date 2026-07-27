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

let activeWebSocket = null;
let currentBlobUrl = null;

// ── WebSocket RTSP Streaming (Primary) ──
function startWebSocketStream(deviceId) {
    stopAllStreams();
    currentStreamMode = "websocket";

    const mjpegEl = qs("#camera-feed-mjpeg");
    if (!mjpegEl) return;

    mjpegEl.style.display = "block";
    setStreamStatus("Connecting WebSocket...", "info");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/camera/${deviceId}/ws${state.token ? `?token=${state.token}` : ""}`;

    try {
        activeWebSocket = new WebSocket(wsUrl);
        activeWebSocket.binaryType = "blob";

        activeWebSocket.onopen = () => {
            setStreamStatus("Live (WebSocket)", "live");
            startCameraTimestamp();
        };

        activeWebSocket.onmessage = (event) => {
            if (typeof event.data === "string") {
                try {
                    const parsed = JSON.parse(event.data);
                    if (parsed.error) {
                        setStreamStatus("WS Error: " + parsed.error, "error");
                        startMjpegStream(deviceId);
                    }
                } catch (e) {}
                return;
            }

            if (event.data instanceof Blob) {
                const newUrl = URL.createObjectURL(event.data);
                mjpegEl.src = newUrl;

                if (currentBlobUrl) {
                    URL.revokeObjectURL(currentBlobUrl);
                }
                currentBlobUrl = newUrl;
                setStreamStatus("Live (WebSocket)", "live");
            }
        };

        activeWebSocket.onerror = (err) => {
            console.warn("WebSocket stream error, fallback to MJPEG:", err);
            startMjpegStream(deviceId);
        };

        activeWebSocket.onclose = () => {
            if (currentStreamMode === "websocket") {
                startMjpegStream(deviceId);
            }
        };
    } catch (e) {
        console.error("Failed to initialize WebSocket stream:", e);
        startMjpegStream(deviceId);
    }
}

function stopWebSocket() {
    if (activeWebSocket) {
        try {
            activeWebSocket.close();
        } catch (e) {}
        activeWebSocket = null;
    }
    if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = null;
    }
}

// ── MJPEG Streaming (Fallback) ──
function startMjpegStream(deviceId) {
    stopWebSocket();
    currentStreamMode = "mjpeg";

    const mjpegEl = qs("#camera-feed-mjpeg");

    if (mjpegEl) {
        mjpegEl.style.display = "block";
        setStreamStatus("Connecting MJPEG...", "info");

        mjpegEl.src = `/api/camera/${deviceId}/mjpeg${state.token ? `?token=${state.token}` : ""}`;

        mjpegEl.onload = () => {
            setStreamStatus("Live (MJPEG)", "live");
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
    stopWebSocket();
    stopMjpeg();
    stopCameraTimestamp();
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
        state.otpRequests = requests;
        renderOtpRequests(requests);
        updateSendButtonState();
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

function updateSendButtonState() {
    const btn = qs("#send-action-btn");
    if (!btn) return;

    if (btn.classList.contains("sending")) return;

    if (!state.selectedDeviceId) {
        btn.disabled = true;
        return;
    }

    const deviceRequests = (state.otpRequests || []).filter(
        req => req.device_id === state.selectedDeviceId
    );

    if (deviceRequests.length === 0) {
        btn.disabled = true;
        const hint = qs(".mode-action-hint");
        if (hint) {
            hint.innerHTML = `<i class="bi bi-info-circle mr-1"></i> Waiting for OTP Request`;
            hint.className = "mode-action-hint text-brand-muted text-[10px]";
            hint.removeAttribute("style");
        }
        return;
    }

    deviceRequests.sort((a, b) => new Date(b.created_at + (b.created_at.endsWith("Z") ? "" : "Z")) - new Date(a.created_at + (a.created_at.endsWith("Z") ? "" : "Z")));
    const latestReq = deviceRequests[0];

    const dateStr = latestReq.created_at.endsWith("Z") ? latestReq.created_at : latestReq.created_at + "Z";
    const ageMs = Date.now() - new Date(dateStr).getTime();

    const FIVE_MINUTES_MS = 5 * 60 * 1000; // 300,000 ms (5 minutes)

    const hint = qs(".mode-action-hint");
    if (ageMs <= FIVE_MINUTES_MS && ageMs >= 0) {
        btn.disabled = false;
        if (hint) {
            const totalSecLeft = Math.max(0, Math.ceil((FIVE_MINUTES_MS - ageMs) / 1000));
            const mins = Math.floor(totalSecLeft / 60);
            const secs = totalSecLeft % 60;
            const timeFormatted = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
            hint.innerHTML = `<i class="bi bi-clock-history mr-1 text-emerald-400"></i> Request Active: ${timeFormatted} remaining`;
            hint.className = "mode-action-hint text-[10px]";
            hint.style.color = "var(--success, #10b981)";
            hint.style.fontWeight = "600";
        }
    } else {
        btn.disabled = true;
        if (hint) {
            hint.innerHTML = `<i class="bi bi-exclamation-circle mr-1 text-red-400"></i> OTP Request Expired (> 5m ago)`;
            hint.className = "mode-action-hint text-[10px]";
            hint.style.color = "var(--danger, #ef4444)";
            hint.style.fontWeight = "600";
        }
    }
}

// ══════════════════════════════════════════
//  INITIALIZATION
// ══════════════════════════════════════════
async function init() {
    try {
        state.user = await api("/api/users/me");
    } catch (err) {
        console.error("Auto-login failed:", err);
        state.token = null;
        localStorage.removeItem("token");
        window.location.href = "/";
        return;
    }

    const userDropName = qs("#user-dropdown-username");
    const userDropRole = qs("#user-dropdown-role");
    if (userDropName) userDropName.textContent = state.user.username;
    if (userDropRole) userDropRole.textContent = state.user.role.toUpperCase();

    // Show/hide navigation tabs based on roles
    const banksTab = qs("#nav-banks-tab");
    const branchesTab = qs("#nav-branches-tab");
    const usersTab = qs("#nav-users-tab");
    const addDeviceBtn = qs("#add-device-btn");
    const deviceAssignCol = qs("#device-assign-user") ? qs("#device-assign-user").closest(".col-md-4") : null;

    if (state.user.role === "super_admin" || state.user.role === "admin") {
        if (banksTab) banksTab.classList.remove("hidden");
        if (branchesTab) branchesTab.classList.remove("hidden");
        if (usersTab) usersTab.classList.remove("hidden");
        if (addDeviceBtn) addDeviceBtn.classList.remove("hidden");
        if (deviceAssignCol) deviceAssignCol.classList.remove("hidden");
    } else if (state.user.role === "bank_admin") {
        if (banksTab) banksTab.classList.add("hidden");
        if (branchesTab) branchesTab.classList.remove("hidden");
        if (usersTab) usersTab.classList.remove("hidden");
        if (addDeviceBtn) addDeviceBtn.classList.remove("hidden");
        if (deviceAssignCol) deviceAssignCol.classList.remove("hidden");
    } else {
        if (banksTab) banksTab.classList.add("hidden");
        if (branchesTab) branchesTab.classList.add("hidden");
        if (usersTab) usersTab.classList.add("hidden");
        if (addDeviceBtn) addDeviceBtn.classList.add("hidden");
        if (deviceAssignCol) deviceAssignCol.classList.add("hidden");
    }

    try {
        await loadDevices();
    } catch (err) {
        console.error("Devices loading warning:", err);
    }

    try {
        loadOtpRequests();
        if (otpRequestsInterval) clearInterval(otpRequestsInterval);
        otpRequestsInterval = setInterval(loadOtpRequests, 5000);
    } catch (err) {
        console.error("OTP polling warning:", err);
    }

    if (state.sendButtonInterval) clearInterval(state.sendButtonInterval);
    state.sendButtonInterval = setInterval(updateSendButtonState, 1000);
}

// ══════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════

// Logout
qs("#logout-btn").addEventListener("click", () => {
    state.token = null;
    state.user = null;
    state.devices = [];
    state.selectedDeviceId = null;
    localStorage.removeItem("token");
    stopAllStreams();
    stopCameraTimestamp();
    window.location.href = "/";
    if (otpRequestsInterval) {
        clearInterval(otpRequestsInterval);
        otpRequestsInterval = null;
    }
    if (state.sendButtonInterval) {
        clearInterval(state.sendButtonInterval);
        state.sendButtonInterval = null;
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
        loadBankUsers();
    } catch (err) {
        console.error("Failed to load devices:", err);
    }
}

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
            <div class="empty-state text-brand-muted text-center py-6 text-xs">
                <i class="bi bi-camera-video text-3xl opacity-20 mb-2 block"></i>
                <p>No devices registered yet.</p>
            </div>
        `;
        return;
    }

    state.devices.forEach((device) => {
        const item = document.createElement("div");
        
        // Tailwind styling for item
        const isActive = device.id === state.selectedDeviceId;
        item.className = `group px-3 py-2 rounded cursor-pointer transition flex flex-col space-y-1 ${
            isActive 
                ? "bg-brand-blue text-white shadow-md" 
                : "bg-transparent text-[#a0a5b0] hover:bg-[#23242c] hover:text-white"
        }`;
        
        const typeIcon = "bi-camera-video-fill";
        item.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center space-x-2 font-medium text-xs">
                    <i class="bi ${typeIcon}"></i>
                    <span>${escapeHtml(device.name)}</span>
                </div>
            </div>
            <div class="flex items-center justify-between text-[10px]  font-mono">
                <span>${escapeHtml(device.location || "No location")}</span>
                <span>${escapeHtml(device.host || "127.0.0.1")}</span>
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

    // Keep the placeholder
    dropdown.innerHTML = '<option value="">— Select a camera —</option>';

    state.devices.forEach((device) => {
        const opt = document.createElement("option");
        opt.value = device.id;
        const statusDot = "";
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

    updateSendButtonState();
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

    qs("#view-device-location").textContent = ` ${device.location || "No location set"}`;
    qs("#view-device-rtsp").textContent = `${device.rtsp_url || "Auto-configured"}`;

    // Device config bar
    renderDeviceConfig(device);

    // Start WebSocket RTSP streaming (with MJPEG fallback)
    startWebSocketStream(device.id);

    // Fetch and render last request acknowledgment
    loadLastAcknowledgment(device.id);

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
qs("#device-type").addEventListener("change", updateFormFields);

// ── Auto-parse RTSP URL into components ──
function parseRtspUrl(url) {
    if (!url || !url.toLowerCase().startsWith("rtsp://")) return null;
    try {
        const httpUrl = url.replace(/^rtsp:\/\//i, "http://");
        const urlObj = new URL(httpUrl);
        return {
            host: urlObj.hostname || null,
            port: urlObj.port ? parseInt(urlObj.port) : 554,
            username: urlObj.username ? decodeURIComponent(urlObj.username) : null,
            password: urlObj.password ? decodeURIComponent(urlObj.password) : null,
            stream_path: (urlObj.pathname || "/stream1") + (urlObj.search || ""),
        };
    } catch (e) {
        return null;
    }
}

// Auto-populate helper
async function loadBanksAndBranchesForDeviceForm() {
    try {
        state.banks = await api("/api/banks/");
        state.branches = await api("/api/banks/branches");

        const bankSelect = qs("#device-bank-id");
        if (bankSelect) {
            bankSelect.innerHTML = '<option value="">— Select Bank —</option>' +
                state.banks.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
        }
        populateBranchSelectForDeviceForm();
    } catch (e) {
        console.error("Failed to load banks and branches for device form:", e);
    }
}

function populateBranchSelectForDeviceForm(bankId = null) {
    const branchSelect = qs("#device-branch-id");
    if (!branchSelect) return;

    let filtered = state.branches || [];
    if (bankId) {
        filtered = filtered.filter(b => b.bank_id === parseInt(bankId));
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
    if (qs("#device-bank-id")) qs("#device-bank-id").value = "";
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
    if (qs("#device-bank-id")) qs("#device-bank-id").value = device.bank_id || "";
    populateBranchSelectForDeviceForm(device.bank_id);
    if (qs("#device-branch-id")) qs("#device-branch-id").value = device.branch_id || "";
    if (qs("#device-enable-email")) qs("#device-enable-email").checked = device.enable_email !== false;
    if (qs("#device-enable-whatsapp")) qs("#device-enable-whatsapp").checked = device.enable_whatsapp !== false;
    editingDeviceId = device.id;
    qs("#device-form-title").textContent = "Edit Device";
    qs("#save-device-btn").innerHTML = '<i class="bi bi-pencil mr-1"></i> Update Device';
    qs("#device-error").textContent = "";
    updateFormFields();
}

// Add Device button
qs("#add-device-btn").addEventListener("click", async () => {
    qs("#add-device-form").classList.remove("hidden");
    qs("#device-view").classList.add("hidden");
    qs("#empty-state").classList.add("hidden");
    await resetDeviceForm();
});

// Edit Device button
qs("#edit-device-btn").addEventListener("click", async () => {
    if (!state.selectedDeviceId) return;
    const device = state.devices.find(d => d.id === state.selectedDeviceId);
    if (!device) return;
    qs("#add-device-form").classList.remove("hidden");
    qs("#device-view").classList.add("hidden");
    qs("#empty-state").classList.add("hidden");
    await populateDeviceForm(device);
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

qs("#cancel-device-btn")?.addEventListener("click", () => {
    qs("#add-device-form").classList.add("hidden");
    resetDeviceForm();
    if (state.selectedDeviceId) {
        const device = state.devices.find((d) => d.id === state.selectedDeviceId);
        if (device) showDeviceView(device);
    } else {
        qs("#empty-state").classList.remove("hidden");
    }
});

qs("#close-device-modal-btn")?.addEventListener("click", () => {
    qs("#cancel-device-btn")?.click();
});

// Build device data from form
function getDeviceFormData() {
    const name = qs("#device-name").value.trim();
    let rtsp_url = qs("#device-rtsp").value.trim();
    const device_type = "rtsp";
    
    // Auto-prepend rtsp:// scheme if omitted
    if (rtsp_url && !rtsp_url.toLowerCase().startsWith("rtsp://") && !rtsp_url.toLowerCase().startsWith("rtsps://")) {
        rtsp_url = "rtsp://" + rtsp_url;
    }

    // Automatically parse components from RTSP URL
    let host = null, port = 554, username = null, password = null, stream_path = "/stream1";
    if (rtsp_url) {
        const parsed = parseRtspUrl(rtsp_url);
        if (parsed) {
            host = parsed.host;
            port = parsed.port || 554;
            username = parsed.username;
            password = parsed.password;
            stream_path = parsed.stream_path || "/stream1";
        }
    }

    const location = qs("#device-location").value.trim();
    const manufacturer = qs("#device-manufacturer").value.trim();
    const bankVal = qs("#device-bank-id") ? qs("#device-bank-id").value : "";
    const bank_id = bankVal ? parseInt(bankVal) : null;
    const branchVal = qs("#device-branch-id") ? qs("#device-branch-id").value : "";
    const branch_id = branchVal ? parseInt(branchVal) : null;
    const enable_email = qs("#device-enable-email") ? qs("#device-enable-email").checked : true;
    const enable_whatsapp = qs("#device-enable-whatsapp") ? qs("#device-enable-whatsapp").checked : true;

    return { name, rtsp_url, device_type, host, port, username, password, stream_path, transport: "tcp", location, manufacturer, bank_id, branch_id, enable_email, enable_whatsapp };
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

    const payload = { mode };

    // Update UI to sending state
    btn.classList.add("sending");
    btn.innerHTML = '<span class="spinner-border spinner-border-sm mr-1" role="status" aria-hidden="true"></span> Sending...';
    statusIndicator.innerHTML = '<i class="bi bi-circle-fill text-warning mr-1" style="font-size:8px;animation:livePulse 1s infinite;"></i><span class="text-warning small">Processing...</span>';

    try {
        const result = await api(`/api/camera/${state.selectedDeviceId}/send-action`, {
            method: "POST",
            body: JSON.stringify(payload),
        });

        // Show action result
        showActionResult(result);

        // Refresh Last Request & Ack card
        await loadLastAcknowledgment(state.selectedDeviceId);

        // Refresh OTP requests list in sidebar
        await loadOtpRequests();

        // Show toast based on mode
        if (mode === "thread") {
            const emailStatus = result.email_sent ? "📧 Email sent!" : "⚠️ Email not configured";
            showToast(`Thread: OTP generated. ${emailStatus}`, result.email_sent ? "success" : "info");
        } else if (mode === "no_threat") {
            showToast("NO THREAT: Dual OTP sent to selected users!", "success");
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
        console.log(">>>>>>>>>>>>>>>>>>>")
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

// ══════════════════════════════════════════
//  BANK & USER MANAGEMENT (Super / Bank Admin)
// ══════════════════════════════════════════

function showDashboardTab(tabId) {
    // Toggle active classes on vertical tab buttons
    const tabs = ["cameras", "banks", "users"];
    tabs.forEach(t => {
        const tabEl = qs(`#nav-${t}-tab`);
        if (tabEl) {
            tabEl.classList.remove("bg-brand-blue", "text-white");
            tabEl.classList.add("text-slate-400", "hover:text-white");
        }
    });

    const selectedTabEl = qs(`#nav-${tabId}-tab`);
    if (selectedTabEl) {
        selectedTabEl.classList.remove("text-slate-400", "hover:text-white");
        selectedTabEl.classList.add("bg-brand-blue", "text-white");
    }

    const dashboardBody = qs("#dashboard-body");
    const banksPage = qs("#banks-tab-content");
    const usersPage = qs("#users-tab-content");

    if (tabId === "cameras") {
        // Show the main camera layout, hide full-page sections
        if (dashboardBody) dashboardBody.style.display = "";
        if (banksPage) { banksPage.style.display = "none"; banksPage.classList.add("hidden"); }
        if (usersPage) { usersPage.style.display = "none"; usersPage.classList.add("hidden"); }

        const cameraControls = qs("#sidebar-camera-controls");
        const adminInfo = qs("#sidebar-admin-info");
        if (cameraControls) cameraControls.classList.remove("hidden");
        if (adminInfo) adminInfo.classList.add("hidden");
    } else {
        // Hide main camera layout, show the requested full-page
        if (dashboardBody) dashboardBody.style.display = "none";

        // Hide both full pages first
        if (banksPage) { banksPage.style.display = "none"; banksPage.classList.add("hidden"); }
        if (usersPage) { usersPage.style.display = "none"; usersPage.classList.add("hidden"); }

        const target = tabId === "banks" ? banksPage : usersPage;
        if (target) {
            target.style.display = "flex";
            target.classList.remove("hidden");
        }

        // Load data for the tab
        if (tabId === "users") {
            loadBankUsers();
        } else if (tabId === "banks") {
            loadBanks();
        }
    }
}
window.showDashboardTab = showDashboardTab;

// Login / Register tab selectors transition
const tabLoginBtn = qs("#tab-login-btn");
const tabRegisterBtn = qs("#tab-register-btn");
if (tabLoginBtn && tabRegisterBtn) {
    tabLoginBtn.addEventListener("click", () => {
        tabLoginBtn.className = "flex-1 pb-2.5 text-center text-sm font-semibold border-b-2 border-brand-blue text-white";
        tabRegisterBtn.className = "flex-1 pb-2.5 text-center text-sm font-semibold border-b-2 border-transparent text-brand-muted hover:text-white";
        qs("#login-form").classList.remove("hidden");
        qs("#register-form").classList.add("hidden");
    });
    tabRegisterBtn.addEventListener("click", () => {
        tabRegisterBtn.className = "flex-1 pb-2.5 text-center text-sm font-semibold border-b-2 border-brand-blue text-white";
        tabLoginBtn.className = "flex-1 pb-2.5 text-center text-sm font-semibold border-b-2 border-transparent text-brand-muted hover:text-white";
        qs("#register-form").classList.remove("hidden");
        qs("#login-form").classList.add("hidden");
    });
}

async function loadBanks() {
    if (!state.token) return;
    try {
        const banks = await api("/api/banks/");
        state.banks = banks;

        // Populate #user-bank-id dropdown (Users tab)
        const bankSelect = qs("#user-bank-id");
        if (bankSelect) {
            const currentVal = bankSelect.value;
            bankSelect.innerHTML = '<option value="">\u2014 Primary Bank \u2014</option>';
            banks.forEach(b => {
                const opt = document.createElement("option");
                opt.value = b.id;
                opt.textContent = b.name;
                bankSelect.appendChild(opt);
            });
            // Restore previously selected value if it exists
            if (currentVal) bankSelect.value = currentVal;
        }

        // Populate #banks-table-body (Banks tab)
        const tbody = qs("#banks-table-body");
        if (tbody) {
            if (banks.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" class="py-4 text-center text-brand-muted">No banks registered yet.</td></tr>';
            } else {
                tbody.innerHTML = banks.map(b => `
                    <tr class="hover:bg-brand-border/20 transition">
                        <td class="py-2 px-1">${b.id}</td>
                        <td class="py-2 px-1"><strong>${escapeHtml(b.name)}</strong></td>
                        <td class="py-2 px-1">${new Date(b.created_at).toLocaleString()}</td>
                    </tr>
                `).join("");
            }
        }
    } catch (err) {
        console.error("Failed to load banks:", err);
    }
}

async function loadBankUsers() {
    if (!state.token) return;
    try {
        await loadBanks();  // always refresh bank dropdown + table
        const users = await api("/api/banks/users");
        state.bankUsers = users;
        
        populateUserSelectors();

        // Re-apply bank visibility based on current role
        const userRoleSelect = qs("#user-role");
        const userBankWrapper = qs("#user-bank-wrapper");
        if (userRoleSelect && userBankWrapper) {
            const role = userRoleSelect.value;
            const needsBank = role === "user" || role === "bank_admin";
            userBankWrapper.style.display = needsBank ? "" : "none";
        }
        
        const tbody = qs("#users-table-body");
        if (!tbody) return;

        tbody.innerHTML = users.map(u => `
            <tr>
                <td>${u.id}</td>
                <td><strong>${escapeHtml(u.username)}</strong></td>
                <td>${escapeHtml(u.email)}</td>
                <td>${escapeHtml(u.whatsapp_number || "—")}</td>
                <td><span class="badge badge-info">${u.role.toUpperCase()}</span></td>
            </tr>
        `).join("");
    } catch (err) {
        console.error("Failed to load bank users:", err);
    }
}

function populateUserSelectors() {
    const assignSelect = qs("#device-assign-user");
    const assignSelect2 = qs("#device-assign-user-2");
    
    const users = state.bankUsers || [];

    if (assignSelect) {
        assignSelect.innerHTML = '<option value="">— Unassigned / None —</option>';
        users.forEach(u => {
            const opt = document.createElement("option");
            opt.value = u.id;
            opt.textContent = `${u.username} (${u.email}) [${u.role.toUpperCase()}]`;
            assignSelect.appendChild(opt);
        });
    }

    if (assignSelect2) {
        assignSelect2.innerHTML = '<option value="">— Unassigned / None —</option>';
        users.forEach(u => {
            const opt = document.createElement("option");
            opt.value = u.id;
            opt.textContent = `${u.username} (${u.email}) [${u.role.toUpperCase()}]`;
            assignSelect2.appendChild(opt);
        });
    }
}

// Event Listeners
const createBankForm = qs("#create-bank-form");
if (createBankForm) {
    createBankForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const bankName = qs("#bank-name").value.trim();
        const username = qs("#bank-admin-username").value.trim();
        const email = qs("#bank-admin-email").value.trim();
        const password = qs("#bank-admin-password").value.trim();
        const errEl = qs("#bank-form-error");

        try {
            await api("/api/banks/", {
                method: "POST",
                body: JSON.stringify({ bank_name: bankName, username, email, password })
            });
            qs("#bank-name").value = "";
            qs("#bank-admin-username").value = "";
            qs("#bank-admin-email").value = "";
            qs("#bank-admin-password").value = "";
            errEl.textContent = "";
            showToast("Bank and Admin registered successfully!");
            await loadBanks();
        } catch (err) {
            errEl.textContent = err.message;
        }
    });
}

const createUserForm = qs("#create-user-form");
if (createUserForm) {
    // Show/hide bank selector based on role selection
    const userRoleSelect = qs("#user-role");
    const userBankWrapper = qs("#user-bank-wrapper");
    function updateBankVisibility() {
        const role = userRoleSelect ? userRoleSelect.value : "user";
        const needsBank = role === "user" || role === "bank_admin";
        if (userBankWrapper) {
            userBankWrapper.style.display = needsBank ? "" : "none";
        }
    }
    if (userRoleSelect) {
        userRoleSelect.addEventListener("change", updateBankVisibility);
        updateBankVisibility(); // run on page load
    }

    createUserForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = qs("#user-username").value.trim();
        const email = qs("#user-email").value.trim();
        const whatsappNumber = qs("#user-whatsapp") ? qs("#user-whatsapp").value.trim() : "";
        const role = qs("#user-role") ? qs("#user-role").value : "user";
        const needsBank = role === "user" || role === "bank_admin";
        const bankIdVal = needsBank && qs("#user-bank-id") ? qs("#user-bank-id").value : "";
        const bank_id = bankIdVal ? parseInt(bankIdVal) : null;
        const password = qs("#user-password").value.trim();
        const errEl = qs("#user-form-error");

        try {
            await api("/api/banks/users", {
                method: "POST",
                body: JSON.stringify({ username, email, whatsapp_number: whatsappNumber, role, bank_id, password })
            });
            qs("#user-username").value = "";
            qs("#user-email").value = "";
            if (qs("#user-whatsapp")) qs("#user-whatsapp").value = "";
            qs("#user-password").value = "";
            errEl.textContent = "";
            showToast("User registered successfully!");
            await loadBankUsers();
        } catch (err) {
            errEl.textContent = err.message;
        }
    });
}

// Dynamic Topbar Clock
function updateTopbarClock() {
    const clockEl = qs("#nav-clock");
    const dateEl = qs("#nav-date");
    if (!clockEl || !dateEl) return;

    const now = new Date();
    
    // Time format: HH:MM:SS AM/PM
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    const hoursStr = String(hours).padStart(2, "0");
    clockEl.textContent = `${hoursStr}:${minutes}:${seconds} ${ampm}`;

    // Date format: YYYY/MM/DD
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    dateEl.textContent = `${year}/${month}/${day}`;
}
setInterval(updateTopbarClock, 1000);
updateTopbarClock();

// Toggle profile dropdown menu
const userMenuBtn = qs("#user-menu-btn");
const userDropMenu = qs("#user-dropdown-menu");
if (userMenuBtn && userDropMenu) {
    userMenuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        userDropMenu.classList.toggle("hidden");
    });
    document.addEventListener("click", () => {
        userDropMenu.classList.add("hidden");
    });
}

// ── Last Acknowledgment & OTP Report Helpers ──
async function loadLastAcknowledgment(deviceId) {
    const timeEl = qs("#last-ack-time");
    const contentEl = qs("#last-ack-content");
    if (!timeEl || !contentEl) return;

    try {
        const res = await api(`/api/camera/${deviceId}/last-acknowledgment`);
        if (!res.has_ack) {
            timeEl.textContent = "No recent requests";
            contentEl.innerHTML = '<p class="text-brand-muted text-[10px]">No recent device OTP requests or acknowledgments.</p>';
            return;
        }

        timeEl.textContent = formatTime(res.created_at);
        const payload = res.payload || {};
        const otp1 = payload.otp1 || payload.otp_code;
        contentEl.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="font-bold text-white">${escapeHtml(res.content)}</span>
                <span class="badge badge-info text-[9px]">${escapeHtml(res.message_type.toUpperCase())}</span>
            </div>
            ${otp1 ? `<div class="text-[10px] text-brand-muted">OTP 1: <strong class="text-white">${escapeHtml(otp1)}</strong> | OTP 2: <strong class="text-white">${escapeHtml(payload.otp2 || '—')}</strong></div>` : ''}
            <div class="text-[9px] text-brand-muted font-mono">Topic: ${escapeHtml(payload.mqtt_topic || payload.topic || '—')}</div>
        `;
    } catch (err) {
        console.error("Failed to load last acknowledgment:", err);
    }
}

async function generateOtpReport(deviceId) {
    if (!deviceId) {
        showToast("Please select a device first.", "error");
        return;
    }
    try {
        const data = await api(`/api/camera/${deviceId}/otp-report`);
        qs("#report-device-name").textContent = data.device_name;
        qs("#report-device-location").textContent = data.location || "—";
        qs("#report-total-count").textContent = data.total_records;

        const tbody = qs("#report-table-body");
        if (data.report.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-brand-muted">No OTP activity records found for this device.</td></tr>';
        } else {
            tbody.innerHTML = data.report.map(r => {
                return `
                    <tr class="hover:bg-brand-darkBg/50">
                        <td class="py-2.5 px-3">${new Date(r.created_at).toLocaleString()}</td>
                        <td class="py-2.5 px-3"><span class="badge badge-info">${r.message_type.toUpperCase()}</span></td>
                        <td class="py-2.5 px-3">${escapeHtml(r.user1)}</td>
                        <td class="py-2.5 px-3">${escapeHtml(r.user2)}</td>
                        <td class="py-2.5 px-3">
                            ${r.email_sent ? '<span class="text-emerald-400">📧 Email</span> ' : ''}
                            ${r.whatsapp_sent ? '<span class="text-emerald-400">💬 WA</span>' : ''}
                        </td>
                        <td class="py-2.5 px-3"><span class="text-emerald-400 font-bold">${escapeHtml(r.status)}</span></td>
                    </tr>
                `;
            }).join("");
        }

        qs("#otp-report-modal").classList.remove("hidden");
    } catch (err) {
        showToast(err.message, "error");
    }
}

const reportBtn = qs("#generate-report-btn");
if (reportBtn) {
    reportBtn.addEventListener("click", () => {
        generateOtpReport(state.selectedDeviceId);
    });
}

const closeReportBtn = qs("#close-report-modal-btn");
const dismissReportBtn = qs("#dismiss-report-btn");
const reportModal = qs("#otp-report-modal");
if (closeReportBtn && reportModal) {
    closeReportBtn.addEventListener("click", () => reportModal.classList.add("hidden"));
}
if (dismissReportBtn && reportModal) {
    dismissReportBtn.addEventListener("click", () => reportModal.classList.add("hidden"));
}

const printReportBtn = qs("#print-report-btn");
if (printReportBtn) {
    printReportBtn.addEventListener("click", () => {
        window.print();
    });
}

// ── Start App ──
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}

