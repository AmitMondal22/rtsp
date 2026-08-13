// ══════════════════════════════════════════
//  SURVEILLANCE SYSTEM — LOGIN CONTROLLER
// ══════════════════════════════════════════

const state = {
    token: localStorage.getItem("token"),
};

// Auto-redirect to dashboard if token exists
if (state.token) {
    window.location.href = "/dashboard";
}

// Helpers
function qs(selector) {
    return document.querySelector(selector);
}

async function api(url, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (state.token) {
        headers["Authorization"] = `Bearer ${state.token}`;
    }
    const res = await fetch(url, {
        ...options,
        headers,
    });
    if (res.status === 204) return null;
    const data = await res.json();
    if (!res.ok) {
        throw new Error(data.detail || "API request failed");
    }
    return data;
}

function showToast(message, type = "success") {
    const container = qs("#toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast-notification toast-${type}`;
    
    let iconClass = "bi-check-circle-fill";
    if (type === "error") iconClass = "bi-exclamation-triangle-fill";
    if (type === "info") iconClass = "bi-info-circle-fill";

    toast.innerHTML = `<i class="bi ${iconClass} mr-2"></i><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(120%)";
        toast.style.transition = "all 0.4s ease";
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// Login form submit
qs("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const identifier = qs("#login-username").value.trim();
    const password = qs("#login-password").value.trim();
    const errEl = qs("#login-error");

    try {
        const data = await api("/api/users/login", {
            method: "POST",
            body: JSON.stringify({ email: identifier, username: identifier, password }),
        });
        localStorage.setItem("token", data.access_token);
        showToast("Signed in successfully!", "success");
        setTimeout(() => {
            window.location.href = "/dashboard";
        }, 800);
    } catch (err) {
        errEl.textContent = err.message;
    }
});
