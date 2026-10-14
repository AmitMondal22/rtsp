// ══════════════════════════════════════════
//  OTP SHIELD ACCESS MANAGEMENT — ENTERPRISE LOGIN CONTROLLER
// ══════════════════════════════════════════

const state = {
    token: localStorage.getItem("token"),
};

// Check if user has an active session and redirect to dashboard
if (state.token) {
    // Only auto-redirect if not explicitly logged out
    const urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.has("logout")) {
        window.location.href = "/dashboard";
    } else {
        localStorage.removeItem("token");
        state.token = null;
    }
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
        let msg = "API request failed";
        if (typeof data.detail === "string") {
            msg = data.detail;
        } else if (Array.isArray(data.detail) && data.detail[0]?.msg) {
            msg = data.detail[0].msg;
        }
        throw new Error(msg);
    }
    return data;
}

function showToast(message, type = "success") {
    const container = qs("#toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast-notification toast-${type}`;
    
    let iconClass = "bi-check-circle-fill text-emerald-500";
    if (type === "error") iconClass = "bi-exclamation-triangle-fill text-rose-500";
    if (type === "info") iconClass = "bi-info-circle-fill text-sky-500";

    toast.innerHTML = `<i class="bi ${iconClass} text-sm mr-2 shrink-0"></i><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(120%)";
        toast.style.transition = "all 0.4s ease";
        setTimeout(() => toast.remove(), 400);
    }, 3500);
}

function showError(message) {
    const errContainer = qs("#login-error-container");
    const errText = qs("#login-error-text");
    if (errContainer && errText) {
        errText.textContent = message;
        errContainer.classList.remove("hidden");
        errContainer.classList.remove("animate-shake");
        // Trigger reflow to restart animation
        void errContainer.offsetWidth;
        errContainer.classList.add("animate-shake");
    }
}

function clearError() {
    const errContainer = qs("#login-error-container");
    if (errContainer) {
        errContainer.classList.add("hidden");
    }
}

// Initialize on DOM load
document.addEventListener("DOMContentLoaded", () => {
    const usernameInput = qs("#login-username");
    const passwordInput = qs("#login-password");
    const rememberMeCheckbox = qs("#remember-me");
    const togglePasswordBtn = qs("#toggle-password-btn");
    const togglePasswordIcon = qs("#password-toggle-icon");
    const dismissErrorBtn = qs("#dismiss-error-btn");
    const loginForm = qs("#login-form");
    const submitBtn = qs("#login-submit-btn");
    const btnText = qs("#btn-text");

    // Pre-populate remembered username if stored
    const savedUser = localStorage.getItem("ang_remembered_username");
    if (savedUser && usernameInput) {
        usernameInput.value = savedUser;
        if (rememberMeCheckbox) rememberMeCheckbox.checked = true;
        if (passwordInput) passwordInput.focus();
    } else if (usernameInput) {
        usernameInput.focus();
    }

    // Toggle Password Visibility
    if (togglePasswordBtn && passwordInput && togglePasswordIcon) {
        togglePasswordBtn.addEventListener("click", () => {
            if (passwordInput.type === "password") {
                passwordInput.type = "text";
                togglePasswordIcon.className = "bi bi-eye-slash text-sm text-sky-600";
                togglePasswordBtn.title = "Hide password";
            } else {
                passwordInput.type = "password";
                togglePasswordIcon.className = "bi bi-eye text-sm text-slate-400";
                togglePasswordBtn.title = "Show password";
            }
        });
    }

    // Dismiss Error Banner
    if (dismissErrorBtn) {
        dismissErrorBtn.addEventListener("click", clearError);
    }

    // Clear error as user types
    usernameInput?.addEventListener("input", clearError);
    passwordInput?.addEventListener("input", clearError);

    // Login Form Submit Handler
    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            clearError();

            const identifier = usernameInput?.value.trim();
            const password = passwordInput?.value.trim();

            if (!identifier) {
                showError("Please enter your username or registered email address.");
                usernameInput?.focus();
                return;
            }

            if (!password) {
                showError("Please enter your account password.");
                passwordInput?.focus();
                return;
            }

            // Set button into loading state
            if (submitBtn) {
                submitBtn.disabled = true;
                if (btnText) btnText.textContent = "Signing in...";
                const spinner = document.createElement("span");
                spinner.id = "btn-spinner";
                spinner.className = "w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin mr-1.5";
                submitBtn.prepend(spinner);
            }

            try {
                const data = await api("/api/users/login", {
                    method: "POST",
                    body: JSON.stringify({ email: identifier, username: identifier, password }),
                });

                if (data && data.access_token) {
                    if (rememberMeCheckbox?.checked) {
                        localStorage.setItem("ang_remembered_username", identifier);
                    } else {
                        localStorage.removeItem("ang_remembered_username");
                    }

                    localStorage.setItem("token", data.access_token);
                    
                    if (btnText) btnText.textContent = "Signed In";
                    submitBtn?.querySelector("#btn-spinner")?.remove();
                    if (submitBtn) submitBtn.className = "w-full py-2.5 bg-emerald-600 text-white font-semibold rounded-lg text-xs flex items-center justify-center space-x-2 shadow-sm";
                    
                    showToast("Access authorized. Redirecting...", "success");

                    setTimeout(() => {
                        window.location.href = "/dashboard";
                    }, 400);
                } else {
                    throw new Error("Invalid response format received from server.");
                }
            } catch (err) {
                showError(err.message || "Invalid credentials or unauthorized account.");
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.querySelector("#btn-spinner")?.remove();
                    submitBtn.className = "w-full py-2.5 bg-sky-600 hover:bg-sky-700 active:scale-[0.99] transition text-white font-semibold rounded-lg text-xs flex items-center justify-center space-x-2 shadow-sm cursor-pointer";
                }
                if (btnText) btnText.textContent = "Sign In";
            }
        });
    }
});
