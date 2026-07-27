// ── State & Authentication Helper ──
const state = {
    token: localStorage.getItem("token") || null,
    user: null,
    banks: [],
    branches: [],
    users: [],
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

        const navBanks = qs("#nav-banks-link");
        const navBranches = qs("#nav-branches-link");
        if (state.user.role === "super_admin" || state.user.role === "admin") {
            if (navBanks) navBanks.classList.remove("hidden");
            if (navBranches) navBranches.classList.remove("hidden");
        } else if (state.user.role === "bank_admin") {
            if (navBranches) navBranches.classList.remove("hidden");
        }

        await loadBanks();
        await loadBranches();
        await loadBankUsers();
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

// Fetch & Render Banks Dropdown for both Add and Edit modals
async function loadBanks() {
    try {
        const banks = await api("/api/banks/");
        state.banks = banks;

        const bankSelect = qs("#user-bank-id");
        const editBankSelect = qs("#edit-user-bank-id");

        const optionsHtml = '<option value="">— Primary Bank —</option>' + 
            banks.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");

        if (bankSelect) bankSelect.innerHTML = optionsHtml;
        if (editBankSelect) editBankSelect.innerHTML = optionsHtml;
    } catch (err) {
        console.error("Failed to load banks for dropdown:", err);
    }
}

// Fetch & Render Branches Dropdown
async function loadBranches() {
    try {
        const branches = await api("/api/banks/branches");
        state.branches = branches;
        populateBranchDropdowns();
    } catch (err) {
        console.error("Failed to load branches:", err);
    }
}

function populateBranchDropdowns(bankId = null, selectId = "#user-branch-id") {
    const el = qs(selectId);
    if (!el) return;

    let filtered = state.branches || [];
    if (bankId) {
        filtered = filtered.filter(b => b.bank_id === parseInt(bankId));
    }

    el.innerHTML = '<option value="">— Select Branch —</option>' +
        filtered.map(b => `<option value="${b.id}">${escapeHtml(b.name)} (${escapeHtml(b.bank_name || 'Bank')})</option>`).join("");
}

// Bank Change Event Handlers to filter Branches
qs("#user-bank-id")?.addEventListener("change", (e) => {
    populateBranchDropdowns(e.target.value, "#user-branch-id");
});
qs("#edit-user-bank-id")?.addEventListener("change", (e) => {
    populateBranchDropdowns(e.target.value, "#edit-user-branch-id");
});

// Fetch & Render Users Table
async function loadBankUsers() {
    try {
        const users = await api("/api/banks/users");
        state.users = users;

        const tbody = qs("#users-table-body");
        const countBadge = qs("#users-count");
        if (countBadge) countBadge.textContent = `${users.length} users`;

        if (!tbody) return;
        if (users.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="py-6 text-center text-brand-muted">No users found.</td></tr>`;
            return;
        }

        tbody.innerHTML = users.map(u => {
            const statusBadge = u.is_active !== false
                ? `<span class="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-[10px] font-bold uppercase">Active</span>`
                : `<span class="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-[10px] font-bold uppercase">Inactive</span>`;

            const bankDisplay = u.bank_name || (u.bank_id ? `Bank #${u.bank_id}` : "—");
            const branchDisplay = u.branch_name || (u.branch_id ? `Branch #${u.branch_id}` : "—");

            const roleBadgeClass = {
                super_admin: "bg-brand-purple/20 text-brand-purple",
                admin: "bg-indigo-500/20 text-indigo-400",
                bank_admin: "bg-brand-blue/20 text-brand-blue",
                user: "bg-slate-700/50 text-slate-300"
            }[u.role] || "bg-brand-blue/20 text-brand-blue";

            return `
                <tr class="hover:bg-brand-border/20 transition">
                    <td class="py-3 pr-3 font-semibold text-brand-blue">${u.id}</td>
                    <td class="py-3 pr-3 font-medium text-white">${escapeHtml(u.username)}</td>
                    <td class="py-3 pr-3 text-slate-300">${escapeHtml(u.email)}</td>
                    <td class="py-3 pr-3 text-slate-400 font-mono text-xs">${escapeHtml(u.whatsapp_number || "—")}</td>
                    <td class="py-3 pr-3 text-xs text-slate-300">
                        <span class="block font-semibold text-white">${escapeHtml(bankDisplay)}</span>
                        <span class="block text-brand-muted">${escapeHtml(branchDisplay)}</span>
                    </td>
                    <td class="py-3 pr-3"><span class="badge uppercase px-2 py-0.5 rounded text-[10px] font-bold ${roleBadgeClass}">${u.role}</span></td>
                    <td class="py-3 pr-3">${statusBadge}</td>
                    <td class="py-3 text-right space-x-2">
                        <button class="px-2.5 py-1 bg-brand-blue/20 hover:bg-brand-blue/30 text-brand-blue rounded text-xs transition" onclick="openEditUserModal(${u.id})">
                            <i class="bi bi-pencil-fill mr-1"></i> Edit
                        </button>
                        <button class="px-2.5 py-1 bg-brand-danger/20 hover:bg-brand-danger/30 text-brand-danger rounded text-xs transition" onclick="deleteUser(${u.id}, '${escapeHtml(u.username).replace(/'/g, "\\'")}')">
                            <i class="bi bi-trash-fill mr-1"></i> Delete
                        </button>
                    </td>
                </tr>
            `;
        }).join("");
    } catch (err) {
        console.error("Failed to load users:", err);
        showToast(err.message, "error");
    }
}

