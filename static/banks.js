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

        if (state.user.role !== "super_admin" && state.user.role !== "admin") {
            window.location.href = "/dashboard";
            return;
        }

        const navUsers = qs("#nav-users-link");
        const navBranches = qs("#nav-branches-link");
        if (navUsers) navUsers.classList.remove("hidden");
        if (navBranches) navBranches.classList.remove("hidden");

        await loadUsersForDropdowns();
        await loadBanks();
        await loadBranches();
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

// Load Users for dropdown selection
async function loadUsersForDropdowns() {
    try {
        state.users = await api("/api/banks/users");
    } catch (err) {
        console.error("Failed to load users for branch assignment:", err);
    }
}

// Populate User Dropdowns in Branch Modals
function populateBranchUserDropdowns(prefix = "branch") {
    const users = state.users || [];
    const optionsHtml = '<option value="">— None —</option>' +
        users.map(u => `<option value="${u.id}">${escapeHtml(u.username)} (${escapeHtml(u.email)})</option>`).join("");

    ["user-1", "user-2", "user-3", "otp1-user", "otp2-user"].forEach(key => {
        const el = qs(`#${prefix}-${key}`);
        if (el) el.innerHTML = optionsHtml;
    });
}

// Populate Bank Dropdowns in Branch Modals (with default fast bank auto-selection)
function populateBranchBankDropdowns() {
    const banks = state.banks || [];
    const optionsHtml = '<option value="">— Select Bank —</option>' +
        banks.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("");

    const addBankSelect = qs("#branch-bank-id");
    const editBankSelect = qs("#edit-branch-bank-id");

    if (addBankSelect) {
        addBankSelect.innerHTML = optionsHtml;
        if (banks.length > 0) {
            addBankSelect.value = banks[0].id;
        }
    }
    if (editBankSelect) editBankSelect.innerHTML = optionsHtml;
}

// Fetch & Render Banks List
async function loadBanks() {
    try {
        const banks = await api("/api/banks/");
        state.banks = banks;
        const tbody = qs("#banks-table-body");
        const countBadge = qs("#banks-count");
        if (countBadge) countBadge.textContent = `${banks.length} banks`;

        populateBranchBankDropdowns();

        if (!tbody) return;
        if (banks.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-brand-muted">No registered banks found.</td></tr>`;
            return;
        }

        tbody.innerHTML = banks.map(b => {
            const adminDisplay = b.admin_username
                ? `<span class="block font-semibold text-white">${escapeHtml(b.admin_username)}</span><span class="block text-brand-muted text-xs">${escapeHtml(b.admin_email || '')}</span>`
                : `<span class="text-brand-muted text-xs">—</span>`;

            return `
                <tr class="hover:bg-brand-border/20 transition">
                    <td class="py-3 pr-4 font-semibold text-brand-blue">${b.id}</td>
                    <td class="py-3 pr-4 font-medium text-white">${escapeHtml(b.name)}</td>
                    <td class="py-3 pr-4 text-xs">${adminDisplay}</td>
                    <td class="py-3 pr-4 text-slate-400 font-mono text-xs">${new Date(b.created_at).toLocaleString()}</td>
                    <td class="py-3 text-right space-x-2">
                        <button class="px-2.5 py-1 bg-brand-blue/20 hover:bg-brand-blue/30 text-brand-blue rounded text-xs transition" onclick="openEditBankModal(${b.id})">
                            <i class="bi bi-pencil-fill mr-1"></i> Edit
                        </button>
                        <button class="px-2.5 py-1 bg-brand-danger/20 hover:bg-brand-danger/30 text-brand-danger rounded text-xs transition" onclick="deleteBank(${b.id}, '${escapeHtml(b.name).replace(/'/g, "\\'")}')">
                            <i class="bi bi-trash-fill mr-1"></i> Delete
                        </button>
                    </td>
                </tr>
            `;
        }).join("");
    } catch (err) {
        console.error("Failed to load banks:", err);
        showToast(err.message, "error");
    }
}

