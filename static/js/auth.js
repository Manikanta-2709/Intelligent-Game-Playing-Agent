/* ===== AUTHENTICATION LOGIC (Game Page) ===== */

let currentUser = null;

const userBadge = document.getElementById("user-badge");
const usernameDisplay = document.getElementById("username-display");
const logoutBtn = document.getElementById("logout-btn");

function updateAuthUI() {
    const statsDisplay = document.getElementById("user-stats");
    const headerUsername = document.getElementById("header-username-display");
    const profileUsername = document.getElementById("username-display");

    if (currentUser) {
        if (headerUsername) headerUsername.textContent = currentUser.username;
        if (profileUsername) profileUsername.textContent = currentUser.username;
        if (statsDisplay) statsDisplay.textContent = `Best Streak: ${currentUser.best_streak || 0}`;
        
        // Sync game data from user profile
        if (typeof window.syncGameScoreboard === "function") {
            window.syncGameScoreboard(currentUser);
        }
        if (typeof window.syncGameFeatures === "function") {
            window.syncGameFeatures(currentUser);
        }
    } else {
        window.location.href = "/login";
    }
}

window.syncProfileData = function(data) {
    if (!data) return;
    currentUser = data;
    updateAuthUI();
};

async function fetchProfile() {
    try {
        const res = await fetch("/api/user/profile");
        if (res.ok) {
            const data = await res.json();
            currentUser = data;
            updateAuthUI();
        } else {
            currentUser = null;
            updateAuthUI();
        }
    } catch (e) {
        console.error("Failed to fetch profile", e);
        window.location.href = "/login";
    }
}

// Setup Logout Buttons
const logoutAction = async () => {
    try {
        await fetch("/api/auth/logout", { method: "POST" });
        currentUser = null;
        window.location.href = "/";
    } catch (e) {
        console.error(e);
    }
};

document.addEventListener("DOMContentLoaded", () => {
    const logoutBtns = [document.getElementById("logout-btn"), document.getElementById("header-logout-btn")];
    logoutBtns.forEach(btn => {
        if (btn) btn.addEventListener("click", logoutAction);
    });
    fetchProfile();
});
