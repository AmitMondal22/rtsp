/**
 * nav.js — ANG Smart Access
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

    async function navInit() {
        var token = getToken();
        if (!token) { window.location.href = "/"; return; }

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

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", navInit);
    } else {
        navInit();
    }

    window.navInit = navInit;
})();
