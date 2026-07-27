// ── Branch Management JS ──
const state = {
    token: localStorage.getItem("token") || null,
    user: null,
    banks: [],
    branches: [],
    users: [],
    selectedBankFilter: "all"
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

// Clock
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

// Initialize User
async function initUser() {
    try {
        state.user = await api("/api/users/me");
        qs("#user-dropdown-username").textContent = state.user.username;
        qs("#user-dropdown-role").textContent = state.user.role.toUpperCase();

        const navBanks = qs("#nav-banks-link");
        const navUsers = qs("#nav-users-link");
        const navBranches = qs("#nav-branches-link");

        // Always show branch menu item
        if (navBranches) navBranches.classList.remove("hidden");

        if (state.user.role === "super_admin" || state.user.role === "admin" || state.user.role === "bank_admin") {
            if (navBanks) navBanks.classList.remove("hidden");
            if (navUsers) navUsers.classList.remove("hidden");
        }

        await loadUsersForDropdowns();
        await loadBanks();
        await loadBranches();
    } catch (err) {
        console.error("User init failed:", err);
        localStorage.removeItem("token");
        window.location.href = "/login";
    }
}

// Profile dropdown
const userMenuBtn = qs("#user-menu-btn");
const userDropdownMenu = qs("#user-dropdown-menu");
if (userMenuBtn && userDropdownMenu) {
    userMenuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        userDropdownMenu.classList.toggle("hidden");
    });
    document.addEventListener("click", () => userDropdownMenu.classList.add("hidden"));
}

qs("#logout-btn")?.addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.href = "/login";
});

// Load Users
async function loadUsersForDropdowns() {
    try {
        state.users = await api("/api/banks/users");
    } catch (err) {
        console.error("Failed to load users for dropdowns:", err);
    }
}

// Populate User Dropdowns
function populateBranchUserDropdowns(prefix = "branch") {
    const users = state.users || [];
    const optionsHtml = '<option value="">— Select Existing User —</option>' +
        users.map(u => `<option value="${u.id}">${escapeHtml(u.username)} (${escapeHtml(u.email)})</option>`).join("");

    ["user-1", "user-2", "user-3", "otp1-user", "otp2-user"].forEach(key => {
        const el = qs(`#${prefix}-${key}`);
        if (el) el.innerHTML = optionsHtml;
    });
}

// Load & Populate Banks (with default fast bank selection)
async function loadBanks() {
    try {
        state.banks = await api("/api/banks/");
        const filterSelect = qs("#branch-bank-filter");
        const addBankSelect = qs("#branch-bank-id");
        const editBankSelect = qs("#edit-branch-bank-id");

        let filterHtml = '<option value="all">All Banks (Show All Branches)</option>';
        filterHtml += state.banks.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");
        if (filterSelect) filterSelect.innerHTML = filterHtml;

        let bankOptionsHtml = '<option value="">— Select Bank —</option>';
        bankOptionsHtml += state.banks.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");

        if (addBankSelect) addBankSelect.innerHTML = bankOptionsHtml;
        if (editBankSelect) editBankSelect.innerHTML = bankOptionsHtml;

        if (addBankSelect && state.banks.length > 0) {
            addBankSelect.value = state.banks[0].id;
        }

    } catch (err) {
        console.error("Failed to load banks:", err);
        showToast(err.message, "error");
    }
}

// Load & Render Branches
async function loadBranches() {
    try {
        const branches = await api("/api/banks/branches");
        state.branches = branches;
        renderBranchesTable();
    } catch (err) {
        console.error("Failed to load branches:", err);
        showToast(err.message, "error");
    }
}

