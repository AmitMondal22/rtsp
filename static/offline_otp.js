document.addEventListener("DOMContentLoaded", () => {
    // Utility shortcuts
    const qs = (sel) => document.querySelector(sel);
    const qsa = (sel) => document.querySelectorAll(sel);

    // Authentication token & user info
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");
    if (!token) {
        window.location.href = "/login";
        return;
    }

    const authHeaders = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
    };

    // State variables
    let currentBankId = null;
    let currentBranchId = null;
    let currentDeviceId = null;
    let currentDeviceName = "";

    // DOM Elements
    const bankSelect = qs("#otp-bank-select");
    const branchSelect = qs("#otp-branch-select");
    const deviceSelect = qs("#otp-device-select");
    const deviceSelectedContainer = qs("#device-selected-container");
    const noDevicePrompt = qs("#no-device-prompt");
    const inputsGrid = qs("#otp-inputs-grid");

    const activeDeviceName = qs("#active-device-name");
    const activeDeviceId = qs("#active-device-id");
    const activeDeviceTopic = qs("#active-device-topic");
    const activeDeviceLastSync = qs("#active-device-last-sync");

    const btnAuto1001 = qs("#btn-auto-1001");
    const btnAutoRandom = qs("#btn-auto-random");
    const btnClearAll = qs("#btn-clear-all");
    const saveOtpsBtn = qs("#save-otps-btn");
    const savePublishOtpsBtn = qs("#save-publish-otps-btn");

    // Initialize 100 inputs in grid
    function build100Inputs() {
        inputsGrid.innerHTML = "";
        for (let i = 1; i <= 100; i++) {
            const wrapper = document.createElement("div");
            wrapper.id = `otp-wrapper-${i}`;
            wrapper.className = "bg-brand-cardBg border border-brand-border rounded-lg p-1.5 focus-within:border-brand-blue transition";
            wrapper.innerHTML = `
                <div id="otp-badge-${i}" class="flex items-center justify-between text-[9px] text-brand-muted font-bold mb-1">
                    <span>#${i}</span>
                </div>
                <input type="text" id="otp-input-${i}" maxlength="4" inputmode="numeric" pattern="[0-9]*" placeholder="0000"
                    class="otp-digit-input w-full bg-brand-sidebar border border-brand-border rounded px-1.5 py-1 text-xs text-center text-emerald-400 font-mono focus:outline-none focus:border-brand-blue transition font-semibold" />
            `;
            inputsGrid.appendChild(wrapper);
        }

        // Restrict input to digits only & max 4 characters
        inputsGrid.addEventListener("input", (e) => {
            if (e.target && e.target.classList.contains("otp-digit-input")) {
                e.target.value = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
            }
        });

        // Handle paste to ensure only numbers up to 4 digits are pasted
        inputsGrid.addEventListener("paste", (e) => {
            if (e.target && e.target.classList.contains("otp-digit-input")) {
                setTimeout(() => {
                    e.target.value = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
                }, 0);
            }
        });
    }

    build100Inputs();

    // Clock
    function updateClock() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour12: true });
        const dateStr = now.toISOString().split('T')[0].replace(/-/g, '/');
        if (qs("#nav-clock")) qs("#nav-clock").textContent = timeStr;
        if (qs("#nav-date")) qs("#nav-date").textContent = dateStr;
    }
    updateClock();
    setInterval(updateClock, 1000);

    // User profile dropdown & logout
    const userMenuBtn = qs("#user-menu-btn");
    const userDropdownMenu = qs("#user-dropdown-menu");
    if (userMenuBtn && userDropdownMenu) {
        userMenuBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            userDropdownMenu.classList.toggle("hidden");
        });
        document.addEventListener("click", () => userDropdownMenu.classList.add("hidden"));
    }

    const logoutBtn = qs("#logout-btn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            localStorage.removeItem("token");
            sessionStorage.removeItem("token");
            window.location.href = "/login";
        });
    }

    // Load current user profile
    fetch("/api/auth/me", { headers: authHeaders })
        .then(res => res.json())
        .then(user => {
            if (user) {
                if (qs("#user-dropdown-username")) qs("#user-dropdown-username").textContent = user.username || user.email;
                if (qs("#user-dropdown-role")) qs("#user-dropdown-role").textContent = (user.role || "USER").toUpperCase();
            }
        })
        .catch(() => {});

    // Load Banks
    function loadBanks() {
        fetch("/api/banks", { headers: authHeaders })
            .then(res => res.json())
            .then(banks => {
                bankSelect.innerHTML = `<option value="">-- Choose Bank --</option>`;
                banks.forEach(b => {
                    bankSelect.innerHTML += `<option value="${b.id}">${b.name}</option>`;
                });
            })
            .catch(err => {
                showToast("Failed to load banks: " + err, "error");
            });
    }

    loadBanks();

    // Bank change handler
    bankSelect.addEventListener("change", () => {
        currentBankId = bankSelect.value;
        branchSelect.innerHTML = `<option value="">-- Select Branch --</option>`;
        deviceSelect.innerHTML = `<option value="">-- Select Device --</option>`;
        branchSelect.disabled = !currentBankId;
        deviceSelect.disabled = true;
        hideDeviceContainer();

        if (currentBankId) {
            fetch(`/api/banks/${currentBankId}/branches`, { headers: authHeaders })
                .then(res => res.json())
                .then(branches => {
                    branchSelect.innerHTML = `<option value="">-- Choose Branch --</option>`;
                    branches.forEach(br => {
                        branchSelect.innerHTML += `<option value="${br.id}">${br.name}</option>`;
                    });
                })
                .catch(err => showToast("Failed to load branches", "error"));
        }
    });

    // Branch change handler
    branchSelect.addEventListener("change", () => {
        currentBranchId = branchSelect.value;
        deviceSelect.innerHTML = `<option value="">-- Select Device --</option>`;
        deviceSelect.disabled = !currentBranchId;
        hideDeviceContainer();

        if (currentBranchId) {
            fetch("/api/devices", { headers: authHeaders })
                .then(res => res.json())
                .then(devices => {
                    const branchDevs = devices.filter(d => String(d.branch_id) === String(currentBranchId));
                    deviceSelect.innerHTML = `<option value="">-- Choose Device --</option>`;
                    if (branchDevs.length === 0) {
                        showToast("No devices found under this branch", "info");
                    }
                    branchDevs.forEach(d => {
                        deviceSelect.innerHTML += `<option value="${d.id}" data-name="${d.name}">${d.name} (ID: ${d.id})</option>`;
                    });
                })
                .catch(err => showToast("Failed to load devices", "error"));
        }
    });

    // Device change handler
    deviceSelect.addEventListener("change", () => {
        currentDeviceId = deviceSelect.value;
        const selectedOpt = deviceSelect.options[deviceSelect.selectedIndex];
        currentDeviceName = selectedOpt ? selectedOpt.getAttribute("data-name") || "" : "";

        if (!currentDeviceId) {
            hideDeviceContainer();
            return;
        }

        if (activeDeviceName) activeDeviceName.textContent = currentDeviceName || `Device #${currentDeviceId}`;
        if (activeDeviceId) activeDeviceId.textContent = currentDeviceId;
        if (activeDeviceTopic) activeDeviceTopic.textContent = `/OTP/${currentDeviceName || currentDeviceId}`;

        loadDeviceOTPs(currentDeviceId);
    });

    function hideDeviceContainer() {
        if (deviceSelectedContainer) deviceSelectedContainer.classList.add("hidden");
        if (noDevicePrompt) noDevicePrompt.classList.remove("hidden");
    }

    // Fetch 100 OTPs for selected device
    function loadDeviceOTPs(deviceId) {
        fetch(`/api/otp/device/${deviceId}`, { headers: authHeaders })
            .then(res => res.json())
            .then(data => {
                if (deviceSelectedContainer) deviceSelectedContainer.classList.remove("hidden");
                if (noDevicePrompt) noDevicePrompt.classList.add("hidden");

                if (activeDeviceLastSync) {
                    if (data.updated_at) {
                        const dt = new Date(data.updated_at);
                        activeDeviceLastSync.textContent = dt.toLocaleString();
                    } else {
                        activeDeviceLastSync.textContent = "Never";
                    }
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
                            // Highlight USED / SENT OTP in RED
                            inp.className = "otp-digit-input w-full bg-rose-950/40 border border-rose-500/60 rounded px-1.5 py-1 text-xs text-center text-rose-400 font-mono focus:outline-none focus:border-rose-400 transition font-semibold";
                            if (wrapper) {
                                wrapper.className = "bg-rose-950/20 border border-rose-500/40 rounded-lg p-1.5 focus-within:border-rose-400 transition";
                            }
                            if (badge) {
                                badge.innerHTML = `<span>#${i}</span><span class="text-rose-400 font-bold text-[9px] uppercase tracking-wider">USED</span>`;
                            }
                        } else {
                            // Normal ACTIVE / UNUSED OTP in EMERALD
                            inp.className = "otp-digit-input w-full bg-brand-sidebar border border-brand-border rounded px-1.5 py-1 text-xs text-center text-emerald-400 font-mono focus:outline-none focus:border-brand-blue transition font-semibold";
                            if (wrapper) {
                                wrapper.className = "bg-brand-cardBg border border-brand-border rounded-lg p-1.5 focus-within:border-brand-blue transition";
                            }
                            if (badge) {
                                badge.innerHTML = `<span>#${i}</span>`;
                            }
                        }
                    }
                }
            })
            .catch(err => {
                showToast("Error loading device OTPs: " + err, "error");
            });
    }

    // Auto-fill helpers
    if (btnAuto1001) {
        btnAuto1001.addEventListener("click", () => {
            for (let i = 1; i <= 100; i++) {
                const inp = qs(`#otp-input-${i}`);
                if (inp) inp.value = (1000 + i).toString();
            }
            showToast("Auto-filled inputs 1 to 100 with codes 1001-1100", "info");
        });
    }

    if (btnAutoRandom) {
        btnAutoRandom.addEventListener("click", () => {
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
            showToast("Generated 100 unique, non-duplicate 4-digit random OTPs", "info");
        });
    }

    if (btnClearAll) {
        btnClearAll.addEventListener("click", () => {
            if (confirm("Are you sure you want to clear all 100 OTP fields?")) {
                for (let i = 1; i <= 100; i++) {
                    const inp = qs(`#otp-input-${i}`);
                    if (inp) inp.value = "";
                }
                showToast("Cleared all OTP input fields", "info");
            }
        });
    }

    const btnResetStatus = qs("#btn-reset-status");
    if (btnResetStatus) {
        btnResetStatus.addEventListener("click", () => {
            if (!currentDeviceId) {
                showToast("Please select a device first", "error");
                return;
            }
            if (confirm("Reset all sent OTP statuses to active for this device?")) {
                fetch(`/api/otp/device/${currentDeviceId}/reset-status`, {
                    method: "POST",
                    headers: authHeaders
                })
                    .then(res => res.json())
                    .then(data => {
                        if (data.status === "success") {
                            showToast("All sent OTP statuses reset to active", "success");
                            loadDeviceOTPs(currentDeviceId);
                        } else {
                            showToast(data.detail || "Failed to reset statuses", "error");
                        }
                    })
                    .catch(err => showToast("Error resetting statuses: " + err, "error"));
            }
        });
    }

    // Save handler
    function saveOTPs(publishMqtt = false) {
        if (!currentDeviceId) {
            showToast("Please select a device first", "error");
            return;
        }

        const otps = [];
        for (let i = 1; i <= 100; i++) {
            const inp = qs(`#otp-input-${i}`);
            otps.push(inp ? inp.value.trim() : "");
        }

        const payload = {
            device_id: parseInt(currentDeviceId),
            otps: otps,
            publish_mqtt: publishMqtt
        };

        const targetBtn = publishMqtt ? savePublishOtpsBtn : saveOtpsBtn;
        const origContent = targetBtn ? targetBtn.innerHTML : "";
        if (targetBtn) {
            targetBtn.disabled = true;
            targetBtn.innerHTML = `<i class="bi bi-arrow-repeat animate-spin mr-1"></i> Saving...`;
        }

        fetch(`/api/otp/device/${currentDeviceId}`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify(payload)
        })
            .then(res => res.json())
            .then(resData => {
                if (targetBtn) {
                    targetBtn.disabled = false;
                    targetBtn.innerHTML = origContent;
                }

                if (resData.status === "success") {
                    let msg = `Successfully saved 100 OTPs for device.`;
                    if (publishMqtt) {
                        msg += ` Published packet *OFFOTP,BULK,1,...# to MQTT topic /OTP/${currentDeviceName || currentDeviceId}`;
                    }
                    showToast(msg, "success");
                    if (activeDeviceLastSync) activeDeviceLastSync.textContent = new Date().toLocaleString();
                    // Refresh OTP grid so updated statuses reset to active emerald color
                    loadDeviceOTPs(currentDeviceId);
                } else {
                    showToast(resData.detail || "Failed to save OTPs", "error");
                }
            })
            .catch(err => {
                if (targetBtn) {
                    targetBtn.disabled = false;
                    targetBtn.innerHTML = origContent;
                }
                showToast("Error saving OTPs: " + err, "error");
            });
    }

    if (saveOtpsBtn) saveOtpsBtn.addEventListener("click", () => saveOTPs(false));
    if (savePublishOtpsBtn) savePublishOtpsBtn.addEventListener("click", () => saveOTPs(true));

    // Toast Notification System
    function showToast(message, type = "info") {
        const toastContainer = qs("#toast-container");
        if (!toastContainer) return;

        const toast = document.createElement("div");
        toast.className = `pointer-events-auto flex items-center p-3 text-xs font-semibold rounded-lg shadow-xl border backdrop-blur-md transition-all duration-300 transform translate-y-2 opacity-0 max-w-md ${
            type === "success"
                ? "bg-emerald-950/90 border-emerald-500/50 text-emerald-200"
                : type === "error"
                ? "bg-rose-950/90 border-rose-500/50 text-rose-200"
                : "bg-slate-900/90 border-brand-blue/50 text-slate-200"
        }`;

        const icon = type === "success" ? "bi-check-circle-fill text-emerald-400" : type === "error" ? "bi-exclamation-triangle-fill text-rose-400" : "bi-info-circle-fill text-brand-blue";

        toast.innerHTML = `
            <i class="bi ${icon} text-base mr-2 shrink-0"></i>
            <span class="flex-1">${message}</span>
        `;

        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.remove("translate-y-2", "opacity-0");
        }, 10);

        setTimeout(() => {
            toast.classList.add("opacity-0", "translate-y-2");
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }
});
