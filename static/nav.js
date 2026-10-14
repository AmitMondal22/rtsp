/**
 * nav.js — OTP Shield Access Management
 * Shared navigation controller.
 * Handles: auth guard, user info display, role-based sidebar visibility,
 *          header clock, active link highlighting, and logout — across every page.
 */
(function () {
    "use strict";

    const ALL_NAV_IDS = [
        "nav-overview",
        "nav-rtsp",
        "nav-requests",
        "nav-alerts",
        "nav-reports",
        "nav-devices",
        "nav-online-otp",
        "nav-offline-otp",
        "nav-banks",
        "nav-branches",
        "nav-users",
        "nav-logs"
    ];

    // Menu items visible to ALL authenticated users
    const COMMON_NAV_IDS = [
        "nav-overview",
        "nav-rtsp",
        "nav-requests",
        "nav-alerts",
        "nav-reports",
        "nav-devices",
        "nav-online-otp",
        "nav-offline-otp",
        "nav-logs"
    ];

    // Menu items only visible to admin roles (super_admin, admin, bank_admin)
    const ADMIN_ONLY_NAV_IDS = [
        "nav-banks",
        "nav-branches",
        "nav-users"
    ];

    const ROLE_LABELS = {
        super_admin: { label: "SUPER ADMIN", cls: "bg-purple-100 text-purple-700 border-purple-200" },
        superadmin:  { label: "SUPER ADMIN", cls: "bg-purple-100 text-purple-700 border-purple-200" },
        admin:       { label: "ADMIN",        cls: "bg-sky-100 text-sky-700 border-sky-200" },
        bank_admin:  { label: "BANK ADMIN",   cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
        bankadmin:   { label: "BANK ADMIN",   cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
        user:        { label: "USER",          cls: "bg-slate-100 text-slate-600 border-slate-200" }
    };

    function qs(sel) { return document.querySelector(sel); }
    function qsa(sel) { return document.querySelectorAll(sel); }

    function getToken() {
        return localStorage.getItem("token") || sessionStorage.getItem("token") || null;
    }

    function clearSession() {
        localStorage.removeItem("token");
        sessionStorage.removeItem("token");
    }

    async function fetchJson(url, token) {
        const res = await fetch(url, {
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            }
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
    }

    function updateClock() {
        const clockEl = qs("#nav-clock");
        const dateEl  = qs("#nav-date");
        if (!clockEl && !dateEl) return;
        const now = new Date();
        let hours = now.getHours();
        const minutes = String(now.getMinutes()).padStart(2, "0");
        const seconds = String(now.getSeconds()).padStart(2, "0");
        const ampm = hours >= 12 ? "PM" : "AM";
        hours = hours % 12 || 12;
        const hStr = String(hours).padStart(2, "0");
        if (clockEl) clockEl.textContent = hStr + ":" + minutes + ":" + seconds + " " + ampm;
        if (dateEl) {
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, "0");
            const d = String(now.getDate()).padStart(2, "0");
            dateEl.textContent = y + "/" + m + "/" + d;
        }
    }

    function startClock() {
        updateClock();
        if (!window._navClockStarted) {
            window._navClockStarted = true;
            setInterval(updateClock, 1000);
        }
    }

    /**
     * Apply role-based sidebar menu visibility.
     * - super_admin / admin: see ALL menus
     * - bank_admin: see all menus (they manage their bank's branches/users)
     * - user: see only Operations, Infrastructure, OTP Management, and Logs
     *         (Bank/Branch/User management is hidden)
     */
    function applyRoleBasedMenuVisibility(role) {
        const r = String(role || "").toLowerCase().replace(/[-_\s]/g, "");
        const isAdmin = (r === "superadmin" || r === "admin" || r === "bankadmin" || r.includes("admin"));

        // Always show common nav items
        COMMON_NAV_IDS.forEach(function(id) {
            const el = qs("#" + id);
            if (el) {
                el.classList.remove("hidden");
                el.style.display = "";
            }
        });

        // Show/hide admin-only nav items based on role
        ADMIN_ONLY_NAV_IDS.forEach(function(id) {
            const el = qs("#" + id);
            if (el) {
                if (isAdmin) {
                    el.classList.remove("hidden");
                    el.style.display = "";
                } else {
                    el.classList.add("hidden");
                    el.style.display = "none";
                }
            }
        });

        // Show/hide the "Administration" section title
        qsa(".nav-section-title").forEach(function(section) {
            const text = (section.textContent || "").trim().toLowerCase();
            if (text === "administration") {
                if (isAdmin) {
                    section.classList.remove("hidden");
                    section.style.display = "";
                } else {
                    section.classList.add("hidden");
                    section.style.display = "none";
                }
            } else {
                // Always show other section titles (Operations, Infrastructure, OTP Management)
                section.classList.remove("hidden");
                section.style.display = "";
            }
        });

        // Additional link compatibility (add-device-btn always visible)
        var addDevBtn = qs("#add-device-btn");
        if (addDevBtn) {
            addDevBtn.classList.remove("hidden");
            addDevBtn.style.display = "";
        }
    }

    // Fallback: show all menus initially before role is known (prevents flicker)
    function showAllSidebarMenusInitial() {
        ALL_NAV_IDS.forEach(function(id) {
            var el = qs("#" + id);
            if (el) {
                el.classList.remove("hidden");
                el.style.display = "";
            }
        });
        qsa(".nav-section-title").forEach(function(section) {
            section.classList.remove("hidden");
            section.style.display = "";
        });
    }

    function updateUserInfo(user) {
        const role = user.role || "user";
        const roleInfo = ROLE_LABELS[role] || ROLE_LABELS.user;
        const displayName = user.email || user.username || "User";

        const badgeEl = qs("#user-role-badge");
        if (badgeEl) {
            badgeEl.textContent = roleInfo.label;
            badgeEl.className = "text-xs font-semibold px-2.5 py-0.5 rounded-full border " + roleInfo.cls;
        }
        const emailEl = qs("#user-display-email");
        if (emailEl) emailEl.textContent = displayName;

        const dropUser = qs("#user-dropdown-username");
        if (dropUser) dropUser.textContent = user.username || user.email || "User";
        const dropRole = qs("#user-dropdown-role");
        if (dropRole) dropRole.textContent = roleInfo.label;

        const branchBadge = qs("#active-branch-name");
        if (branchBadge && user.branch_name) {
            branchBadge.textContent = user.branch_name;
        }
    }

    function attachLogout() {
        document.addEventListener("click", function(e) {
            var btn = e.target.closest("#logout-btn");
            if (!btn) return;
            e.preventDefault();
            clearSession();
            if (window.state) { window.state.token = null; window.state.user = null; }
            window.location.href = "/";
        });
    }

    function attachDropdownToggle() {
        var menuBtn = qs("#user-menu-btn");
        var menuEl  = qs("#user-dropdown-menu");
        if (!menuBtn || !menuEl) return;
        menuBtn.addEventListener("click", function(e) {
            e.stopPropagation();
            menuEl.classList.toggle("hidden");
        });
        document.addEventListener("click", function() {
            if (menuEl) menuEl.classList.add("hidden");
        });
    }

    function highlightActiveNav() {
        var path = window.location.pathname.replace(/\/$/, "");
        var pathMap = {
            "":            "nav-overview",
            "/dashboard":  "nav-overview",
            "/overview":   "nav-overview",
            "/rtsp":       "nav-rtsp",
            "/requests":   "nav-requests",
            "/alerts":     "nav-alerts",
            "/reports":    "nav-reports",
            "/devices":    "nav-devices",
            "/online-otp": "nav-online-otp",
            "/manage-otp": "nav-online-otp",
            "/offline-otp":"nav-offline-otp",
            "/banks":      "nav-banks",
            "/branches":   "nav-branches",
            "/users":      "nav-users",
            "/logs":       "nav-logs"
        };
        var activeId = pathMap[path];
        if (!activeId) {
            for (var key in pathMap) {
                if (key && path.startsWith(key)) {
                    activeId = pathMap[key];
                    break;
                }
            }
        }
        if (!activeId) activeId = "nav-overview";
        qsa(".nav-item").forEach(function(el) { el.classList.remove("active"); });
        var activeEl = qs("#" + activeId);
        if (activeEl) activeEl.classList.add("active");
    }

    // ── Common Layout Renderers (Single Source of Truth) ──
    function renderCommonTopBar() {
        var header = qs("#app-header") || qs("header");
        if (!header) return;

        header.className = "bg-white border-b border-slate-200 px-6 py-2.5 flex items-center justify-between shrink-0 select-none z-30";
        if (header.dataset.navRendered !== "true") {
            header.dataset.navRendered = "true";
            header.innerHTML = `
                <div class="flex items-center space-x-2.5">
                    <i class="bi bi-shield-check text-sky-600 text-lg"></i>
                    <span class="text-sm font-bold tracking-tight text-slate-900">OTP Shield Access Management</span>
                </div>

                <div class="flex items-center space-x-4">
                    <div class="hidden sm:flex flex-col text-right leading-none pr-3 border-r border-slate-200 font-mono text-[11px]">
                        <span id="nav-clock" class="text-slate-800 font-bold">--:--:--</span>
                        <span id="nav-date" class="text-slate-400 text-[10px] mt-0.5">----/--/--</span>
                    </div>
                    <span id="user-role-badge" class="bg-sky-100 text-sky-700 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-sky-200">USER</span>
                    <span id="user-display-email" class="text-xs text-slate-600 font-medium truncate max-w-[200px]">Loading...</span>
                    <button id="logout-btn" class="text-xs text-slate-600 hover:text-slate-900 font-medium flex items-center transition cursor-pointer px-2.5 py-1 rounded-md hover:bg-slate-100" title="Sign out of console">
                        <i class="bi bi-box-arrow-right mr-1.5 text-slate-500"></i> Sign out
                    </button>
                </div>
            `;
        }
    }

    function renderCommonSidebar() {
        var aside = qs("#app-sidebar") || qs("aside");
        if (!aside) return;

        aside.className = "w-64 bg-white border-r border-slate-200 flex flex-col justify-between shrink-0 overflow-y-auto select-none p-4 h-full";
        if (aside.dataset.navRendered !== "true") {
            aside.dataset.navRendered = "true";
            aside.innerHTML = `
                <div>
                    <!-- Brand Header: Full Width Logo -->
                    <div class="mb-5 pb-3 border-b border-slate-100">
                        <a href="/dashboard" class="block w-full focus:outline-none" title="OTP Shield Access Management">
                            <img src="/static/image/logo/OTP_Shield_Access_Management.png" alt="OTP Shield Access Management" class="w-full h-auto object-contain block mx-auto" />
                        </a>
                    </div>

                    <!-- Navigation Links -->
                    <nav class="space-y-0.5">
                        <div class="nav-section-title">Operations</div>
                        <a href="/dashboard" id="nav-overview" class="nav-item">
                            <i class="bi bi-grid-fill"></i> Overview Dashboard
                        </a>
                        <a href="/rtsp" id="nav-rtsp" class="nav-item">
                            <i class="bi bi-camera-video-fill"></i> Live RTSP Monitoring
                        </a>
                        <a href="/requests" id="nav-requests" class="nav-item">
                            <i class="bi bi-envelope-paper-fill"></i> Pending Access Requests
                        </a>
                        <a href="/alerts" id="nav-alerts" class="nav-item">
                            <i class="bi bi-shield-exclamation"></i> Security Alerts
                        </a>
                        <a href="/reports" id="nav-reports" class="nav-item">
                            <i class="bi bi-bar-chart-fill"></i> Reports
                        </a>

                        <div class="nav-section-title">Infrastructure</div>
                        <a href="/devices" id="nav-devices" class="nav-item">
                            <i class="bi bi-cpu-fill"></i> Device Management
                        </a>

                        <div class="nav-section-title">OTP Management</div>
                        <a href="/online-otp" id="nav-online-otp" class="nav-item">
                            <i class="bi bi-key-fill"></i> Online OTP Requests
                        </a>
                        <a href="/offline-otp" id="nav-offline-otp" class="nav-item">
                            <i class="bi bi-database-fill"></i> Bulk Offline OTP Database
                        </a>

                        <div class="nav-section-title">Administration</div>
                        <a href="/banks" id="nav-banks" class="nav-item">
                            <i class="bi bi-bank"></i> Bank Management
                        </a>
                        <a href="/branches" id="nav-branches" class="nav-item">
                            <i class="bi bi-diagram-3-fill"></i> Branch Management
                        </a>
                        <a href="/users" id="nav-users" class="nav-item">
                            <i class="bi bi-people-fill"></i> User Management
                        </a>
                        <a href="/logs" id="nav-logs" class="nav-item">
                            <i class="bi bi-journal-text"></i> Event Logs & Audit
                        </a>
                    </nav>
                </div>

                <div class="pt-3 border-t border-slate-100 px-2 flex items-center justify-between text-[11px] text-slate-400 font-medium">
                    <span>OTP Shield v2.0</span>
                    <span class="flex items-center text-emerald-600"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span> Connected</span>
                </div>
            `;
        }
    }

    window.renderCommonTopBar = renderCommonTopBar;
    window.renderCommonSidebar = renderCommonSidebar;

    async function navInit() {
        var token = getToken();
        if (!token) { window.location.href = "/"; return; }

        // Render navigation sidebar (first) and common top bar immediately
        renderCommonSidebar();
        renderCommonTopBar();

        startClock();
        attachLogout();
        attachDropdownToggle();

        // Show all menus initially to prevent flash of hidden content
        showAllSidebarMenusInitial();
        highlightActiveNav();

        var user;
        try {
            user = await fetchJson("/api/users/me", token);
        } catch (err) {
            try {
                user = await fetchJson("/api/auth/me", token);
            } catch (err2) {
                console.warn("[nav.js] Auth check failed:", err.message);
                clearSession();
                window.location.href = "/";
                return;
            }
        }

        window._navUser = user;
        updateUserInfo(user);

        // Apply role-based sidebar visibility now that we know the user's role
        applyRoleBasedMenuVisibility(user.role || "user");
        highlightActiveNav();

        // Expose window helpers that pages call
        window.initHeaderClock = startClock;
        window.checkUserRoleAndPermissions = function() {
            if (window._navUser) {
                applyRoleBasedMenuVisibility(window._navUser.role || "user");
            }
        };
    }

    function escapeStr(s) {
        if (!s) return "";
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Global Delete Confirmation Modal requiring typing 'DELETE'
    window.confirmDelete = function(options) {
        var opts = typeof options === "string" ? { message: options } : (options || {});
        var title = opts.title || "Delete Confirmation";
        var itemName = opts.itemName || "";
        var message = opts.message || "This action cannot be undone. All associated data will be permanently removed.";

        return new Promise(function(resolve) {
            var modal = document.getElementById("global-delete-modal");
            if (!modal) {
                modal = document.createElement("div");
                modal.id = "global-delete-modal";
                document.body.appendChild(modal);
            }

            modal.className = "fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-[99999] p-4 transition-all duration-150";
            modal.innerHTML = 
                '<div class="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-sm w-full overflow-hidden p-5 animate-in fade-in zoom-in-95 duration-150" onclick="event.stopPropagation()">' +
                    '<div class="w-12 h-12 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 text-xl mx-auto mb-3 shadow-xs">' +
                        '<i class="bi bi-trash3-fill"></i>' +
                    '</div>' +
                    '<h3 class="text-base font-bold text-slate-900 text-center tracking-tight">' + escapeStr(title) + '</h3>' +
                    '<p class="text-xs text-slate-500 text-center mt-1.5 leading-relaxed">' + escapeStr(message) + '</p>' +
                    (itemName ? (
                        '<div class="mt-3 bg-slate-50 border border-slate-200 rounded-lg p-2 text-center text-xs font-semibold text-slate-800 break-words flex items-center justify-center">' +
                            '<i class="bi bi-exclamation-triangle text-rose-500 mr-1.5 text-xs"></i>' +
                            '<span class="truncate">' + escapeStr(itemName) + '</span>' +
                        '</div>'
                    ) : '') +
                    '<div class="mt-4">' +
                        '<label class="block text-[11px] font-semibold text-slate-700 mb-1.5 text-center">' +
                            'To confirm, type <span class="font-mono font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 select-all">DELETE</span> below:' +
                        '</label>' +
                        '<input type="text" id="delete-confirm-input" class="w-full text-center font-mono font-bold uppercase tracking-wider text-xs px-3 py-2 bg-white border-2 border-slate-200 focus:border-rose-500 rounded-lg text-slate-900 placeholder:text-slate-300 placeholder:font-normal placeholder:tracking-normal focus:outline-none transition shadow-2xs" placeholder="Type DELETE" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" />' +
                    '</div>' +
                    '<div class="grid grid-cols-2 gap-2.5 mt-5 pt-3 border-t border-slate-100">' +
                        '<button type="button" id="delete-modal-cancel-btn" class="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs rounded-lg transition cursor-pointer flex items-center justify-center">' +
                            '<i class="bi bi-x mr-1 text-sm"></i> Cancel' +
                        '</button>' +
                        '<button type="button" id="delete-modal-confirm-btn" disabled class="w-full py-2 bg-slate-200 text-slate-400 font-semibold text-xs rounded-lg cursor-not-allowed transition flex items-center justify-center">' +
                            '<i class="bi bi-trash3 mr-1 text-xs"></i> Delete' +
                        '</button>' +
                    '</div>' +
                '</div>';

            modal.style.display = "flex";
            modal.classList.remove("hidden");

            var input = modal.querySelector("#delete-confirm-input");
            var cancelBtn = modal.querySelector("#delete-modal-cancel-btn");
            var confirmBtn = modal.querySelector("#delete-modal-confirm-btn");

            function close(result) {
                modal.style.display = "none";
                modal.classList.add("hidden");
                document.removeEventListener("keydown", onKeyDown);
                modal.onclick = null;
                resolve(result);
            }

            function onKeyDown(e) {
                if (e.key === "Escape") {
                    e.preventDefault();
                    close(false);
                } else if (e.key === "Enter" && !confirmBtn.disabled) {
                    e.preventDefault();
                    close(true);
                }
            }

            input.addEventListener("input", function() {
                var val = input.value.trim().toUpperCase();
                if (val === "DELETE") {
                    confirmBtn.disabled = false;
                    confirmBtn.className = "w-full py-2 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs rounded-lg transition cursor-pointer shadow-xs flex items-center justify-center";
                } else {
                    confirmBtn.disabled = true;
                    confirmBtn.className = "w-full py-2 bg-slate-200 text-slate-400 font-semibold text-xs rounded-lg cursor-not-allowed transition flex items-center justify-center";
                }
            });

            cancelBtn.onclick = function() { close(false); };
            confirmBtn.onclick = function() {
                if (!confirmBtn.disabled) close(true);
            };
            modal.onclick = function(e) {
                if (e.target === modal) close(false);
            };
            document.addEventListener("keydown", onKeyDown);

            setTimeout(function() {
                if (input) input.focus();
            }, 60);
        });
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", navInit);
    } else {
        navInit();
    }

    window.navInit = navInit;
})();
