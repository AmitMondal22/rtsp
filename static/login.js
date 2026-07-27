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

// Register form submit
qs("#register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = qs("#reg-username").value.trim();
    const email = qs("#reg-email").value.trim();
    const password = qs("#reg-password").value.trim();
    const errEl = qs("#register-error");

    if (username.length < 3) {
        errEl.textContent = "Username must be at least 3 characters.";
        return;
    }
    if (password.length < 6) {
        errEl.textContent = "Password must be at least 6 characters.";
        return;
    }

    try {
        await api("/api/users/register", {
            method: "POST",
            body: JSON.stringify({ username, email, password }),
        });
        // Switch to login tab
        const loginTabBtn = qs("#tab-login-btn");
        if (loginTabBtn) loginTabBtn.click();
        
        qs("#reg-username").value = "";
        qs("#reg-email").value = "";
        qs("#reg-password").value = "";
        errEl.textContent = "";
        showToast("Registration successful! Please sign in.", "success");
    } catch (err) {
        errEl.textContent = err.message;
    }
});

// Auth tab selectors toggling
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