// Fetch & Render Branches List
async function loadBranches() {
    try {
        const branches = await api("/api/banks/branches");
        state.branches = branches;
        const tbody = qs("#branches-table-body");
        const countBadge = qs("#branches-count");
        if (countBadge) countBadge.textContent = `${branches.length} branches`;

        if (!tbody) return;
        if (branches.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-brand-muted">No registered branches found. Click "Add Branch" to create one.</td></tr>`;
            return;
        }

        tbody.innerHTML = branches.map(b => {
            const statusBadge = b.is_active
                ? `<span class="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-[10px] font-bold uppercase">Active</span>`
                : `<span class="px-2 py-0.5 bg-red-500/20 text-red-400 rounded text-[10px] font-bold uppercase">Inactive</span>`;

            const u1 = b.user1_name || "—";
            const u2 = b.user2_name || "—";
            const u3 = b.user3_name || "—";

            const otp1 = b.otp1_user_name || u1;
            const otp2 = b.otp2_user_name || u2;

            return `
                <tr class="hover:bg-brand-border/20 transition">
                    <td class="py-3 pr-3 font-semibold text-brand-purple">${b.id}</td>
                    <td class="py-3 pr-3 font-medium text-white">${escapeHtml(b.name)}</td>
                    <td class="py-3 pr-3 text-slate-300">${escapeHtml(b.bank_name || "—")}</td>
                    <td class="py-3 pr-3">${statusBadge}</td>
                    <td class="py-3 pr-3 text-xs text-slate-300">
                        <span class="block">1. ${escapeHtml(u1)}</span>
                        <span class="block">2. ${escapeHtml(u2)}</span>
                        <span class="block">3. ${escapeHtml(u3)}</span>
                    </td>
                    <td class="py-3 pr-3 text-xs">
                        <span class="block text-emerald-400 font-semibold">1st OTP: ${escapeHtml(otp1)}</span>
                        <span class="block text-brand-blue font-semibold">2nd OTP: ${escapeHtml(otp2)}</span>
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
    } catch (err) {
        console.error("Failed to load branches:", err);
    }
}

// ── Bank Modals Management ──
const addBankModal = qs("#add-bank-modal");
const editBankModal = qs("#edit-bank-modal");

qs("#open-add-bank-modal")?.addEventListener("click", () => {
    qs("#add-bank-form").reset();
    qs("#add-bank-error").textContent = "";
    addBankModal.classList.remove("hidden");
});
qs("#close-add-bank-modal")?.addEventListener("click", () => addBankModal.classList.add("hidden"));
qs("#cancel-add-bank")?.addEventListener("click", () => addBankModal.classList.add("hidden"));

qs("#add-bank-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.dataset.submitting === "true") return;
    form.dataset.submitting = "true";

    const submitBtn = form.querySelector('button[type="submit"]');
    const origBtnText = submitBtn ? submitBtn.innerHTML : "";

    const formElements = form.querySelectorAll("input, select, button");
    formElements.forEach(el => {
        el.disabled = true;
        el.classList.add("opacity-60", "cursor-not-allowed");
    });

    if (submitBtn) {
        submitBtn.innerHTML = `<i class="bi bi-arrow-repeat mr-1.5 animate-spin"></i> Creating...`;
    }

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
        addBankModal.classList.add("hidden");
        showToast("Bank & Admin created successfully!");
        await loadBanks();
    } catch (err) {
        if (errEl) errEl.textContent = err.message;
    } finally {
        form.dataset.submitting = "false";
        formElements.forEach(el => {
            el.disabled = false;
            el.classList.remove("opacity-60", "cursor-not-allowed");
        });
        if (submitBtn && origBtnText) {
            submitBtn.innerHTML = origBtnText;
        }
    }
});

window.openEditBankModal = function(id) {
    const bank = (state.banks || []).find(b => b.id === id);
    if (!bank) return;

    qs("#edit-bank-id").value = bank.id;
    qs("#edit-bank-name").value = bank.name;
    if (qs("#edit-bank-admin-username")) qs("#edit-bank-admin-username").value = bank.admin_username || "";
    if (qs("#edit-bank-admin-email")) qs("#edit-bank-admin-email").value = bank.admin_email || "";
    if (qs("#edit-bank-admin-password")) qs("#edit-bank-admin-password").value = "";

    qs("#edit-bank-error").textContent = "";
    editBankModal.classList.remove("hidden");
};
qs("#close-edit-bank-modal")?.addEventListener("click", () => editBankModal.classList.add("hidden"));
qs("#cancel-edit-bank")?.addEventListener("click", () => editBankModal.classList.add("hidden"));

qs("#edit-bank-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.dataset.submitting === "true") return;
    form.dataset.submitting = "true";

    const submitBtn = form.querySelector('button[type="submit"]');
    const origBtnText = submitBtn ? submitBtn.innerHTML : "";

    const formElements = form.querySelectorAll("input, select, button");
    formElements.forEach(el => {
        el.disabled = true;
        el.classList.add("opacity-60", "cursor-not-allowed");
    });

    if (submitBtn) {
        submitBtn.innerHTML = `<i class="bi bi-arrow-repeat mr-1.5 animate-spin"></i> Saving...`;
    }

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
        editBankModal.classList.add("hidden");
        showToast("Bank & Admin updated successfully!");
        await loadBanks();
    } catch (err) {
        if (errEl) errEl.textContent = err.message;
    } finally {
        form.dataset.submitting = "false";
        formElements.forEach(el => {
            el.disabled = false;
            el.classList.remove("opacity-60", "cursor-not-allowed");
        });
        if (submitBtn && origBtnText) {
            submitBtn.innerHTML = origBtnText;
        }
    }
});

window.deleteBank = async function(id, name) {
    if (!confirm(`Are you sure you want to delete bank "${name}"?`)) return;
    try {
        await api(`/api/banks/${id}`, { method: "DELETE" });
        showToast(`Bank "${name}" deleted successfully!`);
        await loadBanks();
        await loadBranches();
    } catch (err) {
        showToast(err.message, "error");
    }
};

// ── Branch Modals Management ──
const addBranchModal = qs("#add-branch-modal");
const editBranchModal = qs("#edit-branch-modal");

qs("#open-add-branch-modal")?.addEventListener("click", () => {
    qs("#add-branch-form").reset();
    populateBranchUserDropdowns("branch");
    qs("#add-branch-error").textContent = "";
    addBranchModal.classList.remove("hidden");
});
qs("#close-add-branch-modal")?.addEventListener("click", () => addBranchModal.classList.add("hidden"));
qs("#cancel-add-branch")?.addEventListener("click", () => addBranchModal.classList.add("hidden"));

qs("#add-branch-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.dataset.submitting === "true") return;
    form.dataset.submitting = "true";

    const submitBtn = form.querySelector('button[type="submit"]');
    const origBtnText = submitBtn ? submitBtn.innerHTML : "";

    const formElements = form.querySelectorAll("input, select, button");
    formElements.forEach(el => {
        el.disabled = true;
        el.classList.add("opacity-60", "cursor-not-allowed");
    });

    if (submitBtn) {
        submitBtn.innerHTML = `<i class="bi bi-arrow-repeat mr-1.5 animate-spin"></i> Saving Branch...`;
    }

    const bankId = parseInt(qs("#branch-bank-id").value);
    const name = qs("#branch-name").value.trim();
    const isActive = qs("#branch-is-active").checked;

    const u1 = qs("#branch-user-1") ? qs("#branch-user-1").value : "";
    const u2 = qs("#branch-user-2") ? qs("#branch-user-2").value : "";
    const u3 = qs("#branch-user-3") ? qs("#branch-user-3").value : "";

    const otp1 = qs("#branch-otp1-user") ? qs("#branch-otp1-user").value : "";
    const otp2 = qs("#branch-otp2-user") ? qs("#branch-otp2-user").value : "";

    const errEl = qs("#add-branch-error");
    if (errEl) errEl.textContent = "";

    const payload = {
        bank_id: bankId,
        name,
        is_active: isActive,
        user1_id: u1 ? parseInt(u1) : null,
        user2_id: u2 ? parseInt(u2) : null,
        user3_id: u3 ? parseInt(u3) : null,
        otp1_user_id: otp1 ? parseInt(otp1) : null,
        otp2_user_id: otp2 ? parseInt(otp2) : null,
    };

    try {
        await api("/api/banks/branches", {
            method: "POST",
            body: JSON.stringify(payload)
        });
        addBranchModal.classList.add("hidden");
        showToast("Branch created successfully!");
        await loadBranches();
    } catch (err) {
        if (errEl) errEl.textContent = err.message;
    } finally {
        form.dataset.submitting = "false";
        formElements.forEach(el => {
            el.disabled = false;
            el.classList.remove("opacity-60", "cursor-not-allowed");
        });
        if (submitBtn && origBtnText) {
            submitBtn.innerHTML = origBtnText;
        }
    }
});

window.openEditBranchModal = function(id) {
    const branch = (state.branches || []).find(b => b.id === id);
    if (!branch) return;

    qs("#edit-branch-id").value = branch.id;
    qs("#edit-branch-bank-id").value = branch.bank_id;
    qs("#edit-branch-name").value = branch.name;
    qs("#edit-branch-is-active").checked = branch.is_active !== false;

    populateBranchUserDropdowns("edit-branch");

    qs("#edit-branch-user-1").value = branch.user1_id || "";
    qs("#edit-branch-user-2").value = branch.user2_id || "";
    qs("#edit-branch-user-3").value = branch.user3_id || "";

    qs("#edit-branch-otp1-user").value = branch.otp1_user_id || "";
    qs("#edit-branch-otp2-user").value = branch.otp2_user_id || "";

    qs("#edit-branch-error").textContent = "";
    editBranchModal.classList.remove("hidden");
};

qs("#close-edit-branch-modal")?.addEventListener("click", () => editBranchModal.classList.add("hidden"));
qs("#cancel-edit-branch")?.addEventListener("click", () => editBranchModal.classList.add("hidden"));

qs("#edit-branch-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.dataset.submitting === "true") return;
    form.dataset.submitting = "true";

    const submitBtn = form.querySelector('button[type="submit"]');
    const origBtnText = submitBtn ? submitBtn.innerHTML : "";

    const formElements = form.querySelectorAll("input, select, button");
    formElements.forEach(el => {
        el.disabled = true;
        el.classList.add("opacity-60", "cursor-not-allowed");
    });

    if (submitBtn) {
        submitBtn.innerHTML = `<i class="bi bi-arrow-repeat mr-1.5 animate-spin"></i> Saving Changes...`;
    }

    const branchId = qs("#edit-branch-id").value;
    const bankId = parseInt(qs("#edit-branch-bank-id").value);
    const name = qs("#edit-branch-name").value.trim();
    const isActive = qs("#edit-branch-is-active").checked;

    const u1 = qs("#edit-branch-user-1") ? qs("#edit-branch-user-1").value : "";
    const u2 = qs("#edit-branch-user-2") ? qs("#edit-branch-user-2").value : "";
    const u3 = qs("#edit-branch-user-3") ? qs("#edit-branch-user-3").value : "";

    const otp1 = qs("#edit-branch-otp1-user") ? qs("#edit-branch-otp1-user").value : "";
    const otp2 = qs("#edit-branch-otp2-user") ? qs("#edit-branch-otp2-user").value : "";

    const errEl = qs("#edit-branch-error");
    if (errEl) errEl.textContent = "";

    const payload = {
        bank_id: bankId,
        name,
        is_active: isActive,
        user1_id: u1 ? parseInt(u1) : null,
        user2_id: u2 ? parseInt(u2) : null,
        user3_id: u3 ? parseInt(u3) : null,
        otp1_user_id: otp1 ? parseInt(otp1) : null,
        otp2_user_id: otp2 ? parseInt(otp2) : null,
    };

    try {
        await api(`/api/banks/branches/${branchId}`, {
            method: "PUT",
            body: JSON.stringify(payload)
        });
        editBranchModal.classList.add("hidden");
        showToast("Branch updated successfully!");
        await loadBranches();
    } catch (err) {
        if (errEl) errEl.textContent = err.message;
    } finally {
        form.dataset.submitting = "false";
        formElements.forEach(el => {
            el.disabled = false;
            el.classList.remove("opacity-60", "cursor-not-allowed");
        });
        if (submitBtn && origBtnText) {
            submitBtn.innerHTML = origBtnText;
        }
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