// Render Branches Table
function renderBranchesTable() {
    const tbody = qs("#branches-table-body");
    const countBadge = qs("#branches-count");

    let filtered = state.branches || [];
    if (state.selectedBankFilter !== "all") {
        const bankId = parseInt(state.selectedBankFilter);
        filtered = filtered.filter(b => b.bank_id === bankId);
    }

    if (countBadge) countBadge.textContent = `${filtered.length} branches`;
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-brand-muted">No branches found. Click "Add Branch" to create one.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(b => {
        const statusBadge = b.is_active
            ? `<span class="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-[10px] font-bold uppercase">Active</span>`
            : `<span class="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-[10px] font-bold uppercase">Inactive</span>`;

        const u1 = b.user1_name || "—";
        const u2 = b.user2_name || "—";
        const u3 = b.user3_name || "—";

        const otp1User = b.otp1_user_name || u1;
        const otp2User = b.otp2_user_name || u2;

        const otp1Badge = (b.enable_otp1 !== false)
            ? `<span class="block text-emerald-400 font-semibold"><i class="bi bi-check-circle-fill text-[10px] mr-1"></i>1st OTP (${escapeHtml(otp1User)})</span>`
            : `<span class="block text-brand-muted line-through"><i class="bi bi-x-circle text-[10px] mr-1"></i>1st OTP (Disabled)</span>`;

        const otp2Badge = (b.enable_otp2 !== false)
            ? `<span class="block text-brand-blue font-semibold"><i class="bi bi-check-circle-fill text-[10px] mr-1"></i>2nd OTP (${escapeHtml(otp2User)})</span>`
            : `<span class="block text-brand-muted line-through"><i class="bi bi-x-circle text-[10px] mr-1"></i>2nd OTP (Disabled)</span>`;

        return `
            <tr class="hover:bg-brand-border/20 transition">
                <td class="py-3 pr-3 font-semibold text-brand-purple">${b.id}</td>
                <td class="py-3 pr-3 font-medium text-white">${escapeHtml(b.name)}</td>
                <td class="py-3 pr-3 text-slate-300 font-semibold">${escapeHtml(b.bank_name || "—")}</td>
                <td class="py-3 pr-3">${statusBadge}</td>
                <td class="py-3 pr-3 text-xs text-slate-300">
                    <span class="block text-emerald-300 font-medium">1. ${escapeHtml(u1)}</span>
                    <span class="block text-brand-blue font-medium">2. ${escapeHtml(u2)}</span>
                    <span class="block text-slate-400 font-medium">3. ${escapeHtml(u3)}</span>
                </td>
                <td class="py-3 pr-3 text-xs">
                    ${otp1Badge}
                    ${otp2Badge}
                </td>
                <td class="py-3 text-right space-x-2">
                    <button class="px-2.5 py-1 bg-brand-purple/20 hover:bg-brand-purple/30 text-brand-purple rounded text-xs transition" onclick="openEditBranchModal(${b.id})">
                        <i class="bi bi-pencil-fill mr-1"></i> Edit
                    </button>
                    <button class="px-2.5 py-1 bg-brand-danger/20 hover:bg-brand-danger/30 text-brand-danger rounded text-xs transition" onclick="deleteBranch(${b.id}, '${escapeHtml(b.name).replace(/'/g, "\\'")}')">
                        <i class="bi bi-trash-fill mr-1"></i> Delete
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

// Live update OTP User Dropdowns based on User inputs
function updateOtpDropdownLabels(prefix = "branch") {
    const u1 = qs(`#${prefix}-user1-username`)?.value.trim() || "User 1 (Primary)";
    const u2 = qs(`#${prefix}-user2-username`)?.value.trim() || "User 2 (Secondary)";
    const u3 = qs(`#${prefix}-user3-username`)?.value.trim() || "User 3 (Tertiary)";

    const otp1Sel = qs(`#${prefix}-otp1-user`);
    const otp2Sel = qs(`#${prefix}-otp2-user`);

    if (otp1Sel) {
        const val = otp1Sel.value;
        otp1Sel.innerHTML = `
            <option value="1">1. ${escapeHtml(u1)}</option>
            <option value="2">2. ${escapeHtml(u2)}</option>
            <option value="3">3. ${escapeHtml(u3)}</option>
        `;
        if (val) otp1Sel.value = val;
    }

    if (otp2Sel) {
        const val = otp2Sel.value;
        otp2Sel.innerHTML = `
            <option value="2">2. ${escapeHtml(u2)}</option>
            <option value="1">1. ${escapeHtml(u1)}</option>
            <option value="3">3. ${escapeHtml(u3)}</option>
        `;
        if (val) otp2Sel.value = val;
    }
}

