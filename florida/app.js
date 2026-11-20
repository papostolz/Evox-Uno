// ---- Config ----
const API = "https://uno.evox.uno/florida";
const LOGIN_URL = "/login/?login=florida";

// Apps that can be signed in to Florida. Loaded from the server (GET /florida/apps → catalog).
// To add a new Evox Uno app, add it to APPS and FLORIDA_APPS in the server's index.js.
let APPS = [];
try { APPS = JSON.parse(localStorage.getItem("florida-catalog") || "[]"); } catch (_) {}

const state = { apps: {}, busy: false, prefs: {}, serverEnabled: false, publicKey: "", subscribed: false };
const $ = (id) => document.getElementById(id);

// ---- Account / API ----
function getAccount() {
  try { return JSON.parse(localStorage.getItem("evx-account") || "null"); }
  catch (_) { return null; }
}
const token = () => (getAccount() || {}).evxToken || "";

async function api(path, opts = {}) {
  try {
    const res = await fetch(API + path, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${token()}` },
    });
    if (res.status === 401) { signOut(); throw new Error("Session expired"); }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  } catch (e) {
    toast(e.message || "Connection error");
    throw e;
  }
}
const post = (p, body) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function signOut() {
  localStorage.removeItem("evx-account");
  location.reload();
}

// ---- UI helpers ----
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("visible"), 2600);
}

function isPWA() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function iconHTML(app) {
  const letter = esc((app.name || "?").charAt(0));
  // The letter is only a fallback: shown when there is no icon or the image fails to load
  return app.icon
    ? `<div class="app-icon"><img src="${esc(app.icon)}" alt="" onerror="this.nextElementSibling.hidden=false;this.remove()"><span hidden>${letter}</span></div>`
    : `<div class="app-icon"><span>${letter}</span></div>`;
}

// ---- Apps ----
function renderApps() {
  $("apps").innerHTML = APPS.map((a) => {
    const on = !!state.apps[a.id];
    return `<div class="item">${iconHTML(a)}
      <div class="row-text"><div class="row-title">${esc(a.name)}</div><div class="row-sub">${esc(a.desc)}</div></div>
      <button class="pill ${on ? "on" : ""}" data-app="${esc(a.id)}" ${state.busy ? "disabled" : ""}>${on ? "Connected" : "Sign in"}</button>
    </div>`;
  }).join("");
}

async function toggleApp(id) {
  if (state.busy) return;
  const on = !state.apps[id];
  state.busy = true;
  renderApps();
  try {
    await post(on ? "/apps/connect" : "/apps/disconnect", { app: id });
    state.apps[id] = on;
    toast(on ? "Signed in to " + APPS.find((a) => a.id === id).name : "Signed out");
  } catch (_) { /* toast shown */ }
  state.busy = false;
  renderApps();
}

async function loadApps() {
  try {
    const r = await api("/apps");
    state.apps = r.apps || {};
    if (Array.isArray(r.catalog)) {
      APPS = r.catalog;
      try { localStorage.setItem("florida-catalog", JSON.stringify(APPS)); } catch (_) {}
    }
  } catch (_) {}
  renderApps();
}

// ---- Feed ----
async function loadFeed() {
  try {
    const r = await api("/notifications");
    const items = (r.notifications || []).slice(0, 30);
    $("feed").innerHTML = items.length
      ? items.map((n) => {
          const app = APPS.find((a) => a.id === n.app) || { name: n.app || "?" };
          return `<div class="item">${iconHTML(app)}
            <div class="row-text"><div class="row-title">${esc(n.title)}</div><div class="row-sub">${esc(n.body)}</div></div>
            <span class="feed-time">${timeAgo(n.createdAt)}</span></div>`;
        }).join("")
      : `<div class="empty">No notifications yet</div>`;
  } catch (_) {}
}

// ---- Push ----
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function b64ToUint8(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const getReg = () => navigator.serviceWorker.ready;
async function getSub() {
  try { return await (await getReg()).pushManager.getSubscription(); } catch (_) { return null; }
}
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) { return ""; } };

function renderPush() {
  const master = $("ntf-master");
  let note = "Receive alerts from your connected apps on this device.";
  let usable = true;
  if (!pushSupported()) {
    usable = false;
    note = /iphone|ipad/i.test(navigator.userAgent) && !isPWA()
      ? "Add Florida to your home screen to enable notifications."
      : "Notifications aren't supported on this device.";
  } else if (!state.serverEnabled) { usable = false; note = "Notifications are unavailable right now."; }
  else if (Notification.permission === "denied") { usable = false; note = "Notifications are blocked in your browser settings."; }
  $("ntf-note").textContent = note;
  master.checked = usable && state.subscribed;
  master.disabled = !usable || state.busy;
  $("ntf-test").disabled = !master.checked || state.busy;
}

async function loadPush() {
  if (!pushSupported()) return renderPush();
  try {
    const sub = await getSub();
    const info = await api(`/push/prefs?endpoint=${encodeURIComponent(sub ? sub.endpoint : "")}`);
    state.serverEnabled = !!info.enabled;
    state.publicKey = info.publicKey || "";
    state.subscribed = !!info.subscribed && !!sub && Notification.permission === "granted";
  } catch (_) {}
  renderPush();
}

async function setPush(on) {
  if (state.busy) return;
  state.busy = true;
  renderPush();
  try {
    if (on) {
      const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (perm !== "granted") return toast("Notifications weren't allowed");
      const reg = await getReg();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(state.publicKey) });
      await post("/push/subscribe", { subscription: sub.toJSON(), tz: tz() });
      state.subscribed = true;
      toast("Notifications enabled");
    } else {
      const sub = await getSub();
      if (sub) {
        await post("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      state.subscribed = false;
    }
  } catch (_) {
    if (on) state.subscribed = false;
  } finally {
    state.busy = false;
    renderPush();
  }
}

async function sendTest() {
  if (state.busy) return;
  state.busy = true;
  renderPush();
  try {
    const r = await post("/push/test", {});
    toast(r && r.delivered ? "Test notification sent" : "No connected device found");
  } catch (_) {}
  state.busy = false;
  renderPush();
}

// ---- Account sheet ----
function setAvatar(imgEl, initialEl, acc) {
  const name = (acc.name && acc.name !== "Unknown" ? acc.name : acc.username) || "?";
  initialEl.textContent = name.charAt(0).toUpperCase();
  // The initial is only a fallback: shown until the picture loads, or if it fails
  imgEl.hidden = true;
  initialEl.hidden = false;
  if (acc.pfp) {
    imgEl.onload = () => { imgEl.hidden = false; initialEl.hidden = true; };
    imgEl.onerror = () => { imgEl.hidden = true; initialEl.hidden = false; };
    imgEl.src = acc.pfp;
  }
  return name;
}

function showMain(acc) {
  $("main").hidden = false;
  const name = setAvatar($("avatar-img"), $("avatar-initial"), acc);
  setAvatar($("sheet-img"), $("sheet-initial"), acc);
  $("sheet-name").textContent = name;
  $("sheet-user").textContent = acc.username ? "@" + acc.username : "";
  const h = new Date().getHours();
  $("greeting").textContent = (h < 12 ? "Good morning, " : h < 18 ? "Good afternoon, " : "Good evening, ") + name.split(" ")[0];

  renderApps();
  renderPush();
  loadPush();
  // The feed looks up app icons in APPS, so it waits for the app list
  loadApps().then(loadFeed);
}

// ---- Init ----
function init(allowBrowser = false) {
  const acc = getAccount();
  $("install-screen").hidden = $("signin-screen").hidden = $("main").hidden = true;

  if (!acc || !acc.evxToken) {
    if (!isPWA() && !allowBrowser) { $("install-screen").hidden = false; return; }
    $("signin-screen").hidden = false;
    return;
  }
  showMain(acc);
}

$("install-skip").onclick = () => init(true);
$("signin-btn").onclick = () => (location.href = LOGIN_URL);
$("avatar-btn").onclick = () => $("sheet").classList.add("visible");
$("sheet").onclick = (e) => { if (e.target === $("sheet")) $("sheet").classList.remove("visible"); };
$("signout-btn").onclick = signOut;
$("ntf-master").onchange = (e) => setPush(e.target.checked);
$("ntf-test").onclick = sendTest;
$("apps").onclick = (e) => {
  const b = e.target.closest("[data-app]");
  if (b) toggleApp(b.dataset.app);
};

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data && e.data.type === "florida-push") loadFeed();
  });
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !$("main").hidden) loadFeed();
});

init();