// ── Modals Management ──
const addUserModal = qs("#add-user-modal");
const editUserModal = qs("#edit-user-modal");

// Role-Based Bank & Branch Selector Toggle for Add Modal
const userRoleSelect = qs("#user-role");
const userBankWrapper = qs("#user-bank-wrapper");
const userBranchWrapper = qs("#user-branch-wrapper");
function updateAddBankVisibility() {
    const role = userRoleSelect ? userRoleSelect.value : "user";
    const needsBank = role === "user" || role === "bank_admin";
    if (userBankWrapper) userBankWrapper.style.display = needsBank ? "" : "none";
    if (userBranchWrapper) userBranchWrapper.style.display = needsBank ? "" : "none";
}
if (userRoleSelect) {
    userRoleSelect.addEventListener("change", updateAddBankVisibility);
}

// Role-Based Bank & Branch Selector Toggle for Edit Modal
const editUserRoleSelect = qs("#edit-user-role");
const editUserBankWrapper = qs("#edit-user-bank-wrapper");
const editUserBranchWrapper = qs("#edit-user-branch-wrapper");
function updateEditBankVisibility() {
    const role = editUserRoleSelect ? editUserRoleSelect.value : "user";
    const needsBank = role === "user" || role === "bank_admin";
    if (editUserBankWrapper) editUserBankWrapper.style.display = needsBank ? "" : "none";
    if (editUserBranchWrapper) editUserBranchWrapper.style.display = needsBank ? "" : "none";
}
if (editUserRoleSelect) {
    editUserRoleSelect.addEventListener("change", updateEditBankVisibility);
}

// Open/Close Add User Modal
qs("#open-add-user-modal")?.addEventListener("click", () => {
    qs("#add-user-form").reset();
    populateBranchDropdowns(null, "#user-branch-id");
    updateAddBankVisibility();
    qs("#add-user-error").textContent = "";
    addUserModal.classList.remove("hidden");
});
qs("#close-add-user-modal")?.addEventListener("click", () => addUserModal.classList.add("hidden"));
qs("#cancel-add-user")?.addEventListener("click", () => addUserModal.classList.add("hidden"));

