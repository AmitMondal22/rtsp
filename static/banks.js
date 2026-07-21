// ── State & Authentication Helper ──
const state = {
    token: localStorage.getItem("token") || null,
    user: null,
};

if (!state.token) {
    window.location.href = "/login";
}

const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => document.querySelectorAll(sel);

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, '&quot;')
        .replace(/'/g, "&#039;");
}

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

function showToast(message, type = "success") {
    const container = qs("#toast-container");
    if (!container) return;
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

// Dynamic Topbar Clock
function updateTopbarClock() {
    const clockEl = qs("#nav-clock");
    const dateEl = qs("#nav-date");
    if (!clockEl || !dateEl) return;

    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString();
    dateEl.textContent = now.toISOString().split("T")[0].replace(/-/g, "/");
}
setInterval(updateTopbarClock, 1000);
updateTopbarClock();

// Load Logged-in User
async function initUser() {
    try {
        state.user = await api("/api/users/me");
        qs("#user-dropdown-username").textContent = state.user.username;
        qs("#user-dropdown-role").textContent = state.user.role.toUpperCase();

        const navUsers = qs("#nav-users-link");
        if (navUsers && (state.user.role === "super_admin" || state.user.role === "bank_admin")) {
            navUsers.classList.remove("hidden");
        }

        await loadBanks();
    } catch (err) {
        console.error("User init failed:", err);
        localStorage.removeItem("token");
        window.location.href = "/login";
    }
}

// User Profile Dropdown Toggle
const userMenuBtn = qs("#user-menu-btn");
const userDropdownMenu = qs("#user-dropdown-menu");
if (userMenuBtn && userDropdownMenu) {
    userMenuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        userDropdownMenu.classList.toggle("hidden");
    });
    document.addEventListener("click", () => {
        userDropdownMenu.classList.add("hidden");
    });
}

// Logout
const logoutBtn = qs("#logout-btn");
if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
        localStorage.removeItem("token");
        window.location.href = "/login";
    });
}

// Fetch & Render Banks List with Action Buttons
async function loadBanks() {
    try {
        const banks = await api("/api/banks/");
        const tbody = qs("#banks-table-body");
        const countBadge = qs("#banks-count");
        if (countBadge) countBadge.textContent = `${banks.length} banks`;

        if (!tbody) return;
        if (banks.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-brand-muted">No registered banks found.</td></tr>`;
            return;
        }

        tbody.innerHTML = banks.map(b => `
            <tr class="hover:bg-brand-border/20 transition">
                <td class="py-3 pr-4 font-semibold text-brand-blue">${b.id}</td>
                <td class="py-3 pr-4 font-medium text-white">${escapeHtml(b.name)}</td>
                <td class="py-3 pr-4 text-slate-400 font-mono text-xs">${new Date(b.created_at).toLocaleString()}</td>
                <td class="py-3 text-right space-x-2">
                    <button class="px-2.5 py-1 bg-brand-blue/20 hover:bg-brand-blue/30 text-brand-blue rounded text-xs transition" onclick="openEditBankModal(${b.id}, '${escapeHtml(b.name).replace(/'/g, "\\'")}')">
                        <i class="bi bi-pencil-fill mr-1"></i> Edit
                    </button>
                    <button class="px-2.5 py-1 bg-brand-danger/20 hover:bg-brand-danger/30 text-brand-danger rounded text-xs transition" onclick="deleteBank(${b.id}, '${escapeHtml(b.name).replace(/'/g, "\\'")}')">
                        <i class="bi bi-trash-fill mr-1"></i> Delete
                    </button>
                </td>
            </tr>
        `).join("");
    } catch (err) {
        console.error("Failed to load banks:", err);
        showToast(err.message, "error");
    }
}

// ── Modals Management ──
const addBankModal = qs("#add-bank-modal");
const editBankModal = qs("#edit-bank-modal");

// Open/Close Add Bank Modal
qs("#open-add-bank-modal")?.addEventListener("click", () => {
    qs("#add-bank-form").reset();
    qs("#add-bank-error").textContent = "";
    addBankModal.classList.remove("hidden");
});
qs("#close-add-bank-modal")?.addEventListener("click", () => addBankModal.classList.add("hidden"));
qs("#cancel-add-bank")?.addEventListener("click", () => addBankModal.classList.add("hidden"));

// Handle Add Bank Submit
qs("#add-bank-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const bankName = qs("#bank-name").value.trim();
    const username = qs("#bank-admin-username").value.trim();
    const email = qs("#bank-admin-email").value.trim();
    const password = qs("#bank-admin-password").value.trim();
    const errEl = qs("#add-bank-error");

    try {
        await api("/api/banks/", {
            method: "POST",
            body: JSON.stringify({ bank_name: bankName, username, email, password })
        });
        addBankModal.classList.add("hidden");
        showToast("Bank & Admin created successfully!");
        await loadBanks();
    } catch (err) {
        errEl.textContent = err.message;
    }
});

// Open/Close Edit Bank Modal
window.openEditBankModal = function(id, name) {
    qs("#edit-bank-id").value = id;
    qs("#edit-bank-name").value = name;
    qs("#edit-bank-error").textContent = "";
    editBankModal.classList.remove("hidden");
};
qs("#close-edit-bank-modal")?.addEventListener("click", () => editBankModal.classList.add("hidden"));
qs("#cancel-edit-bank")?.addEventListener("click", () => editBankModal.classList.add("hidden"));

// Handle Edit Bank Submit
qs("#edit-bank-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const bankId = qs("#edit-bank-id").value;
    const bankName = qs("#edit-bank-name").value.trim();
    const errEl = qs("#edit-bank-error");

    try {
        await api(`/api/banks/${bankId}`, {
            method: "PUT",
            body: JSON.stringify({ name: bankName })
        });
        editBankModal.classList.add("hidden");
        showToast("Bank updated successfully!");
        await loadBanks();
    } catch (err) {
        errEl.textContent = err.message;
    }
});

// Delete Bank Handler
window.deleteBank = async function(id, name) {
    if (!confirm(`Are you sure you want to delete bank "${name}"?`)) return;
    try {
        await api(`/api/banks/${id}`, { method: "DELETE" });
        showToast(`Bank "${name}" deleted successfully!`);
        await loadBanks();
    } catch (err) {
        showToast(err.message, "error");
    }
};

document.addEventListener("DOMContentLoaded", initUser);
