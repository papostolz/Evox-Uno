function setUnoProgress(value) {
    const progressFill = document.querySelector('.progress-fill');
    const progressLabel = document.querySelector('.progress-header span:last-child');
    const builtLabel = document.querySelector('.stats-ribbon .ribbon-stat .num');

    if (!progressFill) {
        return;
    }

    const numericValue = Number(value);
    const clamped = Number.isFinite(numericValue) ? Math.min(100, Math.max(0, numericValue)) : 0;
    const percent = `${clamped}%`;

    progressFill.style.setProperty('--progress-value', percent);

    if (progressLabel) {
        progressLabel.textContent = `${clamped} %`;
    }

    if (builtLabel) {
        builtLabel.textContent = percent;
    }
}


fetch("https://uno.evox.uno/uno-progress", {
    method: "GET",
    headers: {
        "Content-Type": "application/json",
    }
})
    .then(res => res.json())
    .then(data => {
        setUnoProgress(data.progress);
    })
    .catch(err => console.error(err));

const userMenu = document.querySelector('#userMenu');
const userMenuToggle = userMenu ? userMenu.querySelector('.user-dropdown-toggle') : null;

if (userMenu && userMenuToggle) {
    userMenuToggle.addEventListener('click', () => {
        const isOpen = userMenu.classList.toggle('open');
        userMenuToggle.setAttribute('aria-expanded', String(isOpen));
    });

    document.addEventListener('click', (event) => {
        if (!userMenu.contains(event.target)) {
            userMenu.classList.remove('open');
            userMenuToggle.setAttribute('aria-expanded', 'false');
        }
    });
}

function getStoredAccount() {
    try {
        return JSON.parse(localStorage.getItem("evx-account") || "null");
    } catch (_) {
        return null;
    }
}

function renderNavAccount() {
    const account = getStoredAccount();
    if (!account) return;
    if (account.pfp) document.getElementById("pfp").src = account.pfp
    document.getElementById("username").innerText = account.name && account.name !== 'Unknown' ? account.name : account.username
    document.getElementById("login").style.display = 'none'
    document.getElementById("userMenu").style.display = 'flex'
}

renderNavAccount();

function logout() {
    localStorage.removeItem("evx-account")
    window.location.reload()
}