// Handle Add User Form Submission
qs("#add-user-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = qs("#user-username").value.trim();
    const email = qs("#user-email").value.trim();
    const whatsappNumber = qs("#user-whatsapp") ? qs("#user-whatsapp").value.trim() : "";
    const role = qs("#user-role") ? qs("#user-role").value : "user";
    const needsBank = role === "user" || role === "bank_admin";
    const bankIdVal = needsBank && qs("#user-bank-id") ? qs("#user-bank-id").value : "";
    const branchIdVal = needsBank && qs("#user-branch-id") ? qs("#user-branch-id").value : "";
    const bank_id = bankIdVal ? parseInt(bankIdVal) : null;
    const branch_id = branchIdVal ? parseInt(branchIdVal) : null;
    const isActive = qs("#user-is-active").checked;
    const password = qs("#user-password").value.trim();
    const errEl = qs("#add-user-error");

    try {
        await api("/api/banks/users", {
            method: "POST",
            body: JSON.stringify({ username, email, whatsapp_number: whatsappNumber, role, bank_id, branch_id, is_active: isActive, password })
        });
        addUserModal.classList.add("hidden");
        showToast("User registered successfully!");
        await loadBankUsers();
    } catch (err) {
        errEl.textContent = err.message;
    }
});

// Open/Close Edit User Modal
window.openEditUserModal = function(id) {
    const user = (state.users || []).find(u => u.id === id);
    if (!user) return;

    qs("#edit-user-id").value = user.id;
    qs("#edit-user-username").value = user.username;
    qs("#edit-user-email").value = user.email;
    qs("#edit-user-whatsapp").value = user.whatsapp_number || "";
    qs("#edit-user-role").value = user.role;
    if (qs("#edit-user-bank-id")) qs("#edit-user-bank-id").value = user.bank_id || "";

    populateBranchDropdowns(user.bank_id, "#edit-user-branch-id");
    if (qs("#edit-user-branch-id")) qs("#edit-user-branch-id").value = user.branch_id || "";

    qs("#edit-user-is-active").checked = user.is_active !== false;
    qs("#edit-user-password").value = "";
    qs("#edit-user-error").textContent = "";

    updateEditBankVisibility();
    editUserModal.classList.remove("hidden");
};
qs("#close-edit-user-modal")?.addEventListener("click", () => editUserModal.classList.add("hidden"));
qs("#cancel-edit-user")?.addEventListener("click", () => editUserModal.classList.add("hidden"));

// Handle Edit User Form Submission
qs("#edit-user-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const userId = qs("#edit-user-id").value;
    const username = qs("#edit-user-username").value.trim();
    const email = qs("#edit-user-email").value.trim();
    const whatsappNumber = qs("#edit-user-whatsapp").value.trim();
    const role = qs("#edit-user-role").value;
    const needsBank = role === "user" || role === "bank_admin";
    const bankIdVal = needsBank && qs("#edit-user-bank-id") ? qs("#edit-user-bank-id").value : "";
    const branchIdVal = needsBank && qs("#edit-user-branch-id") ? qs("#edit-user-branch-id").value : "";
    const bank_id = bankIdVal ? parseInt(bankIdVal) : null;
    const branch_id = branchIdVal ? parseInt(branchIdVal) : null;
    const isActive = qs("#edit-user-is-active").checked;
    const password = qs("#edit-user-password").value.trim();
    const errEl = qs("#edit-user-error");

    const payload = { username, email, whatsapp_number: whatsappNumber, role, bank_id, branch_id, is_active: isActive };
    if (password) payload.password = password;

    try {
        await api(`/api/banks/users/${userId}`, {
            method: "PUT",
            body: JSON.stringify(payload)
        });
        editUserModal.classList.add("hidden");
        showToast("User updated successfully!");
        await loadBankUsers();
    } catch (err) {
        errEl.textContent = err.message;
    }
});

// Delete User Handler
window.deleteUser = async function(id, username) {
    if (!confirm(`Are you sure you want to delete user "${username}"?`)) return;
    try {
        await api(`/api/banks/users/${id}`, { method: "DELETE" });
        showToast(`User "${username}" deleted successfully!`);
        await loadBankUsers();
    } catch (err) {
        showToast(err.message, "error");
    }
};

document.addEventListener("DOMContentLoaded", initUser);