// Attach live input listeners
["branch", "edit-branch"].forEach(prefix => {
    ["user1-username", "user2-username", "user3-username"].forEach(id => {
        qs(`#${prefix}-${id}`)?.addEventListener("input", () => updateOtpDropdownLabels(prefix));
    });
});

// Bank Filter Event Listener
qs("#branch-bank-filter")?.addEventListener("change", (e) => {
    state.selectedBankFilter = e.target.value;
    renderBranchesTable();
});

// Modals Management
const addBranchModal = qs("#add-branch-modal");
const editBranchModal = qs("#edit-branch-modal");

qs("#open-add-branch-modal")?.addEventListener("click", () => {
    qs("#add-branch-form").reset();
    const addBankSelect = qs("#branch-bank-id");
    if (addBankSelect && state.banks.length > 0) {
        addBankSelect.value = state.banks[0].id;
    }
    qs("#add-branch-error").textContent = "";
    addBranchModal.classList.remove("hidden");
});
qs("#close-add-branch-modal")?.addEventListener("click", () => addBranchModal.classList.add("hidden"));
qs("#cancel-add-branch")?.addEventListener("click", () => addBranchModal.classList.add("hidden"));

qs("#add-branch-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
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

    let otp1UserChoice = 1;
    if (u1OtpRole === "otp1") otp1UserChoice = 1;
    else if (u2OtpRole === "otp1") otp1UserChoice = 2;
    else if (u3OtpRole === "otp1") otp1UserChoice = 3;

    let otp2UserChoice = 2;
    if (u2OtpRole === "otp2") otp2UserChoice = 2;
    else if (u1OtpRole === "otp2") otp2UserChoice = 1;
    else if (u3OtpRole === "otp2") otp2UserChoice = 3;

    const errEl = qs("#add-branch-error");

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
        addBranchModal.classList.add("hidden");
        showToast("Branch and 3 Users created with OTP configuration successfully!");
        await loadBranches();
    } catch (err) {
        errEl.textContent = err.message;
    }
});

window.openEditBranchModal = function(id) {
    const branch = (state.branches || []).find(b => b.id === id);
    if (!branch) return;

    qs("#edit-branch-id").value = branch.id;
    qs("#edit-branch-bank-id").value = branch.bank_id;
    qs("#edit-branch-name").value = branch.name;
    qs("#edit-branch-is-active").checked = branch.is_active !== false;

    // User 1 fields
    qs("#edit-branch-user1-username").value = branch.user1_name || "";
    qs("#edit-branch-user1-email").value = branch.user1_email || "";
    qs("#edit-branch-user1-whatsapp").value = branch.user1_whatsapp || "";
    qs("#edit-branch-user1-password").value = "";
    if (qs("#edit-branch-user1-active")) {
        qs("#edit-branch-user1-active").checked = branch.user1_active !== false;
    }

    // User 2 fields
    qs("#edit-branch-user2-username").value = branch.user2_name || "";
    qs("#edit-branch-user2-email").value = branch.user2_email || "";
    qs("#edit-branch-user2-whatsapp").value = branch.user2_whatsapp || "";
    qs("#edit-branch-user2-password").value = "";
    if (qs("#edit-branch-user2-active")) {
        qs("#edit-branch-user2-active").checked = branch.user2_active !== false;
    }

    // User 3 fields
    qs("#edit-branch-user3-username").value = branch.user3_name || "";
    qs("#edit-branch-user3-email").value = branch.user3_email || "";
    qs("#edit-branch-user3-whatsapp").value = branch.user3_whatsapp || "";
    qs("#edit-branch-user3-password").value = "";
    if (qs("#edit-branch-user3-active")) {
        qs("#edit-branch-user3-active").checked = branch.user3_active !== false;
    }

    // Set OTP role dropdowns for User 1, 2, 3
    const u1RoleSelect = qs("#edit-branch-user1-otp-role");
    const u2RoleSelect = qs("#edit-branch-user2-otp-role");
    const u3RoleSelect = qs("#edit-branch-user3-otp-role");

    if (u1RoleSelect) u1RoleSelect.value = branch.user1_otp_role || "otp1";
    if (u2RoleSelect) u2RoleSelect.value = branch.user2_otp_role || "otp2";
    if (u3RoleSelect) u3RoleSelect.value = branch.user3_otp_role || "none";

    qs("#edit-branch-error").textContent = "";
    editBranchModal.classList.remove("hidden");
};