/* ═══════════════ ACCOUNT SETTINGS ═══════════════ */
(function () {
    const API = "https://uno.evox.uno";
    const modal = document.getElementById("settingsModal");
    const openLink = document.getElementById("openSettings");
    if (!modal || !openLink) return;

    const $ = (id) => document.getElementById(id);
    const dialog = modal.querySelector(".st-modal");
    const tabs = Array.from(modal.querySelectorAll(".st-tab"));
    const panels = Array.from(modal.querySelectorAll(".st-panel"));

    const el = {
        banner: $("stBanner"),
        avatar: $("stAvatar"),
        pfpPick: $("stPfpPick"),
        pfpRemove: $("stPfpRemove"),
        pfpInput: $("stPfpInput"),
        profileForm: $("stProfileForm"),
        name: $("stName"),
        username: $("stUsername"),
        email: $("stEmail"),
        networkNote: $("stNetworkNote"),
        profileSave: $("stProfileSave"),
        pwForm: $("stPasswordForm"),
        pwUser: $("stPwUser"),
        pwLead: $("stPwLead"),
        currentWrap: $("stCurrentWrap"),
        currentPw: $("stCurrentPw"),
        newPw: $("stNewPw"),
        confirmPw: $("stConfirmPw"),
        pwSave: $("stPwSave"),
        prefs: $("stPrefs"),
        pushOff: $("stPushOff"),
        delStart: $("stDeleteStart"),
        delForm: $("stDeleteForm"),
        delLabel: $("stDeleteLabel"),
        delInput: $("stDeleteInput"),
        delConfirm: $("stDeleteConfirm"),
        delCancel: $("stDeleteCancel"),
        delNetworkNote: $("stDeleteNetworkNote"),
    };

    let acct = null;          // last GET /account response
    let lastFocus = null;
    let loadSeq = 0;

    /* ---------- helpers ---------- */

    function getToken() {
        const a = getStoredAccount();
        if (a && typeof a.evxToken === "string" && a.evxToken) return a.evxToken;
        try {
            return localStorage.getItem("evxToken") || localStorage.getItem("evx-token") || "";
        } catch (_) {
            return "";
        }
    }

    async function api(method, path, opts) {
        opts = opts || {};
        const token = getToken();
        if (!token) {
            const e = new Error("Your session token wasn't found. Log out and log in again.");
            e.status = 401;
            throw e;
        }
        const headers = { Authorization: "Bearer " + token };
        let body;
        if (opts.json !== undefined) {
            headers["Content-Type"] = "application/json";
            body = JSON.stringify(opts.json);
        } else if (opts.raw) {
            headers["Content-Type"] = opts.raw.type;
            body = opts.raw;
        }
        let res;
        try {
            res = await fetch(API + path, { method, headers, body });
        } catch (_) {
            throw new Error("Can't reach the server. Check your connection and try again.");
        }
        let data = null;
        try {
            data = await res.json();
        } catch (_) { /* non-JSON body */ }
        if (!res.ok || (data && data.success === false)) {
            const e = new Error((data && (data.msg || data.error)) || "Something went wrong (" + res.status + ").");
            e.status = res.status;
            throw e;
        }
        return data || {};
    }

    function msg(key, text, kind) {
        const n = $("stMsg-" + key);
        if (!n) return;
        n.textContent = text || "";
        if (text) n.dataset.kind = kind || "ok"; else delete n.dataset.kind;
    }

    function clearMsgs() {
        ["pfp", "profile", "password", "notifications", "danger"].forEach((k) => msg(k, ""));
    }

    function banner(text) {
        el.banner.textContent = text || "";
        el.banner.hidden = !text;
    }

    function handleAuthError(err) {
        if (err && err.status === 401) {
            banner("Your session is no longer valid. Please log out and log in again.");
            return true;
        }
        return false;
    }

    // Keep evx-account + navbar in sync with what the server says
    function syncStored(data) {
        const a = getStoredAccount();
        if (!a) return;
        ["name", "username", "pfp"].forEach((k) => {
            if (typeof data[k] === "string" && (data[k] || k === "name")) a[k] = data[k] || "Unknown";
        });
        try {
            localStorage.setItem("evx-account", JSON.stringify(a));
        } catch (_) { /* storage full / blocked */ }
        renderNavAccount();
    }

    function busy(btn, on, label) {
        if (!btn) return;
        if (on) {
            btn.dataset.label = btn.textContent;
            btn.textContent = label || "Saving…";
            btn.disabled = true;
        } else {
            if (btn.dataset.label) btn.textContent = btn.dataset.label;
            btn.disabled = false;
        }
    }

    /* ---------- tabs ---------- */

    function selectTab(name, focus) {
        tabs.forEach((t) => {
            const on = t.dataset.tab === name;
            t.classList.toggle("active", on);
            t.setAttribute("aria-selected", String(on));
            t.tabIndex = on ? 0 : -1;
            if (on && focus) t.focus();
        });
        panels.forEach((p) => { p.hidden = p.dataset.panel !== name; });
        if (name === "notifications") loadPrefs();
        const main = modal.querySelector(".st-main");
        if (main) main.scrollTop = 0;
    }

    tabs.forEach((t, i) => {
        t.addEventListener("click", () => selectTab(t.dataset.tab));
        t.addEventListener("keydown", (e) => {
            const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"];
            if (!keys.includes(e.key)) return;
            e.preventDefault();
            const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
            const next = tabs[(i + step + tabs.length) % tabs.length];
            selectTab(next.dataset.tab, true);
        });
    });

    /* ---------- open / close ---------- */

    function open() {
        if (!getStoredAccount()) return;
        lastFocus = document.activeElement;
        userMenu && userMenu.classList.remove("open");
        modal.hidden = false;
        document.body.classList.add("st-lock");
        requestAnimationFrame(() => modal.classList.add("show"));
        clearMsgs();
        banner("");
        selectTab("profile");
        resetDelete();
        el.pwForm.reset();
        loadAccount();
        dialog.focus();
    }

    function close() {
        modal.classList.remove("show");
        document.body.classList.remove("st-lock");
        setTimeout(() => { if (!modal.classList.contains("show")) modal.hidden = true; }, 180);
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    openLink.addEventListener("click", (e) => {
        e.preventDefault();
        open();
    });
    $("stClose").addEventListener("click", close);
    modal.addEventListener("mousedown", (e) => {
        if (e.target === modal) close();
    });
    document.addEventListener("keydown", (e) => {
        if (modal.hidden) return;
        if (e.key === "Escape") {
            e.preventDefault();
            close();
        } else if (e.key === "Tab") {
            // keep focus inside the dialog
            const f = Array.from(dialog.querySelectorAll("button, input, a[href]"))
                .filter((n) => !n.disabled && !n.hidden && n.tabIndex !== -1 && n.offsetParent !== null);
            if (!f.length) return;
            const first = f[0], last = f[f.length - 1];
            if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    });

    /* ---------- load + render ---------- */

    async function loadAccount() {
        const seq = ++loadSeq;
        dialog.classList.add("loading");
        // show what we already have while the request is in flight
        const cached = getStoredAccount();
        if (cached) {
            el.name.value = cached.name && cached.name !== "Unknown" ? cached.name : "";
            el.username.value = cached.username || "";
            el.email.value = cached.email || "";
            if (cached.pfp) el.avatar.src = cached.pfp;
        }
        try {
            const data = await api("GET", "/account");
            if (seq !== loadSeq) return;
            acct = data;
            render();
            syncStored(data);
        } catch (err) {
            if (seq !== loadSeq) return;
            if (!handleAuthError(err)) banner(err.message);
        } finally {
            if (seq === loadSeq) dialog.classList.remove("loading");
        }
    }

    function render() {
        if (!acct) return;
        el.name.value = acct.name || "";
        el.username.value = acct.username || "";
        el.email.value = acct.email || "";
        if (acct.pfp) el.avatar.src = acct.pfp;
        el.pfpRemove.hidden = !acct.hasCustomPfp;
        const network = acct.accountType === "network";
        el.networkNote.hidden = !network;
        el.delNetworkNote.hidden = !network;

        el.pwUser.value = acct.username || "";
        el.currentWrap.hidden = !acct.hasPassword;
        el.pwLead.textContent = acct.hasPassword
            ? "Change your password. You'll be logged out afterwards."
            : "You signed in with Google. Set a password to also log in with your email and password.";
        el.pwSave.textContent = acct.hasPassword ? "Update password" : "Set password";

        el.delLabel.textContent = acct.hasPassword
            ? "Enter your password to confirm"
            : 'Type your username ("' + (acct.username || "") + '") to confirm';
        el.delInput.type = acct.hasPassword ? "password" : "text";
        el.delInput.autocomplete = acct.hasPassword ? "current-password" : "off";
    }

    /* ---------- profile ---------- */

    el.profileForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!acct) return;
        msg("profile", "");
        const name = el.name.value.replace(/\s+/g, " ").trim();
        const username = el.username.value.trim().toLowerCase();
        const payload = {};

        if (name !== (acct.name || "")) {
            if (name.length < 1 || name.length > 50) return msg("profile", "Name must be 1–50 characters.", "err");
            if (/[<>]/.test(name)) return msg("profile", "Name can't contain < or >.", "err");
            payload.name = name;
        }
        if (username !== (acct.username || "").toLowerCase()) {
            if (!/^[a-z0-9_.]{3,24}$/.test(username)) {
                return msg("profile", "Username must be 3–24 characters: letters, numbers, dots or underscores.", "err");
            }
            payload.username = username;
        }
        if (!Object.keys(payload).length) return msg("profile", "Nothing to change.", "busy");

        busy(el.profileSave, true);
        msg("profile", "Saving…", "busy");
        try {
            const data = await api("PUT", "/account/profile", { json: payload });
            acct = data;
            render();
            syncStored(data);
            msg("profile", data.msg || "Profile updated.", "ok");
        } catch (err) {
            if (!handleAuthError(err)) msg("profile", err.message, "err");
        } finally {
            busy(el.profileSave, false);
        }
    });

    /* ---------- profile picture ---------- */

    const PFP_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    const PFP_MAX = 2 * 1024 * 1024;

    el.pfpPick.addEventListener("click", () => el.pfpInput.click());

    el.pfpInput.addEventListener("change", async () => {
        const file = el.pfpInput.files && el.pfpInput.files[0];
        el.pfpInput.value = "";
        if (!file) return;
        msg("pfp", "");
        if (!PFP_TYPES.includes(file.type)) return msg("pfp", "Use a PNG, JPEG, WebP or GIF image.", "err");
        if (file.size > PFP_MAX) return msg("pfp", "That image is too large (max 2 MB).", "err");

        busy(el.pfpPick, true, "Uploading…");
        msg("pfp", "Uploading…", "busy");
        try {
            const data = await api("PUT", "/account/pfp", { raw: file });
            acct = data;
            render();
            syncStored(data);
            msg("pfp", data.msg || "Profile picture updated.", "ok");
        } catch (err) {
            if (!handleAuthError(err)) msg("pfp", err.message, "err");
        } finally {
            busy(el.pfpPick, false);
        }
    });

    el.pfpRemove.addEventListener("click", async () => {
        msg("pfp", "");
        el.pfpRemove.disabled = true;
        try {
            const data = await api("DELETE", "/account/pfp");
            acct = data;
            render();
            syncStored(data);
            msg("pfp", data.msg || "Profile picture removed.", "ok");
        } catch (err) {
            if (!handleAuthError(err)) msg("pfp", err.message, "err");
        } finally {
            el.pfpRemove.disabled = false;
        }
    });

    /* ---------- password ---------- */

    el.pwForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!acct) return;
        msg("password", "");
        const current = el.currentPw.value;
        const next = el.newPw.value;
        const confirm = el.confirmPw.value;

        if (acct.hasPassword && !current) return msg("password", "Enter your current password.", "err");
        if (next.length < 8) return msg("password", "New password must be at least 8 characters.", "err");
        if (next.length > 128) return msg("password", "New password must be at most 128 characters.", "err");
        if (next !== confirm) return msg("password", "The new passwords don't match.", "err");

        const hadPassword = acct.hasPassword;
        const payload = { newPassword: next };
        if (hadPassword) payload.currentPassword = current;

        busy(el.pwSave, true);
        msg("password", "Saving…", "busy");
        try {
            const data = await api("POST", "/account/password", { json: payload });
            el.pwForm.reset();
            if (hadPassword) {
                msg("password", (data.msg || "Password updated.") + " Logging you out…", "ok");
                setTimeout(() => {
                    localStorage.removeItem("evx-account");
                    window.location.reload();
                }, 1500);
            } else {
                acct.hasPassword = true;
                render();
                msg("password", data.msg || "Password set.", "ok");
                busy(el.pwSave, false);
            }
        } catch (err) {
            busy(el.pwSave, false);
            if (!handleAuthError(err)) msg("password", err.message, "err");
        }
    });

    /* ---------- notifications ---------- */

    const prefInputs = Array.from(el.prefs.querySelectorAll("input[data-pref]"));
    let prefsLoaded = false;

    async function loadPrefs() {
        if (prefsLoaded) return;
        msg("notifications", "");
        el.prefs.classList.add("busy");
        try {
            const data = await api("GET", "/tazro/push/prefs");
            prefInputs.forEach((i) => { i.checked = !!(data.prefs && data.prefs[i.dataset.pref]); });
            el.pushOff.hidden = data.enabled !== false;
            prefsLoaded = true;
        } catch (err) {
            if (!handleAuthError(err)) msg("notifications", err.message, "err");
        } finally {
            el.prefs.classList.remove("busy");
        }
    }

    prefInputs.forEach((input) => {
        input.addEventListener("change", async () => {
            const key = input.dataset.pref;
            const value = input.checked;
            msg("notifications", "");
            el.prefs.classList.add("busy");
            const body = { prefs: { [key]: value } };
            try {
                body.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            } catch (_) { /* no tz */ }
            try {
                const data = await api("PUT", "/tazro/push/prefs", { json: body });
                prefInputs.forEach((i) => { i.checked = !!(data.prefs && data.prefs[i.dataset.pref]); });
                msg("notifications", "Saved.", "ok");
            } catch (err) {
                input.checked = !value; // revert
                if (!handleAuthError(err)) msg("notifications", err.message, "err");
            } finally {
                el.prefs.classList.remove("busy");
            }
        });
    });

    /* ---------- delete account ---------- */

    function resetDelete() {
        el.delForm.hidden = true;
        el.delStart.hidden = false;
        el.delInput.value = "";
        el.delConfirm.disabled = true;
    }

    el.delStart.addEventListener("click", () => {
        msg("danger", "");
        el.delStart.hidden = true;
        el.delForm.hidden = false;
        el.delInput.focus();
    });
    el.delCancel.addEventListener("click", () => {
        msg("danger", "");
        resetDelete();
        el.delStart.focus();
    });
    el.delInput.addEventListener("input", () => {
        el.delConfirm.disabled = !el.delInput.value;
    });

    el.delForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!acct || !el.delInput.value) return;
        const payload = acct.hasPassword
            ? { password: el.delInput.value }
            : { confirm: el.delInput.value.trim() };

        busy(el.delConfirm, true, "Deleting…");
        el.delCancel.disabled = true;
        msg("danger", "Deleting…", "busy");
        try {
            await api("DELETE", "/account", { json: payload });
            msg("danger", "Account deleted.", "ok");
            localStorage.removeItem("evx-account");
            setTimeout(() => window.location.reload(), 800);
        } catch (err) {
            busy(el.delConfirm, false);
            el.delConfirm.disabled = !el.delInput.value;
            el.delCancel.disabled = false;
            if (!handleAuthError(err)) msg("danger", err.message, "err");
        }
    });
})();