qs("#close-edit-branch-modal")?.addEventListener("click", () => editBranchModal.classList.add("hidden"));
qs("#cancel-edit-branch")?.addEventListener("click", () => editBranchModal.classList.add("hidden"));

qs("#edit-branch-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const branchId = qs("#edit-branch-id").value;
    const bankId = parseInt(qs("#edit-branch-bank-id").value);
    const name = qs("#edit-branch-name").value.trim();
    const isActive = qs("#edit-branch-is-active").checked;

    const u1Name = qs("#edit-branch-user1-username")?.value.trim();
    const u1Email = qs("#edit-branch-user1-email")?.value.trim();
    const u1Pass = qs("#edit-branch-user1-password")?.value.trim();
    const u1Wa = qs("#edit-branch-user1-whatsapp")?.value.trim();
    const u1Active = qs("#edit-branch-user1-active")?.checked;
    const u1OtpRole = qs("#edit-branch-user1-otp-role")?.value || "otp1";

    const u2Name = qs("#edit-branch-user2-username")?.value.trim();
    const u2Email = qs("#edit-branch-user2-email")?.value.trim();
    const u2Pass = qs("#edit-branch-user2-password")?.value.trim();
    const u2Wa = qs("#edit-branch-user2-whatsapp")?.value.trim();
    const u2Active = qs("#edit-branch-user2-active")?.checked;
    const u2OtpRole = qs("#edit-branch-user2-otp-role")?.value || "otp2";

    const u3Name = qs("#edit-branch-user3-username")?.value.trim();
    const u3Email = qs("#edit-branch-user3-email")?.value.trim();
    const u3Pass = qs("#edit-branch-user3-password")?.value.trim();
    const u3Wa = qs("#edit-branch-user3-whatsapp")?.value.trim();
    const u3Active = qs("#edit-branch-user3-active")?.checked;
    const u3OtpRole = qs("#edit-branch-user3-otp-role")?.value || "none";

    const enableOtp1 = (u1OtpRole === "otp1" || u2OtpRole === "otp1" || u3OtpRole === "otp1");
    const enableOtp2 = (u1OtpRole === "otp2" || u2OtpRole === "otp2" || u3OtpRole === "otp2");

    const errEl = qs("#edit-branch-error");

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
        user1_active: u1Active,
        user1_otp_role: u1OtpRole,
        user2_username: u2Name || null,
        user2_email: u2Email || null,
        user2_password: u2Pass || null,
        user2_whatsapp: u2Wa || null,
        user2_active: u2Active,
        user2_otp_role: u2OtpRole,
        user3_username: u3Name || null,
        user3_email: u3Email || null,
        user3_password: u3Pass || null,
        user3_whatsapp: u3Wa || null,
        user3_active: u3Active,
        user3_otp_role: u3OtpRole,
    };

    try {
        await api(`/api/banks/branches/${branchId}`, {
            method: "PUT",
            body: JSON.stringify(payload)
        });
        editBranchModal.classList.add("hidden");
        showToast("Branch, users, and OTP settings updated successfully!");
        await loadBranches();
    } catch (err) {
        errEl.textContent = err.message;
    }
});

window.deleteBranch = async function(id, name) {
    if (!confirm(`Are you sure you want to delete branch "${name}"?`)) return;
    try {
        await api(`/api/banks/branches/${id}`, { method: "DELETE" });
        showToast(`Branch "${name}" deleted successfully!`);
        await loadBranches();
    } catch (err) {
        showToast(err.message, "error");
    }
};

document.addEventListener("DOMContentLoaded", initUser);
