/* ============================================
   Finavox — Apple-Style Finance App
   Application Logic
   ============================================ */

// ---- STATE ----
const defaultState = {
  user: { name: "Unknown", initial: "G" },
  balance: 1957.43,
  savings: 842.5,
  currentView: "home",
  selectedDate: new Date(),
  txSelectedDate: new Date(),
  addSheetOpen: false,
  debtSheetOpen: false,
  goalSheetOpen: false,
  addType: "expense",
  amountStr: "",
  selectedCategory: null,
  debtType: "owe",
  savingsTransferSource: "main",
  debtViewTab: "owe",
  faIconPickerOpen: false,
  faFreeIcons: [],
  faFilteredFreeIcons: [],
  faIconPage: 0,
  faIconQuery: "",
  faIconsLoading: false,
  editingDebtId: null,
  isFuturePayment: false,
  scheduleMode: "now", // "now" | "future" | "recurring"
  futurePaymentDueDate: "",
  paymentViewTab: "incoming",
  editingPaymentId: null,
  editingRecurringId: null,
  recReturn: false,
  rec: {
    preset: "month",
    unit: "month",
    interval: 1,
    startDate: "",
    hasEnd: false,
    endDate: "",
  },
  transactionFilter: "all",
  searchQuery: "",
  transactions: [],
  savingsGoals: [],
  debts: [],
  payments: [],
  recurring: [],
};

let persistedState = null;
try {
  const rawState = localStorage.getItem("tazroState");
  persistedState = rawState ? JSON.parse(rawState) : null;
} catch (_err) {
  persistedState = null;
}

const state = {
  ...defaultState,
  ...(persistedState && typeof persistedState === "object"
    ? persistedState
    : {}),
  user: {
    ...defaultState.user,
    ...(persistedState && persistedState.user ? persistedState.user : {}),
  },
};

// ---- SAVINGS HISTORY ----
const SAVINGS_HISTORY_KEY = "tazroSavingsHistory";

function recordSavingsSnapshot() {
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem(SAVINGS_HISTORY_KEY)) || [];
  } catch {}
  history.push({ date: new Date().toISOString(), savings: state.savings });
  if (history.length > 90) history = history.slice(-90);
  localStorage.setItem(SAVINGS_HISTORY_KEY, JSON.stringify(history));
}

function getSavingsHistory() {
  try {
    return JSON.parse(localStorage.getItem(SAVINGS_HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

// ---- API ----
const API = "https://uno.evox.uno/tazro";

function getAuthToken() {
  const localToken = localStorage.getItem("evx-account")
    ? JSON.parse(localStorage.getItem("evx-account")).evxToken
    : "";

  return localToken;
}

function withAuthHeaders(headers = {}) {
  const token = getAuthToken();
  if (!token) return { ...headers };

  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  };
}

async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(API + path, {
      ...options,
      headers: withAuthHeaders(options.headers || {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  } catch (e) {
    showToast(
      "fa-solid fa-triangle-exclamation",
      e.message || "Σφάλμα σύνδεσης",
    );
    throw e;
  }
}

function apiGet(path) {
  return apiFetch(path);
}
function apiDelete(path) {
  return apiFetch(path, { method: "DELETE" });
}
function apiPost(path, body) {
  return apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function apiPut(path, body) {
  return apiFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

let _lastDataDay = "";
let _lastLoadAt = 0; // timestamp of the last successful loadData()

async function loadData() {
  // "today" is sent so the server catches up recurring rules by the user's local date
  _lastDataDay = toDayKey(new Date());
  const data = await apiGet(`/data?today=${_lastDataDay}`).catch(() => null);
  if (!data) return;
  state.balance = data.balance ?? 0;
  state.savings = data.savings ?? 0;
  state.transactions = data.transactions ?? [];
  state.savingsGoals = data.goals ?? [];
  state.debts = data.debts ?? [];
  state.payments = data.payments ?? [];
  state.recurring = data.recurring ?? [];
  _lastLoadAt = Date.now();

  // Seed savings history on first run so the chart always has a starting point
  if (getSavingsHistory().length === 0) recordSavingsSnapshot();
}

// ---- SSE ----
let _sseSource = null;

function initSSE() {
  const token = getAuthToken();
  if (!token) return;
  if (_sseSource) {
    _sseSource.close();
    _sseSource = null;
  }

  const dot = document.getElementById("sse-dot");
  const url = `${API}/stream?evxToken=${encodeURIComponent(token)}`;
  _sseSource = new EventSource(url);

  _sseSource.addEventListener("update", (e) => {
    const d = JSON.parse(e.data);
    if (d.balance !== undefined) state.balance = d.balance;
    if (d.savings !== undefined) state.savings = d.savings;
    if (Array.isArray(d.transactions)) state.transactions = d.transactions;
    renderBalanceCard();
    renderFlowCard();
    renderStats();
    if (state.currentView === "savings") {
      renderSavingsBalances();
      renderSavingsScore();
    }
    if (Array.isArray(d.transactions)) {
      renderRecentTransactions();
      if (state.currentView === "transactions") renderTransactions();
      // A payment may have just arrived from another user
      checkReceivedPayments();
    }
  });

  _sseSource.addEventListener("aiTips", (e) => {
    const d = JSON.parse(e.data);
    if (Array.isArray(d.aiTips)) {
      const forecasts = d.aiTips.filter((t) => t.type === "forecast");
      const tips = d.aiTips.filter((t) => t.type === "tips");
      if (forecasts.length || tips.length) renderAIInsights();
    }
  });

  _sseSource.onopen = () => {
    if (dot) {
      dot.className = "sse-dot sse-dot--on";
      dot.title = "Live";
    }
  };
  _sseSource.onerror = () => {
    if (dot) {
      dot.className = "sse-dot sse-dot--off";
      dot.title = "Offline";
    }
    // auto-reconnect: browser retries EventSource by default
  };
}

// ---- HELPERS ----
function formatCurrency(n) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 0) return "Σήμερα";
  if (diff === 1) return "Χθες";
  if (diff < 7) return d.toLocaleDateString("el-GR", { weekday: "long" });
  return d.toLocaleDateString("el-GR", { month: "short", day: "numeric" });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("el-GR", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDaysToDate(date, days) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + days);
  return d;
}

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function toDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromDayKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ---- CATEGORIES ----
const categories = {
  expense: [
    { id: "food", name: "Φαγητό", icon: "fa-solid fa-burger", bg: "#FFF3E021" },
    {
      id: "coffee",
      name: "Καφές",
      icon: "fa-solid fa-mug-hot",
      bg: "#EFEBE921",
    },
    {
      id: "transport",
      name: "Μεταφορά",
      icon: "fa-solid fa-bus",
      bg: "#E3F2FD21",
    },
    { id: "books", name: "Βιβλία", icon: "fa-solid fa-book", bg: "#FCE4EC21" },
    {
      id: "entertainment",
      name: "Διασκέδαση",
      icon: "fa-solid fa-gamepad",
      bg: "#F3E5F521",
    },
    {
      id: "shopping",
      name: "Ψώνια",
      icon: "fa-solid fa-shirt",
      bg: "#E8F5E921",
    },
    {
      id: "subscriptions",
      name: "Συνδρομές",
      icon: "fa-solid fa-mobile-screen-button",
      bg: "#E0F7FA21",
    },
    {
      id: "health",
      name: "Υγεία",
      icon: "fa-solid fa-capsules",
      bg: "#FFF8E121",
    },
    {
      id: "utilities",
      name: "Λογαριασμοί",
      icon: "fa-solid fa-lightbulb",
      bg: "#FFFDE721",
    },
    { id: "rent", name: "Ενοίκιο", icon: "fa-solid fa-house", bg: "#F1F8E921" },
    {
      id: "other_expense",
      name: "Άλλο",
      icon: "fa-solid fa-thumbtack",
      bg: "#ECEFF121",
    },
  ],
  income: [
    {
      id: "job",
      name: "Εργασία",
      icon: "fa-solid fa-briefcase",
      bg: "#E8F5E921",
    },
    {
      id: "scholarship",
      name: "Υποτροφία",
      icon: "fa-solid fa-graduation-cap",
      bg: "#FFF8E121",
    },
    {
      id: "family",
      name: "Οικογένεια",
      icon: "fa-solid fa-people-group",
      bg: "#FCE4EC21",
    },
    {
      id: "freelance",
      name: "Freelance",
      icon: "fa-solid fa-sack-dollar",
      bg: "#F3E5F521",
    },
    {
      id: "aid",
      name: "Ενίσχυση",
      icon: "fa-solid fa-building-columns",
      bg: "#E3F2FD21",
    },
    { id: "gift", name: "Δώρο", icon: "fa-solid fa-gift", bg: "#FFF3E021" },
    {
      id: "refund",
      name: "Επιστροφή",
      icon: "fa-solid fa-rotate-left",
      bg: "#E0F7FA21",
    },
    {
      id: "other_income",
      name: "Άλλο",
      icon: "fa-solid fa-thumbtack",
      bg: "#ECEFF121",
    },
  ],
};

function getCategoryInfo(id) {
  const all = [...categories.expense, ...categories.income];
  return (
    all.find((c) => c.id === id) || {
      icon: "fa-solid fa-thumbtack",
      name: "Άλλο",
      bg: "#eceff121",
    }
  );
}

function sanitizeFaClass(iconClass, fallback = "fa-solid fa-circle") {
  if (typeof iconClass !== "string") return fallback;
  const trimmed = iconClass.trim();
  if (!trimmed) return fallback;
  if (!/^fa[a-z-]*\s+fa-[a-z0-9-]+(?:\s+fa-[a-z0-9-]+)*$/i.test(trimmed))
    return fallback;
  return trimmed;
}

function renderFaIcon(iconClass, fallback, extraClass = "") {
  const safe = sanitizeFaClass(iconClass, fallback);
  const cls = extraClass ? `${safe} ${extraClass}` : safe;
  return `<i class="${cls}" aria-hidden="true"></i>`;
}

const FA_FREE_ICONS_URL =
  "https://raw.githubusercontent.com/mehmetsahindev/FontAwesome-v6.4.2.json/refs/heads/master/fontawesome-v6.4.2-free.json";
const FA_STYLE_TO_CLASS = {
  solid: "fa-solid",
  regular: "fa-regular",
  brands: "fa-brands",
};
const FA_ICON_PAGE_SIZE = 180;
const FALLBACK_FREE_ICON_CLASSES = [
  "fa-solid fa-bullseye",
  "fa-solid fa-house",
  "fa-solid fa-wallet",
  "fa-solid fa-piggy-bank",
  "fa-solid fa-briefcase",
  "fa-solid fa-car",
  "fa-solid fa-plane",
  "fa-solid fa-bus",
  "fa-solid fa-book",
  "fa-solid fa-graduation-cap",
  "fa-solid fa-gamepad",
  "fa-solid fa-heart",
  "fa-solid fa-dumbbell",
  "fa-solid fa-cart-shopping",
  "fa-solid fa-lightbulb",
  "fa-solid fa-mobile-screen-button",
  "fa-solid fa-camera",
  "fa-solid fa-laptop",
  "fa-solid fa-gift",
  "fa-solid fa-star",
  "fa-solid fa-gem",
  "fa-solid fa-rocket",
  "fa-solid fa-seedling",
  "fa-solid fa-hand-holding-dollar",
  "fa-brands fa-apple",
  "fa-brands fa-google",
  "fa-brands fa-paypal",
  "fa-brands fa-amazon",
  "fa-brands fa-github",
  "fa-brands fa-linkedin",
];

let _faIconLoadPromise = null;

function normalizeFreeFaIcons(rawIcons) {
  const unique = new Set();
  const normalized = [];

  rawIcons.forEach((icon) => {
    if (!icon || !icon.className) return;
    if (unique.has(icon.className)) return;
    unique.add(icon.className);
    normalized.push(icon);
  });

  normalized.sort((a, b) => {
    if (a.style !== b.style) return a.style.localeCompare(b.style);
    return a.name.localeCompare(b.name);
  });

  return normalized;
}

async function loadFreeFaIcons() {
  if (state.faFreeIcons.length) return true;
  if (_faIconLoadPromise) return _faIconLoadPromise;

  state.faIconsLoading = true;

  _faIconLoadPromise = (async () => {
    try {
      const res = await fetch(FA_FREE_ICONS_URL);
      if (!res.ok) throw new Error("Could not load Font Awesome metadata");

      const metadata = await res.json();
      const icons = [];

      // metadata = { solid: ["fa-house", ...], regular: [...], brands: [...] }
      Object.entries(metadata || {}).forEach(([style, iconList]) => {
        const styleClass = FA_STYLE_TO_CLASS[style];
        if (!styleClass || !Array.isArray(iconList)) return;

        iconList.forEach((iconName) => {
          const safeName = iconName.startsWith("fa-")
            ? iconName
            : `fa-${iconName}`;

          icons.push({
            className: `${styleClass} ${safeName}`,
            name: safeName,
            label: safeName.replace("fa-", "").replace(/-/g, " "),
            style,
          });
        });
      });

      state.faFreeIcons = normalizeFreeFaIcons(icons);

      if (!state.faFreeIcons.length) {
        throw new Error("No free icon metadata returned");
      }

      return true;
    } catch (_err) {
      console.log("err", _err);

      state.faFreeIcons = normalizeFreeFaIcons(
        FALLBACK_FREE_ICON_CLASSES.map((cls) => ({
          className: cls,
          name: cls.split(" ").slice(1).join(" "),
          label: cls,
          style: cls.split(" ")[0].replace("fa-", ""),
        })),
      );

      return false;
    } finally {
      state.faIconsLoading = false;
      _faIconLoadPromise = null;
    }
  })();

  return _faIconLoadPromise;
}

function updateGoalIconPreview() {
  const input = document.getElementById("goal-icon-input");
  const iconSlot = document.getElementById("goal-icon-preview-icon");
  const textSlot = document.getElementById("goal-icon-preview-text");
  const safeClass = sanitizeFaClass(
    input ? input.value : "",
    "fa-solid fa-bullseye",
  );

  if (iconSlot)
    iconSlot.innerHTML = renderFaIcon(safeClass, "fa-solid fa-bullseye");
  if (textSlot)
    textSlot.textContent = safeClass
      .replace("fa-", "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .split(" ")
      .slice(2)
      .join(" ");
}

function renderFaIconGrid() {
  const grid = document.getElementById("fa-icon-grid");
  const countEl = document.getElementById("fa-picker-count");
  const loadMoreBtn = document.getElementById("fa-picker-load-more");
  const selected = sanitizeFaClass(
    (document.getElementById("goal-icon-input") || {}).value || "",
    "fa-solid fa-bullseye",
  );

  if (!grid) return;

  const max = state.faIconPage * FA_ICON_PAGE_SIZE;
  const visibleIcons = state.faFilteredFreeIcons.slice(0, max);

  if (!visibleIcons.length) {
    grid.innerHTML =
      '<div class="fa-picker-empty">Δεν βρέθηκαν εικονίδια.</div>';
  } else {
    grid.innerHTML = visibleIcons
      .map(
        (icon) => `
      <button type="button" class="fa-picker-item ${icon.className === selected ? "selected" : ""}" data-icon="${icon.className}" title="${icon.className}">
        <span class="fa-picker-item-icon">${renderFaIcon(icon.className, "fa-solid fa-circle")}</span>
        <span class="fa-picker-item-name">${icon.name
          .replace("fa-", "")
          .replace(/-/g, " ")
          .replace("icon", "")
          .replace(/\b\w/g, (char) => char.toUpperCase())}</span>
      </button>
    `,
      )
      .join("");

    grid.querySelectorAll(".fa-picker-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = document.getElementById("goal-icon-input");
        const iconClass = sanitizeFaClass(
          btn.dataset.icon,
          "fa-solid fa-bullseye",
        );
        if (input) input.value = iconClass;
        updateGoalIconPreview();
        closeFaIconPicker();
      });
    });
  }

  if (countEl)
    countEl.textContent = `${visibleIcons.length} / ${state.faFilteredFreeIcons.length}`;
  if (loadMoreBtn)
    loadMoreBtn.style.display =
      visibleIcons.length < state.faFilteredFreeIcons.length ? "block" : "none";
}

function applyFaIconFilter(query = "") {
  const q = String(query).trim().toLowerCase();
  state.faIconQuery = q;

  state.faFilteredFreeIcons = !q
    ? [...state.faFreeIcons]
    : state.faFreeIcons.filter(
        (icon) =>
          icon.name.toLowerCase().includes(q) ||
          icon.className.toLowerCase().includes(q) ||
          icon.label.toLowerCase().includes(q),
      );

  state.faIconPage = 1;
  renderFaIconGrid();
}

async function openFaIconPicker() {
  const modal = document.getElementById("fa-icon-picker-modal");
  const loadingEl = document.getElementById("fa-picker-loading");
  const searchEl = document.getElementById("fa-icon-search");
  if (!modal) return;

  state.faIconPickerOpen = true;
  modal.classList.add("visible");
  if (loadingEl) loadingEl.hidden = false;

  const loadedFromMetadata = await loadFreeFaIcons();
  if (!loadedFromMetadata) {
    showToast(
      "fa-solid fa-circle-info",
      "Χωρίς internet: Έγινε φόρτωση βασικών icons",
    );
  }

  if (loadingEl) loadingEl.hidden = true;
  if (searchEl) {
    searchEl.value = "";
    searchEl.focus();
  }
  applyFaIconFilter("");
}

function closeFaIconPicker() {
  const modal = document.getElementById("fa-icon-picker-modal");
  if (!modal) return;
  modal.classList.remove("visible");
  state.faIconPickerOpen = false;
}

// ---- SVG ICONS ----
const icons = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  piggy:
    '<svg viewBox="0 0 24 24"><path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-3.5c1.3-1.2 2-2.7 2-4.5 0-2-1-3-1-3s1-1.5 1-3.5c0-.6-.5-1.5-1-1.5z" stroke-linecap="round" stroke-linejoin="round"/><circle cx="14" cy="10" r="0.5" fill="currentColor" stroke="none"/></svg>',
  users:
    '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search:
    '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" stroke-linecap="round"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  download:
    '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  creditCard:
    '<svg viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/></svg>',
  x: '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  check:
    '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  delete:
    '<svg viewBox="0 0 24 24"><path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" stroke-linecap="round" stroke-linejoin="round"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevDown:
    '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrowUp:
    '<svg viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrowDown:
    '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  wallet:
    '<svg viewBox="0 0 24 24"><path d="M21 12V7H5a2 2 0 010-4h14v4" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 5v14a2 2 0 002 2h16v-5" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 12a2 2 0 100 4h4v-4h-4z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

// ---- TIME ----
function updateTime() {
  const now = new Date();
  const el = document.getElementById("status-time");
  if (el)
    el.textContent = now.toLocaleTimeString("el-GR", {
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    });
}

// ---- NAVIGATION ----
function switchView(viewId) {
  if (viewId === state.currentView) return;
  const oldView = document.querySelector(".view.active");
  const newView = document.getElementById(viewId);
  if (!oldView || !newView) return;

  const tabs = ["home", "transactions", "savings", "debts"];
  const oldIdx = tabs.indexOf(state.currentView);
  const newIdx = tabs.indexOf(viewId);

  oldView.classList.remove("active");
  if (newIdx > oldIdx) oldView.classList.add("exit-left");

  setTimeout(() => {
    oldView.classList.remove("exit-left");
    oldView.style.transform = "";
  }, 300);

  newView.classList.add("active");
  state.currentView = viewId;

  document
    .querySelectorAll(".tab-item")
    .forEach((t) => t.classList.remove("active"));
  const tabEl = document.querySelector(`[data-tab="${viewId}"]`);
  if (tabEl) tabEl.classList.add("active");

  if (viewId === "savings") _savingsReplay = true;
  renderView(viewId);
  setupAnimateIn(newView);
}

function renderView(viewId) {
  switch (viewId) {
    case "home":
      renderHome();
      break;
    case "transactions":
      renderTransactions();
      break;
    case "savings":
      renderSavings();
      break;
    case "debts":
      renderNetwork();
      break;
  }
}

// ---- AI INSIGHTS ----

/**
 * Toggles the forecast card between collapsed and expanded states.
 */
function toggleForecastCard() {
  const card = document.getElementById("ai-forecast-card");
  if (card) card.classList.toggle("collapsed");
}

/**
 * Shows the hidden tips (called when user taps "Δείτε περισσότερα").
 */
function showMoreTips() {
  const btn = document.getElementById("ai-tips-more-btn");
  document
    .querySelectorAll("#ai-tips-list .ai-tip-card.ai-tip-hidden")
    .forEach((el, i) => {
      el.classList.remove("ai-tip-hidden");
      el.style.animationDelay = `${i * 80}ms`;
    });
  if (btn) btn.remove();
}

/**
 * Routes a tip action button to the correct in-app screen or feature.
 * @param {string} type - One of: 'view_spending', 'view_debts', 'view_savings', 'set_limit'
 */
function handleTipAction(type) {
  switch (type) {
    case "view_spending":
      switchView("transactions");
      break;
    case "view_debts":
      switchView("debts");
      break;
    case "view_savings":
      switchView("savings");
      break;
    case "set_limit":
      showToast("fa-solid fa-circle-info", "Δυνατότητα σύντομα διαθέσιμη");
      break;
  }
}

// ---- AI FUNCTIONS (mock implementations — replace bodies with real API calls) ----

/**
 * Returns a 7-day balance forecast based on the user's financial data.
 *
 * PROMPT TO SEND TO AI:
 * ──────────────────────────────────────────────────────────────
 * You are a personal finance assistant for students.
 * Analyze the user's financial data and predict their balance for the next 7 days.
 *
 * User data (JSON): {{ userData }}
 *
 * Return ONLY valid JSON (no markdown) with this exact shape:
 * {
 *   "balances": [number, number, number, number, number, number, number],
 *   "events": [
 *     { "day": 0-6, "label": "<short Greek label>", "type": "warn"|"income"|"expense" }
 *   ],
 *   "insight": "<one sentence in Greek, max 90 chars, personal and specific>"
 * }
 *
 * Rules:
 * - balances[0] = today's starting balance (before daily spend)
 * - Use each pending payment's dueDate to apply it on the correct day offset
 * - Estimate daily spend from the average of recent expense transactions
 * - Flag days where balance drops below 10€ as { type: "warn" }
 * - Flag days with incoming payments as { type: "income" }
 * - insight must be in Greek, feel personal, mention real amounts from the data
 * ──────────────────────────────────────────────────────────────
 *
 * @param {object} userData - Full user financial profile from the API
 * @returns {{ balances: number[], events: Array, insight: string }}
 */
function getAIForecast(userData) {
  // TODO: Replace with real AI API call:
  // const res = await fetch('/api/ai/forecast', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
  //   body: JSON.stringify({ userData }),
  // });
  // return res.json();

  // --- MOCK: derive forecast from user data ---
  const balance = userData.balance ?? 0;

  // Estimate average daily spend from recent expense transactions
  const recentExpenses = (userData.transactions || [])
    .filter((t) => t.type === "expense")
    .slice(0, 14);
  const dailySpend = recentExpenses.length
    ? Math.round(
        (recentExpenses.reduce((s, t) => s + t.amount, 0) /
          Math.max(recentExpenses.length, 1)) *
          10,
      ) / 10
    : 3;

  const now = new Date();
  const balances = [];
  let bal = balance;

  for (let i = 0; i < 7; i++) {
    // Apply incoming payments due on this offset day
    (userData.payments || [])
      .filter(
        (p) => p.type === "incoming" && p.status === "pending" && p.dueDate,
      )
      .forEach((p) => {
        const offset = Math.round((new Date(p.dueDate) - now) / 86400000);
        if (offset === i) bal += p.amount;
      });
    // Apply outgoing payments due on this offset day
    (userData.payments || [])
      .filter(
        (p) => p.type === "outgoing" && p.status === "pending" && p.dueDate,
      )
      .forEach((p) => {
        const offset = Math.round((new Date(p.dueDate) - now) / 86400000);
        if (offset === i) bal -= p.amount;
      });
    bal -= dailySpend;
    balances.push(Math.round(bal * 100) / 100);
  }
  // Prepend starting balance as day-0, keep 7 total points
  balances.unshift(balance);
  balances.length = 7;

  // Build event markers for the chart
  const events = [];
  if (balance < 10) {
    events.push({ day: 0, label: "Χαμηλό υπόλοιπο σήμερα", type: "warn" });
  }
  (userData.payments || [])
    .filter((p) => p.type === "incoming" && p.status === "pending" && p.dueDate)
    .forEach((p) => {
      const offset = Math.round((new Date(p.dueDate) - now) / 86400000);
      if (offset >= 0 && offset < 7) {
        events.push({
          day: offset,
          label: `Πληρωμή +${p.amount}€ (${p.name})`,
          type: "income",
        });
      }
    });

  // One-line insight
  const hasIncoming = events.some((e) => e.type === "income");
  let insight;
  if (balance < 10 && hasIncoming) {
    insight =
      "Είσαι χαμηλά σήμερα, αλλά θα ανακάμψεις μετά την επερχόμενη πληρωμή σου.";
  } else if (balance < 10) {
    insight =
      "Προσοχή — το υπόλοιπό σου είναι χαμηλό. Απόφυγε μη απαραίτητες αγορές.";
  } else {
    insight = "Το υπόλοιπό σου φαίνεται σταθερό για τις επόμενες 7 ημέρες.";
  }

  return { balances, events, insight };
}

/**
 * Returns 2–3 personalised coaching tips based on the user's financial data.
 *
 * PROMPT TO SEND TO AI:
 * ──────────────────────────────────────────────────────────────
 * You are a personal finance coach for students.
 * Given the user's data, generate 2 to 3 short, actionable tips.
 *
 * User data (JSON): {{ userData }}
 *
 * Return ONLY valid JSON array (no markdown):
 * [
 *   {
 *     "icon": "⚠️" | "💡" | "🎯" | "📉" | "💰",
 *     "accent": "orange" | "blue" | "green" | "red",
 *     "title": "<max 4 words, in Greek>",
 *     "body": "<1 sentence, max 65 chars, in Greek, mention specific amounts or categories>",
 *     "action": {
 *       "label": "<1–3 words in Greek>",
 *       "type": "view_spending" | "view_debts" | "view_savings" | "set_limit"
 *     }
 *   }
 * ]
 *
 * Rules:
 * - Max 3 tips. Min 1 tip.
 * - First tip = most urgent (low balance > debt > spending pattern > savings)
 * - Always reference real numbers or categories from the user data
 * - All text must be in Greek
 * - Do NOT give generic advice — tie every tip to something specific in the data
 * ──────────────────────────────────────────────────────────────
 *
 * @param {object} userData - Full user financial profile from the API
 * @returns {Array<{ icon, accent, title, body, action: { label, type } }>}
 */
function getAITips(userData) {
  // TODO: Replace with real AI API call:
  // const res = await fetch('/api/ai/tips', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAuthToken()}` },
  //   body: JSON.stringify({ userData }),
  // });
  // return res.json();

  // --- MOCK: derive tips from user data ---
  const balance = userData.balance ?? 0;
  const debts = (userData.debts || []).filter((d) => d.type === "owe");
  const transactions = userData.transactions || [];
  const incoming = (userData.payments || []).filter(
    (p) => p.type === "incoming" && p.status === "pending",
  );

  const tips = [];

  // Tip 1 — Low balance warning
  if (balance < 10) {
    tips.push({
      icon: "⚠️",
      accent: "orange",
      title: "Χαμηλό υπόλοιπο",
      body: `Έχεις μόνο ${balance.toFixed(2)}€ — απόφυγε αγορές σήμερα.`,
      action: { label: "Ορισμός ορίου", type: "set_limit" },
    });
  }

  // Tip 2 — Frequent small spending pattern
  const smallSpends = transactions.filter(
    (t) => t.type === "expense" && t.amount <= 5,
  );
  if (smallSpends.length >= 2) {
    const cats = [...new Set(smallSpends.map((t) => t.category))].slice(0, 2);
    const catNames = cats
      .map((c) => getCategoryInfo(c).name.toLowerCase())
      .join(" & ");
    tips.push({
      icon: "💡",
      accent: "blue",
      title: "Μικρές συχνές δαπάνες",
      body: `Ξοδεύεις συχνά σε μικρά ποσά (${catNames}). Πρόσεχε τις συνήθειες σου.`,
      action: { label: "Δες συναλλαγές", type: "view_spending" },
    });
  }

  // Tip 3 — Debt repayment opportunity
  const totalDebt = debts.reduce((s, d) => s + d.amount, 0);
  const totalIncoming = incoming.reduce((s, p) => s + p.amount, 0);
  if (totalDebt > 0 && balance + totalIncoming >= totalDebt) {
    const debtPerson = debts[0]?.name ?? "";
    tips.push({
      icon: "🎯",
      accent: "green",
      title: "Αποπλήρωσε το χρέος",
      body: `Μπορείς να αποπληρώσεις τα ${totalDebt}€ που χρωστάς${debtPerson ? ` στον ${debtPerson}` : ""} μετά την πληρωμή.`,
      action: { label: "Δες χρέη", type: "view_debts" },
    });
  }

  // Fallback tip
  if (tips.length === 0) {
    tips.push({
      icon: "💰",
      accent: "green",
      title: "Καλή πορεία!",
      body: "Συνέχισε έτσι — το υπόλοιπό σου είναι σε καλό επίπεδο.",
      action: { label: "Δες αποταμίευση", type: "view_savings" },
    });
  }

  return tips;
}

// ---- RENDER FUNCTION ----

async function renderAIInsights() {
  // Build user data object from current state for the AI functions
  const userData = {
    balance: state.balance,
    savings: state.savings,
    transactions: state.transactions,
    goals: state.savingsGoals,
    debts: state.debts,
    payments: state.payments,
  };

  // Fetch AI tips from backend
  let forecastData = null;
  let tipsData = null;
  try {
    const aiTips = await apiPost("/aiTips");
    if (Array.isArray(aiTips)) {
      const forecasts = aiTips.filter((t) => t.type === "forecast");
      const tips = aiTips.filter((t) => t.type === "tips");
      if (forecasts.length) forecastData = forecasts[forecasts.length - 1];
      if (tips.length) tipsData = tips[tips.length - 1];
    }
  } catch (_) {
    /* fall back to mock data */
  }

  // --- Forecast ---
  const { balances, events, insight } = forecastData ?? getAIForecast(userData);

  // Normalize + dedupe events so the UI does not render duplicate pills/markers.
  const uniqueEvents = (Array.isArray(events) ? events : []).reduce(
    (acc, ev) => {
      const day = Number(ev?.day);
      const label = String(ev?.label || "").trim();
      const type = String(ev?.type || "warn").trim();

      if (!Number.isInteger(day) || day < 0 || day >= balances.length || !label)
        return acc;

      const key = `${day}|${type.toLowerCase()}|${label.toLowerCase()}`;
      if (acc.seen.has(key)) return acc;

      acc.seen.add(key);
      acc.items.push({ day, type, label });
      return acc;
    },
    { seen: new Set(), items: [] },
  ).items;

  // Pills should show unique messages only, even if repeated across multiple days.
  const uniquePillEvents = uniqueEvents.reduce(
    (acc, ev) => {
      const key = `${String(ev.type || "").toLowerCase()}|${String(ev.label || "").toLowerCase()}`;
      if (acc.seen.has(key)) return acc;
      acc.seen.add(key);
      acc.items.push(ev);
      return acc;
    },
    { seen: new Set(), items: [] },
  ).items;

  // Render SVG chart
  const chartEl = document.getElementById("ai-forecast-chart");
  if (chartEl) {
    const W = 300,
      H = 72,
      pX = 6,
      pY = 8;
    const min = Math.min(...balances);
    const max = Math.max(...balances);
    const range = max - min || 1;
    const n = balances.length;

    const pts = balances.map((v, i) => [
      pX + (i / (n - 1)) * (W - pX * 2),
      pY + (1 - (v - min) / range) * (H - pY * 2),
    ]);

    const polyLine = pts.map((p) => p.join(",")).join(" ");
    const areaPath = `${pts[0][0]},${H} ${polyLine} ${pts[n - 1][0]},${H}`;

    const today = new Date();
    const dayLabels = balances.map((_, i) => {
      if (i === 0) return "Σήμερα";
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      return d.toLocaleDateString("el-GR", { weekday: "narrow" });
    });

    const dots = pts
      .map(([x, y], i) => {
        const ev = uniqueEvents.find((e) => e.day === i);
        if (!ev) return "";
        const fill = ev.type === "income" ? "#30D158" : "#FF9500";
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${fill}" stroke="#1B1B1D" stroke-width="2"/>`;
      })
      .join("");

    const labels = pts
      .map(
        ([x], i) =>
          `<text x="${x.toFixed(1)}" y="${H + 14}" font-size="8.5" fill="#7B7B85" text-anchor="middle" font-family="Inter,sans-serif">${dayLabels[i]}</text>`,
      )
      .join("");

    const valueTips = pts
      .map(([x, y], i) => {
        const ev = uniqueEvents.find((e) => e.day === i);
        if (!ev) return "";
        const col = ev.type === "income" ? "#30D158" : "#FF9500";
        return `<text x="${x.toFixed(1)}" y="${(y - 8).toFixed(1)}" font-size="8" fill="${col}" text-anchor="middle" font-weight="600" font-family="Inter,sans-serif">${balances[i]}€</text>`;
      })
      .join("");

    chartEl.innerHTML = `
      <svg viewBox="0 0 ${W} ${H + 20}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block;overflow:visible;padding:20px;">
        <defs>
          <linearGradient id="fcGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#007AFF" stop-opacity="0.22"/>
            <stop offset="100%" stop-color="#007AFF" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <polygon points="${areaPath}" fill="url(#fcGrad)"/>
        <polyline points="${polyLine}" fill="none" stroke="#007AFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        ${valueTips}
        ${dots}
        ${labels}
      </svg>`;
  }

  // Render event pills
  const eventsEl = document.getElementById("ai-forecast-events");
  if (eventsEl) {
    eventsEl.innerHTML = uniquePillEvents
      .map(
        (ev) => `
      <div class="ai-event-pill ${ev.type}">
        <span class="ai-event-dot"></span>
        <span>${ev.label}</span>
      </div>`,
      )
      .join("");
  }

  // Render footer (final balance + insight)
  const footerEl = document.getElementById("ai-forecast-footer");
  if (footerEl) {
    const finalBal = balances[balances.length - 1];
    footerEl.innerHTML = `
      <div class="ai-forecast-final-row">
        <span class="ai-forecast-final-label">Σε 7 ημέρες</span>
        <span class="ai-forecast-final-value">${finalBal.toFixed(2)}€</span>
      </div>
      <div class="ai-forecast-insight">${insight}</div>`;
  }

  // --- Smart tips ---
  const tipsEl = document.getElementById("ai-tips-list");
  if (!tipsEl) return;

  const tips = tipsData?.tips ?? getAITips(userData);

  const tipHTML = tips
    .map(
      (t, i) => `
    <div class="ai-tip-card ai-tip-${t.accent}${i > 0 ? " ai-tip-hidden" : ""}">
      <div class="ai-tip-top">
        <span class="ai-tip-icon">${t.icon}</span>
        <span class="ai-tip-title">${t.title}</span>
      </div>
      <p class="ai-tip-body">${t.body}</p>
      <button class="ai-tip-action" onclick="handleTipAction('${t.action.type}')">${t.action.label}</button>
    </div>`,
    )
    .join("");

  const moreBtnHTML =
    tips.length > 1
      ? `<button class="ai-tips-more-btn" id="ai-tips-more-btn" onclick="showMoreTips()">
        Δείτε περισσότερα
        <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M6 9l6 6 6-6"/></svg>
       </button>`
      : "";

  tipsEl.innerHTML = tipHTML + moreBtnHTML;
}

// ---- HOME VIEW ----
function renderHome() {
  updateTime();
  renderGreeting();
  renderWeekCalendar();
  renderPeopleRow();
  renderBalanceCard();
  renderAIInsights();
  renderFlowCard();
  renderQuickActions();
  renderStats();
  renderActivityChart(activityRange);
  renderRecentTransactions();
}

function renderGreeting() {
  const el = document.getElementById("greeting-text");
  if (el) {
    const h = new Date().getHours();
    const timeGreeting =
      h < 5
        ? "Καλό βράδυ"
        : h < 12
          ? "Καλημέρα"
          : h < 18
            ? "Καλησπέρα"
            : "Καλό βράδυ";
    el.textContent = `${timeGreeting}, ${state.user.name}`;
  }

  const dateEl = document.getElementById("date-label");
  if (dateEl) {
    const selected = new Date(state.selectedDate);
    dateEl.innerHTML =
      selected.toLocaleDateString("el-GR", {
        month: "short",
        day: "numeric",
        weekday: "short",
      }) + ` ${icons.chevDown}`;
  }
}

function renderWeekCalendar() {
  const container = document.getElementById("week-days");
  if (!container) return;

  const today = startOfDay(new Date());
  const selected = startOfDay(new Date(state.selectedDate));
  const dayRangeBefore = 90;
  const dayRangeAfter = 90;
  const start = addDaysToDate(today, -dayRangeBefore);
  let html = "";

  for (let i = 0; i <= dayRangeBefore + dayRangeAfter; i++) {
    const d = addDaysToDate(start, i);
    const isToday = sameDay(d, today);
    const isSelected = sameDay(d, selected);
    const dayName = d.toLocaleDateString("el-GR", { weekday: "narrow" });

    html += `
      <div class="week-day ${isSelected ? "selected" : ""} ${isToday ? "today" : ""}" data-date-key="${toDayKey(d)}">
        <span class="day-name">${dayName}</span>
        <span class="day-num">${d.getDate()}</span>
      </div>`;
  }

  container.innerHTML = html;

  const centerSelected = (behavior = "auto") => {
    const active =
      container.querySelector(".week-day.selected") ||
      container.querySelector(".week-day.today");
    if (!active) return;

    const left =
      active.offsetLeft - (container.clientWidth - active.offsetWidth) / 2;
    container.scrollTo({ left: Math.max(0, left), behavior });
  };

  container.querySelectorAll(".week-day").forEach((el) => {
    el.addEventListener("click", () => {
      const key = el.dataset.dateKey;
      if (!key) return;
      state.selectedDate = fromDayKey(key);
      renderWeekCalendar();
      renderGreeting();
      renderRecentTransactions();
      centerSelected("smooth");
    });
  });

  requestAnimationFrame(() => centerSelected("auto"));
}

function renderPeopleRow() {
  const container = document.getElementById("people-scroll");
  if (!container) return;

  const people = state.debts.slice(0, 3);
  let html = "";

  people.forEach((p) => {
    html += `
      <div class="person-chip" data-id="${p.id}">
        <div class="avatar" style="background: ${p.color}">${p.initial}</div>
        <span>${p.name.split(" ")[0]}</span>
      </div>`;
  });

  if (state.debts.length > 3) {
    html += `
      <div class="people-more" onclick="switchView('debts')">
        <span>+${state.debts.length - 3}</span>
        <div class="avatar-stack">
          ${state.debts
            .slice(3, 6)
            .map(
              (p) =>
                `<div class="avatar" style="background:${p.color}">${p.initial}</div>`,
            )
            .join("")}
        </div>
      </div>`;
  }

  container.innerHTML = html;
}

let _prevBalance = null;

function renderBalanceCard() {
  const amountEl = document.getElementById("balance-amount");
  if (amountEl) {
    // Animate on change
    if (_prevBalance !== null && _prevBalance !== state.balance) {
      amountEl.classList.remove("balance-animating");
      void amountEl.offsetWidth; // force reflow
      amountEl.classList.add("balance-animating");
      amountEl.addEventListener(
        "animationend",
        () => amountEl.classList.remove("balance-animating"),
        { once: true },
      );
    }
    amountEl.textContent = formatCurrency(state.balance);
    _prevBalance = state.balance;
  }

  // Mini income / expense stats
  const { income, expenses } = getMonthTotals();
  const incomeEl = document.getElementById("balance-income");
  const expenseEl = document.getElementById("balance-expense");
  if (incomeEl) incomeEl.textContent = `+${formatCurrency(income)}€`;
  if (expenseEl) expenseEl.textContent = `-${formatCurrency(expenses)}€`;

  renderAccountsRow();
}

function renderAccountsRow() {
  const mainEl = document.getElementById("acc-main-amount");
  const savEl = document.getElementById("acc-savings-amount");
  if (mainEl) mainEl.textContent = `€${formatCurrency(state.balance)}`;
  if (savEl) savEl.textContent = `€${formatCurrency(state.savings)}`;
}

// ---- ACTIVITY CHART (7 / 15 / 30 day view) ----
let activityRange = 7;

function computeActivityData(range) {
  const now = new Date();
  const days = [];
  for (let i = range - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d);
  }

  const dayValue = (d) =>
    state.transactions
      .filter((t) => sameDay(new Date(t.date), d) && t.type === "expense")
      .reduce((s, t) => s + t.amount, 0);

  const values = days.map(dayValue);
  const total = values.reduce((s, v) => s + v, 0);

  const prevStart = new Date(now);
  prevStart.setDate(prevStart.getDate() - (range * 2 - 1));
  prevStart.setHours(0, 0, 0, 0);
  const prevEnd = new Date(now);
  prevEnd.setDate(prevEnd.getDate() - range);
  prevEnd.setHours(23, 59, 59, 999);

  const prevTotal = state.transactions
    .filter((t) => {
      const d = new Date(t.date);
      return d >= prevStart && d <= prevEnd;
    })
    .reduce((s, t) => s + t.amount, 0);

  const change =
    prevTotal > 0
      ? ((total - prevTotal) / prevTotal) * 100
      : total > 0
        ? 100
        : 0;

  return { days, values, total, change };
}

function renderActivityChart(range) {
  activityRange = range || activityRange || 7;

  const chartEl = document.getElementById("activity-chart");
  if (!chartEl) return;

  const totalEl = document.getElementById("activity-total");
  const changeEl = document.getElementById("activity-change");
  const labelsEl = document.getElementById("activity-chart-labels");

  const { days, values, total, change } = computeActivityData(activityRange);
  const max = Math.max(...values, 1);
  const peakValue = Math.max(...values);
  const peakIdx = values.indexOf(peakValue);

  chartEl.innerHTML = values
    .map((v, i) => {
      const h = Math.max(4, Math.round((v / max) * 100));
      const isPeak = i === peakIdx && peakValue > 0;
      return `<div class="activity-bar-wrap">
      ${isPeak ? `<div class="activity-bar-peak">€${formatCurrency(v)}</div>` : ""}
      <div class="activity-bar ${isPeak ? "peak" : ""}" style="height:${h}%"></div>
    </div>`;
    })
    .join("");

  if (labelsEl) {
    const labelCount = Math.min(6, days.length);
    const step = Math.max(1, Math.round(days.length / labelCount));
    labelsEl.innerHTML = days
      .map((d, i) => {
        const showLabel = i % step === 0 || i === days.length - 1;
        if (!showLabel) return "<span></span>";
        const label =
          activityRange <= 15
            ? d.toLocaleDateString("el-GR", { weekday: "short" })
            : d.toLocaleDateString("el-GR", { day: "numeric", month: "short" });
        return `<span>${label}</span>`;
      })
      .join("");
  }

  if (totalEl) totalEl.textContent = `€${formatCurrency(total)}`;
  if (changeEl) {
    const positive = change >= 0;
    changeEl.className = `activity-change ${positive ? "positive" : "negative"}`;
    changeEl.innerHTML = `${positive ? "↑" : "↓"} ${Math.abs(change).toFixed(0)}% σε σχέση με πριν`;
  }
}

function getMonthTotals() {
  const now = new Date();
  const monthTx = state.transactions.filter((t) => {
    const d = new Date(t.date);
    return (
      d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    );
  });
  const income = monthTx
    .filter((t) => t.type === "income")
    .reduce((s, t) => s + t.amount, 0);
  const expenses = monthTx
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + t.amount, 0);
  return { income, expenses };
}

function renderFlowCard() {
  const { income, expenses } = getMonthTotals();
  const net = income - expenses;
  const total = income + expenses;
  const incomePct = total > 0 ? (income / total) * 100 : 0;
  const expensePct = total > 0 ? (expenses / total) * 100 : 0;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set("flow-income-amount", `+${formatCurrency(income)}€`);
  set("flow-expense-amount", `-${formatCurrency(expenses)}€`);
  set("flow-period", new Date().toLocaleDateString("el-GR", { month: "long" }));

  const netEl = document.getElementById("flow-net-value");
  if (netEl) {
    netEl.textContent = `${net >= 0 ? "+" : "-"}${formatCurrency(Math.abs(net))}€`;
    netEl.className = `flow-net-value ${net >= 0 ? "positive" : "negative"}`;
  }

  // Bars animate in after paint
  requestAnimationFrame(() => {
    const ib = document.getElementById("flow-income-bar");
    const eb = document.getElementById("flow-expense-bar");
    if (ib) ib.style.width = `${incomePct}%`;
    if (eb) eb.style.width = `${expensePct}%`;
  });
}

function renderQuickActions() {
  // Static — already in HTML
}

function renderStats() {
  const now = new Date();
  const monthTx = state.transactions.filter((t) => {
    const d = new Date(t.date);
    return (
      d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    );
  });

  const income = monthTx
    .filter((t) => t.type === "income")
    .reduce((s, t) => s + t.amount, 0);
  const expenses = monthTx
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + t.amount, 0);
  const net = income - expenses;
  const savingsRate = income > 0 ? (state.savings / income) * 100 : 0;

  const el = document.getElementById("stat-earnings");
  if (el) el.textContent = `+${((income / (income || 1)) * 23.78).toFixed(2)}%`;

  const savEl = document.getElementById("stat-savings");
  if (savEl) savEl.textContent = `+${savingsRate.toFixed(2)}%`;

  const invEl = document.getElementById("stat-investment");
  if (invEl)
    invEl.textContent = `+${(net > 0 ? (net / income) * 100 : 0).toFixed(2)}%`;

  renderMiniChart();
}

function renderMiniChart() {
  const container = document.getElementById("mini-chart");
  if (!container) return;

  const now = new Date();
  let html = "";
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayTx = state.transactions.filter(
      (t) => new Date(t.date).toDateString() === d.toDateString(),
    );
    const total = dayTx
      .filter((t) => t.type === "expense")
      .reduce((s, t) => s + t.amount, 0);
    const h = Math.max(8, Math.min(100, (total / 80) * 100));
    html += `<div class="bar ${i === 0 ? "accent" : ""}" style="height:${h}%;animation-delay:${(6 - i) * 50}ms"></div>`;
  }
  container.innerHTML = html;
}

function renderRecentTransactions() {
  const container = document.getElementById("recent-transactions");
  const titleEl = document.getElementById("recent-title");
  if (!container) return;

  const selectedDate = startOfDay(new Date(state.selectedDate));
  const today = startOfDay(new Date());
  const isTodaySelected = sameDay(selectedDate, today);
  const selectedLabel = selectedDate.toLocaleDateString("el-GR", {
    day: "numeric",
    month: "long",
  });

  if (titleEl) {
    titleEl.textContent = isTodaySelected
      ? "Πρόσφατα"
      : `Συναλλαγές ${selectedLabel}`;
  }

  const sourceTx = isTodaySelected
    ? state.transactions
    : state.transactions.filter((t) => sameDay(new Date(t.date), selectedDate));

  // Pending payments: on "today" view show all pending; on a specific date show payments due that day
  const sourcePay = isTodaySelected
    ? state.payments.filter((p) => p.status === "pending")
    : state.payments.filter(
        (p) =>
          p.status === "pending" &&
          p.dueDate &&
          sameDay(new Date(p.dueDate), selectedDate),
      );

  // Tag items so we know which renderer to use, then sort together
  const tagged = [
    ...sourceTx.map((t) => ({
      _item: t,
      _kind: "tx",
      _date: new Date(t.date),
    })),
    ...sourcePay.map((p) => ({
      _item: p,
      _kind: "pay",
      _date: p.dueDate ? new Date(p.dueDate) : new Date(),
    })),
  ];

  // Overdue payments first, then sort everything by effective date descending
  const now = new Date();
  tagged.sort((a, b) => {
    const aOverdue = a._kind === "pay" && a._date < now;
    const bOverdue = b._kind === "pay" && b._date < now;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    return b._date - a._date;
  });

  if (tagged.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${renderFaIcon("fa-solid fa-receipt", "fa-solid fa-receipt")}</div>
        <p>${isTodaySelected ? "Δεν υπάρχουν συναλλαγές" : "Δεν υπάρχουν συναλλαγές για αυτή την ημέρα"}</p>
      </div>`;
    return;
  }

  const slice = tagged.slice(0, 5);
  container.innerHTML = slice
    .map(({ _item, _kind }) =>
      _kind === "pay"
        ? futurePaymentItemHTML(_item)
        : transactionItemHTML(_item),
    )
    .join("");
}

function transactionItemHTML(t) {
  const cat = getCategoryInfo(t.category);
  const isExpense = t.type === "expense";
  const sign = isExpense ? "-" : "+";
  const cls = isExpense ? "expense" : "income";

  const iconHTML = t.peerPfp
    ? `<div class="transaction-icon tx-peer-icon"><img src="${escapeHtml(t.peerPfp)}" alt="" onerror="this.parentElement.innerHTML='<i class=\\'fa-solid fa-user\\'></i>'"></div>`
    : `<div class="transaction-icon" style="background:${cat.bg}">${renderFaIcon(cat.icon, "fa-solid fa-tag")}</div>`;

  return `
    <div class="transaction-item" data-id="${t.id}" onclick="toggleTransactionDetail(${t.id})">

      <!-- ── Main row ── -->
      <div class="transaction-main">
        ${iconHTML}
        <div class="transaction-info">
          <div class="name">${t.name}</div>
          <div class="category">${t.peerPfp ? (isExpense ? "Αποστολή" : "Εισαγωγή") : cat.name} · ${formatDate(t.date)}</div>
        </div>
        <div class="transaction-amount">
          <div class="amount ${cls}">${sign}${formatCurrency(t.amount)}€</div>
          <div class="time">${formatTime(t.date)}</div>
        </div>
        <div class="transaction-chevron">
          <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </div>

      <!-- ── Inline detail panel ── -->
      <div class="transaction-detail-panel">
        <div class="panel-inner">
          <div class="panel-body">
            <div class="detail-field">
              <span class="detail-key">Ποσό</span>
              <span class="detail-val ${cls}">${sign}${formatCurrency(t.amount)}€</span>
            </div>
            <div class="detail-field">
              <span class="detail-key">Ημ/νία &amp; Ώρα</span>
              <span class="detail-val">${formatDate(t.date)} · ${formatTime(t.date)}</span>
            </div>
            <div class="detail-field">
              <span class="detail-key">Κατηγορία</span>
              <span class="detail-val">${renderFaIcon(cat.icon, "fa-solid fa-tag", "category-inline-icon")} ${cat.name}</span>
            </div>
            <div class="detail-field">
              <span class="detail-key">Τύπος</span>
              <span class="detail-val">${isExpense ? "Έξοδο" : "Εισόδημα"}</span>
            </div>
            ${
              t.note
                ? `<div class="detail-field">
              <span class="detail-key">Σημείωση</span>
              <span class="detail-val">${t.note}</span>
            </div>`
                : ""
            }
            <div class="panel-actions">
              <button class="panel-delete-btn"
                onclick="event.stopPropagation(); deleteTransaction(${t.id})">
                <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                </svg>
                Διαγραφή
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>`;
}

function toggleTransactionDetail(id) {
  document.querySelectorAll(".transaction-item[data-id]").forEach((el) => {
    if (parseInt(el.dataset.id) === id) {
      el.classList.toggle("expanded");
    } else {
      el.classList.remove("expanded");
    }
  });
}

// ---- FUTURE PAYMENT ITEMS ----
function futurePaymentItemHTML(p) {
  const isIncoming = p.type === "incoming";
  const cat = getCategoryInfo(p.category);
  const sign = isIncoming ? "+" : "-";
  const cls = isIncoming ? "income" : "expense";
  const now = new Date();
  const overdue = p.dueDate && new Date(p.dueDate) < now;
  const dueDateLabel = p.dueDate
    ? new Date(p.dueDate).toLocaleDateString("el-GR", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Χωρίς λήξη";

  return `
    <div class="transaction-item fp-item fp-${isIncoming ? "incoming" : "outgoing"}${overdue ? " fp-overdue" : ""}"
         data-pid="${p.id}" onclick="toggleFuturePaymentDetail(${p.id})">

      <!-- ── Main row ── -->
      <div class="transaction-main">
        <div class="transaction-icon fp-icon-wrap" style="background:${cat.bg}">
          ${renderFaIcon(cat.icon, "fa-solid fa-tag")}
          <div class="fp-clock-badge">
            <i class="fa-solid fa-clock" aria-hidden="true"></i>
          </div>
        </div>
        <div class="transaction-info">
          <div class="name">${p.name}</div>
          <div class="category fp-due ${overdue ? "fp-overdue-label" : ""}">
            ${overdue ? '<i class="fa-solid fa-circle-exclamation fp-warn-icon"></i>' : ""}
            Λήξη: ${dueDateLabel}
          </div>
        </div>
        <div class="transaction-amount">
          <div class="amount ${cls} fp-amount-dim">${sign}${formatCurrency(p.amount)}€</div>
          <div class="fp-pending-pill ${isIncoming ? "fp-pill-in" : "fp-pill-out"}">
            ${isIncoming ? "Εισερχόμενο" : "Εξερχόμενο"}
          </div>
        </div>
        <div class="transaction-chevron">
          <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </div>

      <!-- ── Inline detail panel ── -->
      <div class="transaction-detail-panel">
        <div class="panel-inner">
          <div class="panel-body">
            <div class="detail-field">
              <span class="detail-key">Ποσό</span>
              <span class="detail-val ${cls}">${sign}${formatCurrency(p.amount)}€</span>
            </div>
            <div class="detail-field">
              <span class="detail-key">Ημερομηνία Λήξης</span>
              <span class="detail-val ${overdue ? "fp-overdue-label" : ""}">${dueDateLabel}${overdue ? " · Εκπρόθεσμο" : ""}</span>
            </div>
            <div class="detail-field">
              <span class="detail-key">Κατηγορία</span>
              <span class="detail-val">${renderFaIcon(cat.icon, "fa-solid fa-tag", "category-inline-icon")} ${cat.name}</span>
            </div>
            <div class="detail-field">
              <span class="detail-key">Τύπος</span>
              <span class="detail-val">${isIncoming ? "Εισερχόμενο" : "Εξερχόμενο"}</span>
            </div>
            ${
              p.note
                ? `<div class="detail-field">
              <span class="detail-key">Σημείωση</span>
              <span class="detail-val">${p.note}</span>
            </div>`
                : ""
            }
            <div class="panel-actions">
              <button class="panel-settle-btn"
                onclick="event.stopPropagation(); settlePaymentInline(${p.id})">
                <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Εξόφληση
              </button>
              <button class="panel-delete-btn"
                onclick="event.stopPropagation(); deletePaymentInline(${p.id})">
                <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                </svg>
                Διαγραφή
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>`;
}

function toggleFuturePaymentDetail(id) {
  document.querySelectorAll(".fp-item[data-pid]").forEach((el) => {
    if (parseInt(el.dataset.pid) === id) {
      el.classList.toggle("expanded");
    } else {
      el.classList.remove("expanded");
    }
  });
}

async function settlePaymentInline(id) {
  const payment = state.payments.find((p) => p.id === id);
  if (!payment) return;
  const data = await apiPost(`/payments/${id}/settle`, {}).catch(() => null);
  if (!data) return;
  const idx = state.payments.findIndex((p) => p.id === id);
  if (idx !== -1) state.payments[idx] = data.payment;
  state.transactions.unshift(data.transaction);
  state.balance = data.balance;
  schedMarkPaymentSeen(id);
  const icon =
    payment.type === "incoming"
      ? "fa-solid fa-circle-arrow-down"
      : "fa-solid fa-circle-arrow-up";
  showToast(
    icon,
    `Εξοφλήθηκε: ${payment.name} — ${payment.type === "incoming" ? "+" : "-"}${formatCurrency(payment.amount)}€`,
  );
  renderView(state.currentView);
  renderBalanceCard();
}

async function deletePaymentInline(id) {
  const payment = state.payments.find((p) => p.id === id);
  if (!payment) return;
  await apiDelete(`/payments/${id}`).catch(() => null);
  state.payments = state.payments.filter((p) => p.id !== id);
  showToast("fa-solid fa-trash", `Διαγράφηκε: ${payment.name}`);
  renderView(state.currentView);
}

// ---- TRANSACTIONS VIEW ----
function renderTransactions() {
  // Core content renders first so it can never be blocked by an issue in the
  // (non-essential) day calendar widget below.
  renderTransactionFilters();
  renderTransactionList();
  renderRecurringEntry();
  renderMonthlyAverage();
  renderTxWeekCalendar();
}

// ---- SPENDING STATISTICS (button on Συναλλαγές + inner stats sheet) ----
const GREEK_MONTHS = [
  "Ιανουάριος",
  "Φεβρουάριος",
  "Μάρτιος",
  "Απρίλιος",
  "Μάιος",
  "Ιούνιος",
  "Ιούλιος",
  "Αύγουστος",
  "Σεπτέμβριος",
  "Οκτώβριος",
  "Νοέμβριος",
  "Δεκέμβριος",
];
// Accusative forms, for phrases like "από τον Αύγουστο"
const GREEK_MONTHS_ACC = [
  "Ιανουάριο",
  "Φεβρουάριο",
  "Μάρτιο",
  "Απρίλιο",
  "Μάιο",
  "Ιούνιο",
  "Ιούλιο",
  "Αύγουστο",
  "Σεπτέμβριο",
  "Οκτώβριο",
  "Νοέμβριο",
  "Δεκέμβριο",
];
const GREEK_WEEKDAYS_SHORT = ["Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ", "Κυρ"];

const statsState = { year: 0, month: 0, day: null, stats: null };

// All figures for one calendar month (expenses only, income kept for balance)
function computeMonthStats(year, month) {
  const now = new Date();
  const isCurrent = year === now.getFullYear() && month === now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Current month: only days that have passed (incl. today)
  const daysCounted = isCurrent ? now.getDate() : daysInMonth;

  const daily = new Array(daysInMonth).fill(0);
  const weekdayTotals = new Array(7).fill(0); // Monday-first
  const cats = {};
  let total = 0;
  let count = 0;
  let income = 0;
  let biggest = null;

  for (const t of state.transactions) {
    const d = new Date(t.date);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const amt = Number(t.amount) || 0;
    if (t.type === "income") {
      income += amt;
      continue;
    }
    if (t.type !== "expense") continue;
    total += amt;
    count++;
    daily[d.getDate() - 1] += amt;
    weekdayTotals[(d.getDay() + 6) % 7] += amt;
    const key = t.category || "other";
    cats[key] = (cats[key] || 0) + amt;
    if (!biggest || amt > biggest.amount) biggest = t;
  }

  // Average per weekday = total / how many of that weekday were counted
  const weekdayOccurrences = new Array(7).fill(0);
  for (let day = 1; day <= daysCounted; day++) {
    weekdayOccurrences[(new Date(year, month, day).getDay() + 6) % 7]++;
  }
  const weekdayAvg = weekdayTotals.map((v, i) =>
    weekdayOccurrences[i] ? v / weekdayOccurrences[i] : 0,
  );

  let peakDay = 0;
  let zeroDays = 0;
  for (let i = 0; i < daysCounted; i++) {
    if (daily[i] === 0) zeroDays++;
    if (daily[i] > (peakDay ? daily[peakDay - 1] : 0)) peakDay = i + 1;
  }

  const categoryList = Object.entries(cats)
    .map(([id, amount]) => ({ id, amount }))
    .sort((x, y) => y.amount - x.amount);

  return {
    year,
    month,
    isCurrent,
    daysInMonth,
    daysCounted,
    daily,
    weekdayAvg,
    categoryList,
    total,
    count,
    income,
    biggest,
    peakDay,
    zeroDays,
    avg: total / daysCounted,
  };
}

// Earliest month with an expense (falls back to the current month)
function getEarliestExpenseMonth() {
  const now = new Date();
  let best = new Date(now.getFullYear(), now.getMonth(), 1);
  for (const t of state.transactions) {
    if (t.type !== "expense") continue;
    const d = new Date(t.date);
    if (isNaN(d)) continue;
    const m = new Date(d.getFullYear(), d.getMonth(), 1);
    if (m < best) best = m;
  }
  return { year: best.getFullYear(), month: best.getMonth() };
}

// Small summary inside the full-width button + live refresh of an open sheet
function renderMonthlyAverage() {
  const el = document.getElementById("month-avg-btn-value");
  if (el) {
    const now = new Date();
    const cur = computeMonthStats(now.getFullYear(), now.getMonth());
    el.textContent = `${formatCurrency(cur.avg)}€ / ημέρα`;
  }
  const overlay = document.getElementById("stats-sheet-overlay");
  if (overlay && overlay.classList.contains("visible")) renderStatsSheet();
}

function openStatsSheet() {
  const overlay = document.getElementById("stats-sheet-overlay");
  if (!overlay) return;
  const now = new Date();
  statsState.year = now.getFullYear();
  statsState.month = now.getMonth();
  statsState.day = null;
  renderStatsSheet();
  const sheet = overlay.querySelector(".stats-sheet");
  if (sheet) sheet.scrollTop = 0;
  overlay.classList.add("visible");
}

function closeStatsSheet() {
  const overlay = document.getElementById("stats-sheet-overlay");
  if (overlay) overlay.classList.remove("visible");
}

function selectStatsMonth(year, month, scrollTop = false) {
  statsState.year = year;
  statsState.month = month;
  statsState.day = null;
  renderStatsSheet();
  if (scrollTop) {
    const sheet = document.querySelector("#stats-sheet-overlay .stats-sheet");
    if (sheet) sheet.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function shiftStatsMonth(delta) {
  const d = new Date(statsState.year, statsState.month + delta, 1);
  const earliest = getEarliestExpenseMonth();
  const now = new Date();
  const earliestDate = new Date(earliest.year, earliest.month, 1);
  const latestDate = new Date(now.getFullYear(), now.getMonth(), 1);
  if (d < earliestDate || d > latestDate) return;
  selectStatsMonth(d.getFullYear(), d.getMonth());
}

// Tap a bar in the daily chart to read that day's spending
function msPickDay(day) {
  const s = statsState.stats;
  if (!s) return;
  statsState.day = day;
  document.querySelectorAll("#stats-content .ms-bar").forEach((b, i) => {
    b.classList.toggle("sel", i === day - 1);
  });
  const el = document.getElementById("ms-readout");
  if (el) el.innerHTML = msReadoutHTML(s, day);
}

function msReadoutHTML(s, day) {
  const date = new Date(s.year, s.month, day);
  const label = date.toLocaleDateString("el-GR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return `<span>${label}</span><strong>${formatCurrency(s.daily[day - 1])}€</strong>`;
}

function renderStatsSheet() {
  const box = document.getElementById("stats-content");
  if (!box) return;

  const s = computeMonthStats(statsState.year, statsState.month);
  statsState.stats = s;

  const now = new Date();
  const earliest = getEarliestExpenseMonth();
  const atEarliest =
    s.year === earliest.year && s.month === earliest.month;
  const atLatest = s.isCurrent;

  // previous calendar month, for comparison
  const prevRef = new Date(s.year, s.month - 1, 1);
  const prev = computeMonthStats(prevRef.getFullYear(), prevRef.getMonth());

  // ---- month picker ----
  let html = `
    <div class="ms-picker">
      <button class="ms-picker-btn" type="button" onclick="shiftStatsMonth(-1)" ${atEarliest ? "disabled" : ""} aria-label="Προηγούμενος μήνας">
        <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>
      </button>
      <div class="ms-picker-label">
        <div class="ms-picker-month">${GREEK_MONTHS[s.month]} ${s.year}</div>
        <div class="ms-picker-tag">${s.isCurrent ? "Τρέχων μήνας" : "&nbsp;"}</div>
      </div>
      <button class="ms-picker-btn" type="button" onclick="shiftStatsMonth(1)" ${atLatest ? "disabled" : ""} aria-label="Επόμενος μήνας">
        <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
      </button>
    </div>`;

  // ---- hero: average per day + comparison ----
  let compare = "";
  if (prev.total > 0) {
    const pct = Math.round(((s.avg - prev.avg) / prev.avg) * 100);
    const prevName = `τον ${GREEK_MONTHS_ACC[prev.month]}`;
    if (pct === 0) {
      compare = `<div class="ms-compare flat">Ίδιος μέσος όρος με ${prevName}</div>`;
    } else {
      compare = `<div class="ms-compare ${pct > 0 ? "up" : "down"}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% ${pct > 0 ? "περισσότερο" : "λιγότερο"} ανά ημέρα από ${prevName}</div>`;
    }
  }
  html += `
    <div class="ms-hero">
      <div class="ms-hero-label">Μέσος όρος εξόδων ανά ημέρα</div>
      <div class="ms-hero-value">${formatCurrency(s.avg)}<span>€</span></div>
      <div class="ms-hero-meta">Σύνολο ${formatCurrency(s.total)}€ σε ${s.daysCounted} ${s.daysCounted === 1 ? "ημέρα" : "ημέρες"}</div>
      ${compare}
    </div>`;

  if (s.count === 0) {
    html += `
      <div class="ms-empty">
        <i class="fa-solid fa-chart-simple"></i>
        <p>Δεν υπάρχουν έξοδα αυτόν τον μήνα.</p>
      </div>`;
  } else {
    // ---- daily chart ----
    const maxBar = Math.max(...s.daily, s.avg, 1);
    const bars = s.daily
      .map((v, i) => {
        const future = i >= s.daysCounted;
        const hPct = v > 0 ? Math.max((v / maxBar) * 100, 4) : 0;
        return `<button type="button" class="ms-bar${future ? " future" : ""}${v === 0 ? " zero" : ""}" style="height:${hPct ? hPct + "%" : "3px"}" onclick="msPickDay(${i + 1})" aria-label="${i + 1}: ${formatCurrency(v)}€"></button>`;
      })
      .join("");
    const ticks = [1, 8, 15, 22, 29].filter((d) => d <= s.daysInMonth);
    if (!ticks.includes(s.daysInMonth) && s.daysInMonth - ticks[ticks.length - 1] >= 3)
      ticks.push(s.daysInMonth);
    html += `
    <div class="ms-section">
      <div class="ms-section-title">Έξοδα ανά ημέρα</div>
      <div class="ms-chart">
        <div class="ms-chart-bars">
          ${bars}
          <div class="ms-avg-line" style="bottom:${(s.avg / maxBar) * 100}%"><span>Μ.Ο.</span></div>
        </div>
        <div class="ms-chart-axis">${ticks.map((t) => `<span>${t}</span>`).join("")}</div>
      </div>
      <div class="ms-readout" id="ms-readout">Πάτα μια μπάρα για να δεις την ημέρα</div>
    </div>`;

    // ---- stat tiles ----
    const net = s.income - s.total;
    const tile = (label, value, sub = "", cls = "") =>
      `<div class="ms-tile ${cls}"><div class="ms-tile-label">${label}</div><div class="ms-tile-value">${value}</div>${sub ? `<div class="ms-tile-sub">${sub}</div>` : ""}</div>`;

    const peakDate = s.peakDay
      ? new Date(s.year, s.month, s.peakDay).toLocaleDateString("el-GR", {
          day: "numeric",
          month: "short",
        })
      : "";

    let tiles = "";
    tiles += tile("Σύνολο εξόδων", `${formatCurrency(s.total)}€`);
    tiles += tile("Συναλλαγές", s.count);
    tiles += tile("Μ.Ο. ανά συναλλαγή", `${formatCurrency(s.total / s.count)}€`);
    tiles += tile(
      "Μεγαλύτερο έξοδο",
      `${formatCurrency(s.biggest.amount)}€`,
      escapeHtml(s.biggest.name || ""),
    );
    tiles += tile(
      "Πιο ακριβή ημέρα",
      s.peakDay ? `${formatCurrency(s.daily[s.peakDay - 1])}€` : "—",
      peakDate,
    );
    tiles += tile(
      "Ημέρες χωρίς έξοδα",
      s.zeroDays,
      `από ${s.daysCounted} ${s.daysCounted === 1 ? "ημέρα" : "ημέρες"}`,
    );
    tiles += tile("Εισόδημα", `${formatCurrency(s.income)}€`);
    tiles += tile(
      "Καθαρό",
      `${net > 0 ? "+" : net < 0 ? "-" : ""}${formatCurrency(Math.abs(net))}€`,
      "",
      net > 0 ? "pos" : net < 0 ? "neg" : "",
    );
    if (s.isCurrent) {
      tiles += tile(
        "Εκτίμηση τέλους μήνα",
        `${formatCurrency(s.avg * s.daysInMonth)}€`,
        `με τον τρέχοντα ρυθμό (${formatCurrency(s.avg)}€ / ημέρα)`,
        "wide",
      );
    }
    html += `
    <div class="ms-section">
      <div class="ms-section-title">Περισσότερα στατιστικά</div>
      <div class="ms-tiles">${tiles}</div>
    </div>`;

    // ---- categories ----
    const topCats = s.categoryList.slice(0, 5);
    const catRows = topCats
      .map((c) => {
        const info = getCategoryInfo(c.id);
        const pct = s.total > 0 ? (c.amount / s.total) * 100 : 0;
        return `
        <div class="ms-cat">
          <div class="ms-cat-icon" style="background:${info.bg}"><i class="${sanitizeFaClass(info.icon)}"></i></div>
          <div class="ms-cat-body">
            <div class="ms-cat-top"><span class="ms-cat-name">${escapeHtml(info.name)}</span><span class="ms-cat-amount">${formatCurrency(c.amount)}€ · ${Math.round(pct)}%</span></div>
            <div class="ms-cat-bar"><span style="width:${pct}%"></span></div>
          </div>
        </div>`;
      })
      .join("");
    html += `
    <div class="ms-section">
      <div class="ms-section-title">Κορυφαίες κατηγορίες</div>
      <div class="ms-cats">${catRows}</div>
    </div>`;

    // ---- weekdays ----
    const maxWd = Math.max(...s.weekdayAvg, 1);
    const wd = s.weekdayAvg
      .map(
        (v, i) => `
      <div class="ms-wd">
        <div class="ms-wd-val">${v > 0 ? formatCurrency(v) : "–"}</div>
        <div class="ms-wd-track"><span style="height:${(v / maxWd) * 100}%"></span></div>
        <div class="ms-wd-name">${GREEK_WEEKDAYS_SHORT[i]}</div>
      </div>`,
      )
      .join("");
    html += `
    <div class="ms-section">
      <div class="ms-section-title">Μ.Ο. ανά ημέρα της εβδομάδας</div>
      <div class="ms-weekdays">${wd}</div>
    </div>`;
  }

  // ---- all months ----
  const months = [];
  let y = now.getFullYear();
  let m = now.getMonth();
  while (y > earliest.year || (y === earliest.year && m >= earliest.month)) {
    months.push(computeMonthStats(y, m));
    m--;
    if (m < 0) {
      m = 11;
      y--;
    }
  }
  const maxAvg = Math.max(...months.map((x) => x.avg), 0.01);
  const rows = months
    .map((x) => {
      const active = x.year === s.year && x.month === s.month;
      return `
      <button type="button" class="ms-month-row${active ? " active" : ""}" onclick="selectStatsMonth(${x.year}, ${x.month}, true)">
        <div class="ms-month-info">
          <div class="ms-month-name">${GREEK_MONTHS[x.month]} ${x.year}${x.isCurrent ? ' <em>τρέχων</em>' : ""}</div>
          <div class="ms-month-meta">Σύνολο ${formatCurrency(x.total)}€ · ${x.count} ${x.count === 1 ? "συναλλαγή" : "συναλλαγές"}</div>
        </div>
        <div class="ms-month-right">
          <div class="ms-month-avg">${formatCurrency(x.avg)}€<small> / ημέρα</small></div>
          <div class="ms-month-bar"><span style="width:${(x.avg / maxAvg) * 100}%"></span></div>
        </div>
      </button>`;
    })
    .join("");
  html += `
    <div class="ms-section">
      <div class="ms-section-title">Όλοι οι μήνες</div>
      <div class="ms-months">${rows}</div>
    </div>`;

  box.innerHTML = html;

  // keep a selected day highlighted after a live refresh
  if (statsState.day && statsState.day <= s.daysInMonth && s.count > 0)
    msPickDay(statsState.day);
}

// Expanded (multi-row) day calendar state. When the user scrolls the day
// strip back by ~1.5 weeks, the strip is swapped for a bigger calendar.
let txCalExpanded = false;
let txGridAnchor = null;
let txProgrammaticScrollUntil = 0;
const TX_EXPAND_AFTER_DAYS = 10.5; // 1.5 weeks

// Scrollable day strip for the Transactions screen — lets the user jump to
// any specific day and see just that day's transactions. Mirrors the same
// interaction pattern as the home screen's date-based "Πρόσφατα" list:
// today = no date filter (full history), any other day = filtered to it.
function renderTxWeekCalendar() {
  try {
    renderTxWeekCalendarInner();
  } catch (err) {
    // The day strip is a convenience on top of the transaction list, never a
    // requirement for it — never let a problem here take the list down too.
    console.error("renderTxWeekCalendar failed:", err);
  }
}

function renderTxWeekCalendarInner() {
  const container = document.getElementById("tx-week-days");
  const grid = document.getElementById("tx-month-grid");
  if (!container) return;

  // Month title + arrow row: always visible, above the strip / big calendar.
  const head = document.getElementById("tx-cal-head");
  const toggle = document.getElementById("tx-cal-toggle");
  if (head) head.classList.toggle("expanded", txCalExpanded);
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(txCalExpanded));
    if (!toggle._bound) {
      toggle._bound = true;
      toggle.addEventListener("click", () => {
        if (!txCalExpanded) {
          const strip = document.getElementById("tx-week-days");
          txGridAnchor =
            (strip && txStripCenterDate(strip)) ||
            startOfDay(new Date(state.txSelectedDate));
        }
        txCalExpanded = !txCalExpanded;
        renderTxWeekCalendar();
      });
    }
  }

  const today = startOfDay(new Date());
  const selected = startOfDay(new Date(state.txSelectedDate));

  // Expanded mode: show the bigger multi-row calendar instead of the strip.
  if (txCalExpanded && grid) {
    container.hidden = true;
    grid.hidden = false;
    renderTxMonthGrid(grid, today, selected);
    updateTxTodayBtn();
    return;
  }
  container.hidden = false;
  if (grid) {
    grid.hidden = true;
    grid.innerHTML = "";
  }
  // Ignore the scroll events caused by our own re-centering below.
  txProgrammaticScrollUntil = Date.now() + 900;

  const dayRangeBefore = 90;
  const dayRangeAfter = 90;
  const start = addDaysToDate(today, -dayRangeBefore);
  let html = "";

  for (let i = 0; i <= dayRangeBefore + dayRangeAfter; i++) {
    const d = addDaysToDate(start, i);
    const isToday = sameDay(d, today);
    const isSelected = sameDay(d, selected);
    const dayName = d.toLocaleDateString("el-GR", { weekday: "narrow" });
    const fullLabel = d.toLocaleDateString("el-GR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    html += `
      <div class="week-day ${isSelected ? "selected" : ""} ${isToday ? "today" : ""}"
        data-date-key="${toDayKey(d)}" role="button" tabindex="0"
        aria-pressed="${isSelected}" aria-label="${escapeHtml(fullLabel)}">
        <span class="day-name">${dayName}</span>
        <span class="day-num">${d.getDate()}</span>
      </div>`;
  }

  container.innerHTML = html;
  updateTxTodayBtn();
  setTxCalTitle(selected);

  const centerSelected = (behavior = "auto") => {
    const active =
      container.querySelector(".week-day.selected") ||
      container.querySelector(".week-day.today");
    if (!active) return;
    txProgrammaticScrollUntil = Date.now() + 900;

    const left = Math.max(
      0,
      active.offsetLeft - (container.clientWidth - active.offsetWidth) / 2,
    );
    // Remember where the strip is "at rest" so we can measure how far back
    // the user scrolls from here.
    container._homeLeft = left;
    container._homeSlot = active.offsetWidth + 4;
    container._homeDate = active.dataset.dateKey
      ? fromDayKey(active.dataset.dateKey)
      : today;
    setTxCalTitle(container._homeDate);
    // Element.scrollTo isn't available in every WebView; fall back to the
    // universally-supported scrollLeft property.
    if (typeof container.scrollTo === "function") {
      try {
        container.scrollTo({ left, behavior });
        return;
      } catch (_err) {
        // fall through to the plain assignment below
      }
    }
    container.scrollLeft = left;
  };

  const selectDay = (el) => {
    const key = el.dataset.dateKey;
    if (!key) return;
    const clicked = startOfDay(fromDayKey(key));
    const current = startOfDay(new Date(state.txSelectedDate));
    // Tapping the already-selected day again (when it isn't today) clears
    // the filter and returns to the full list, same as tapping "today".
    state.txSelectedDate =
      !sameDay(clicked, today) && sameDay(clicked, current) ? today : clicked;
    renderTxWeekCalendar();
    renderTransactionList();
    centerSelected("smooth");
  };

  container.querySelectorAll(".week-day").forEach((el) => {
    el.addEventListener("click", () => selectDay(el));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectDay(el);
      }
    });
  });

  if (!container._expandBound) {
    container._expandBound = true;
    container.addEventListener(
      "scroll",
      () => onTxStripScroll(container),
      { passive: true },
    );
  }

  requestAnimationFrame(() => centerSelected("auto"));
}

// Expand into the big calendar once the user has scrolled the strip back
// by roughly a week and a half from where it was resting.
function txStripCenterDate(container) {
  if (
    container._homeLeft === undefined ||
    !container._homeSlot ||
    !container._homeDate
  )
    return null;
  return addDaysToDate(
    container._homeDate,
    Math.round((container.scrollLeft - container._homeLeft) / container._homeSlot),
  );
}

function setTxCalTitle(d) {
  const el = document.getElementById("tx-month-title");
  if (!el || !d) return;
  el.textContent = d.toLocaleDateString("el-GR", {
    month: "long",
    year: "numeric",
  });
}

function onTxStripScroll(container) {
  if (txCalExpanded) return;
  setTxCalTitle(txStripCenterDate(container));
  if (Date.now() < txProgrammaticScrollUntil) return;
  if (container._homeLeft === undefined || !container._homeSlot) return;

  const daysBack =
    (container._homeLeft - container.scrollLeft) / container._homeSlot;
  if (daysBack < TX_EXPAND_AFTER_DAYS) return;

  txGridAnchor = addDaysToDate(
    container._homeDate || startOfDay(new Date()),
    -Math.round(daysBack),
  );
  txCalExpanded = true;
  renderTxWeekCalendar();
}

// Bigger calendar: 7 columns (Monday first), one row per week, scrolls
// vertically. Tapping a day selects it and folds back into the day strip.
function renderTxMonthGrid(grid, today, selected) {
  const mondayOf = (d) => addDaysToDate(d, -((d.getDay() + 6) % 7));
  const first = mondayOf(addDaysToDate(today, -90));
  const last = addDaysToDate(mondayOf(addDaysToDate(today, 90)), 6);
  const totalDays = Math.round((last - first) / 86400000) + 1;

  let weekdays = "";
  for (let i = 0; i < 7; i++) {
    const label = addDaysToDate(first, i).toLocaleDateString("el-GR", {
      weekday: "narrow",
    });
    weekdays += `<span>${label}</span>`;
  }

  let cells = "";
  for (let i = 0; i < totalDays; i++) {
    const d = addDaysToDate(first, i);
    const isSelected = sameDay(d, selected);
    const isToday = sameDay(d, today);
    const fullLabel = d.toLocaleDateString("el-GR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    cells += `<div class="month-cell ${d.getMonth() % 2 ? "alt" : ""} ${isSelected ? "selected" : ""} ${isToday ? "today" : ""}"
      data-date-key="${toDayKey(d)}" role="button" tabindex="0"
      aria-pressed="${isSelected}" aria-label="${escapeHtml(fullLabel)}">${d.getDate()}</div>`;
  }

  grid.innerHTML = `
    <div class="month-grid-weekdays">${weekdays}</div>
    <div class="month-grid-scroll" id="tx-month-scroll">${cells}</div>`;

  const scroll = grid.querySelector("#tx-month-scroll");
  const firstCell = scroll.querySelector(".month-cell");
  const rowH = (firstCell ? firstCell.offsetHeight : 44) + 4;

  const updateTitle = () => {
    const row = Math.floor((scroll.scrollTop + rowH * 2) / rowH);
    const idx = Math.max(0, Math.min(totalDays - 1, row * 7 + 3));
    setTxCalTitle(addDaysToDate(first, idx));
  };

  // Open with the week we scrolled to sitting in the middle of the view.
  const anchor = startOfDay(txGridAnchor || selected);
  const anchorRow = Math.floor(
    Math.max(0, Math.round((anchor - first) / 86400000)) / 7,
  );
  scroll.scrollTop = Math.max(0, (anchorRow - 2) * rowH);
  updateTitle();
  scroll.addEventListener("scroll", updateTitle, { passive: true });

  const pick = (el) => {
    const key = el.dataset.dateKey;
    if (!key) return;
    const clicked = startOfDay(fromDayKey(key));
    const current = startOfDay(new Date(state.txSelectedDate));
    state.txSelectedDate =
      !sameDay(clicked, today) && sameDay(clicked, current) ? today : clicked;
    // Stay expanded (the user closes it with the arrow) — just move the
    // selection in place so the grid doesn't jump.
    const newKey = toDayKey(startOfDay(new Date(state.txSelectedDate)));
    scroll.querySelectorAll(".month-cell").forEach((cell) => {
      const on = cell.dataset.dateKey === newKey;
      cell.classList.toggle("selected", on);
      cell.setAttribute("aria-pressed", String(on));
    });
    updateTxTodayBtn();
    renderTransactionList();
  };
  scroll.querySelectorAll(".month-cell").forEach((el) => {
    el.addEventListener("click", () => pick(el));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pick(el);
      }
    });
  });
}

// Shows the top-right "Σήμερα" button only while a day other than today is
// selected in the Transactions day strip.
function updateTxTodayBtn() {
  const btn = document.getElementById("tx-today-btn");
  if (!btn) return;
  const isOtherDay = !sameDay(
    startOfDay(new Date(state.txSelectedDate)),
    startOfDay(new Date()),
  );
  btn.hidden = !isOtherDay;
}

// Jump back to today: clears the day filter and re-centers the day strip.
function goToTxToday() {
  state.txSelectedDate = startOfDay(new Date());
  txGridAnchor = state.txSelectedDate;
  renderTxWeekCalendar();
  renderTransactionList();
}

function renderTransactionFilters() {
  const container = document.getElementById("filter-chips");
  if (!container) return;

  const filters = [
    { id: "all", label: "Όλα" },
    { id: "income", label: "Εισόδημα" },
    { id: "expense", label: "Έξοδα" },
    {
      id: "food",
      label: `${renderFaIcon("fa-solid fa-burger", "fa-solid fa-burger", "chip-icon")} Φαγητό`,
    },
    {
      id: "transport",
      label: `${renderFaIcon("fa-solid fa-bus", "fa-solid fa-bus", "chip-icon")} Μεταφορά`,
    },
    {
      id: "entertainment",
      label: `${renderFaIcon("fa-solid fa-gamepad", "fa-solid fa-gamepad", "chip-icon")} Διασκέδαση`,
    },
    {
      id: "shopping",
      label: `${renderFaIcon("fa-solid fa-shirt", "fa-solid fa-shirt", "chip-icon")} Ψώνια`,
    },
  ];

  container.innerHTML = filters
    .map(
      (f) =>
        `<div class="chip ${state.transactionFilter === f.id ? "active" : ""}" data-filter="${f.id}">${f.label}</div>`,
    )
    .join("");

  container.querySelectorAll(".chip").forEach((el) => {
    el.addEventListener("click", () => {
      state.transactionFilter = el.dataset.filter;
      renderTransactions();
    });
  });
}

function renderTransactionList() {
  const container = document.getElementById("transaction-list");
  if (!container) return;

  const q = state.searchQuery ? state.searchQuery.toLowerCase() : "";
  const f = state.transactionFilter;

  // ── Day filter (from the scrollable day calendar) ──
  // "Today" selected means no date filter — show the full history.
  const today = startOfDay(new Date());
  const selectedDay = startOfDay(new Date(state.txSelectedDate));
  const dayFilterActive = !sameDay(selectedDay, today);

  // ── Filter transactions ──
  let filteredTx = state.transactions.filter((t) => {
    if (dayFilterActive && !sameDay(new Date(t.date), selectedDay))
      return false;
    if (
      q &&
      !t.name.toLowerCase().includes(q) &&
      !(t.note || "").toLowerCase().includes(q)
    )
      return false;
    if (f === "income") return t.type === "income";
    if (f === "expense") return t.type === "expense";
    if (f !== "all") return t.category === f;
    return true;
  });

  // ── Filter pending payments ──
  let filteredPay = state.payments
    .filter((p) => p.status === "pending")
    .filter((p) => {
      if (
        dayFilterActive &&
        !(p.dueDate && sameDay(new Date(p.dueDate), selectedDay))
      )
        return false;
      if (
        q &&
        !p.name.toLowerCase().includes(q) &&
        !(p.note || "").toLowerCase().includes(q)
      )
        return false;
      if (f === "income") return p.type === "incoming";
      if (f === "expense") return p.type === "outgoing";
      if (f !== "all") return p.category === f;
      return true;
    });

  // ── Tag & merge ──
  const now = new Date();
  const tagged = [
    ...filteredTx.map((t) => ({
      _item: t,
      _kind: "tx",
      _date: new Date(t.date),
    })),
    ...filteredPay.map((p) => ({
      _item: p,
      _kind: "pay",
      _date: p.dueDate ? new Date(p.dueDate) : now,
    })),
  ];

  // Sort: overdue payments first, then by date descending
  tagged.sort((a, b) => {
    const aOverdue = a._kind === "pay" && a._date < now;
    const bOverdue = b._kind === "pay" && b._date < now;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    return b._date - a._date;
  });

  if (tagged.length === 0) {
    const isEmpty =
      state.transactions.length === 0 &&
      state.payments.filter((p) => p.status === "pending").length === 0;
    const dayLabel = selectedDay.toLocaleDateString("el-GR", {
      day: "numeric",
      month: "long",
    });
    const message = isEmpty
      ? "Δεν υπάρχουν συναλλαγές"
      : dayFilterActive
        ? `Δεν υπάρχουν συναλλαγές στις ${dayLabel}`
        : "Δεν βρέθηκαν αποτελέσματα";
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${renderFaIcon(isEmpty ? "fa-solid fa-receipt" : "fa-solid fa-magnifying-glass", "fa-solid fa-receipt")}</div>
        <p>${message}</p>
      </div>`;
    return;
  }

  // ── Group by date label ──
  const groups = {};
  tagged.forEach(({ _item, _kind, _date }) => {
    // Pending future payments get a "Προγραμματισμένο" prefix so they group together
    let key;
    if (_kind === "pay") {
      const overdue = _date < now;
      key = overdue
        ? `⚠ Εκπρόθεσμο · ${formatDate(_item.dueDate || _item.date)}`
        : `📅 ${formatDate(_item.dueDate || _item.date)}`;
    } else {
      key = formatDate(_item.date);
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push({ _item, _kind });
  });

  let html = "";
  Object.entries(groups).forEach(([dateLabel, items]) => {
    html += `<div class="date-group">
      <div class="date-group-header">${dateLabel}</div>
      <div class="transaction-list-inner">
        ${items
          .map(({ _item, _kind }) =>
            _kind === "pay"
              ? futurePaymentItemHTML(_item)
              : transactionItemHTML(_item),
          )
          .join("")}
      </div>
    </div>`;
  });

  container.innerHTML = html;
}

// ---- SAVINGS VIEW ----
function renderSavings() {
  renderSavingsScore();
  renderSavingsBalances();
  renderGoals();
  renderSavingsTransferUI();
  updateTransferSlider();
}

// ---- FINANCE SCORE (radial rings on the Αποταμίευση tab) ----
// Four 0-100 sub-scores, total = average of the ones that have data:
//  spend  – this month's expenses vs income (or vs available money if no income logged)
//  save   – savings vs 3 months of spending (emergency fund)
//  goals  – average completion of savings goals
//  debts  – how small what you owe is compared to what you have
const SCORE_RING_R = 34;
const SCORE_RING_C = 2 * Math.PI * SCORE_RING_R;
const SCORE_KEYS = ["spend", "goals", "debts", "save"];
let _savingsReplay = true;
let _scoreTimer = 0;

function scoreClamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function scoreSpendingFor(stats) {
  if (!stats || (stats.total === 0 && stats.income === 0)) return null;
  const base =
    stats.income > 0
      ? stats.income
      : Math.max(stats.total + Math.max(state.balance, 0), 1);
  // spending <= 60% of base = perfect, >= 110% = zero
  return scoreClamp(((1.1 - stats.total / base) / 0.5) * 100);
}

function scoreSavingsFor(savings, monthlyBurn) {
  if (!(savings > 0)) return 0;
  if (!(monthlyBurn > 0)) return 100;
  return scoreClamp((savings / monthlyBurn / 3) * 100);
}

function scoreGoalsFor(goals) {
  if (!goals.length) return null;
  const sum = goals.reduce(
    (a, g) => a + (g.target > 0 ? Math.min(1, (g.current || 0) / g.target) : 0),
    0,
  );
  return scoreClamp((sum / goals.length) * 100);
}

function computeFinanceScore() {
  const now = new Date();
  const cur = computeMonthStats(now.getFullYear(), now.getMonth());
  const prevRef = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prev = computeMonthStats(prevRef.getFullYear(), prevRef.getMonth());

  const spend = scoreSpendingFor(cur);
  const prevSpend =
    prev.total > 0 || prev.income > 0 ? scoreSpendingFor(prev) : null;

  const burn = computeActivityData(30).total; // last 30 days of expenses
  const savings = scoreSavingsFor(state.savings, burn);
  const months = burn > 0 && state.savings > 0 ? state.savings / burn : null;

  const goals = scoreGoalsFor(state.savingsGoals);
  const goalsDone = state.savingsGoals.filter(
    (g) => g.target > 0 && (g.current || 0) >= g.target,
  ).length;

  const owed = state.debts
    .filter((d) => d.type === "owe")
    .reduce((a, d) => a + d.amount, 0);
  const lent = state.debts
    .filter((d) => d.type === "lent")
    .reduce((a, d) => a + d.amount, 0);
  let debts = 100;
  if (owed > 0) {
    const liquid = Math.max(state.balance, 0) + Math.max(state.savings, 0) + lent;
    debts = liquid > 0 ? scoreClamp((1 - owed / liquid) * 100) : 0;
  }

  // Savings change vs ~30 days ago (from the local snapshot history)
  let baseline = null;
  const hist = getSavingsHistory();
  if (hist.length) {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 30);
    const old = hist.filter((h) => new Date(h.date) <= cutoff).pop() || hist[0];
    if (now - new Date(old.date) >= 86400000) baseline = old.savings;
  }
  const monthChangePct =
    baseline !== null && baseline > 0
      ? ((state.savings - baseline) / baseline) * 100
      : null;
  const savingsDelta =
    baseline !== null ? savings - scoreSavingsFor(baseline, burn) : null;
  const spendDelta =
    spend !== null && prevSpend !== null ? spend - prevSpend : null;

  // Brand-new account: nothing to score yet
  const hasAnyData =
    state.transactions.length > 0 ||
    state.savings > 0 ||
    state.savingsGoals.length > 0 ||
    state.debts.length > 0;
  const scores = hasAnyData
    ? { spend, savings, goals, debts }
    : { spend: null, savings: null, goals: null, debts: null };

  const parts = [scores.spend, scores.savings, scores.goals, scores.debts].filter(
    (v) => v !== null,
  );
  const total = parts.length
    ? Math.round(parts.reduce((a, v) => a + v, 0) / parts.length)
    : null;

  const details = {
    spend:
      cur.total > 0 || cur.income > 0
        ? `${formatCurrency(cur.total)}€ αυτόν τον μήνα`
        : "Χωρίς δεδομένα",
    save:
      state.savings <= 0
        ? "Χωρίς αποταμίευση"
        : months !== null
          ? `Αποθεματικό ${months.toFixed(1)} ${Number(months.toFixed(1)) === 1 ? "μήνας" : "μήνες"}`
          : `${formatCurrency(state.savings)}€ διαθέσιμα`,
    goals: state.savingsGoals.length
      ? `${goalsDone}/${state.savingsGoals.length} ολοκληρωμένοι`
      : "Πρόσθεσε στόχο",
    debts:
      owed > 0
        ? `Χρωστάς ${formatCurrency(owed)}€`
        : lent > 0
          ? `Σου χρωστούν ${formatCurrency(lent)}€`
          : "Χωρίς χρέη",
  };

  return {
    spend: scores.spend,
    savings: scores.savings,
    goals: scores.goals,
    debts: scores.debts,
    total,
    months,
    monthChangePct,
    deltas: { spend: spendDelta, save: savingsDelta },
    details,
  };
}

function scoreRating(total) {
  if (total === null) return "—";
  if (total >= 85) return "Εξαιρετική";
  if (total >= 70) return "Πολύ καλή";
  if (total >= 50) return "Καλή";
  if (total >= 30) return "Μέτρια";
  return "Προσοχή";
}

// Number that eases from its current value to `to` ("–" when there's no data)
function tweenNumber(el, to, duration = 900) {
  if (!el) return;
  cancelAnimationFrame(el._raf);
  if (to === null || to === undefined) {
    el.textContent = "–";
    el._val = null;
    return;
  }
  const from = typeof el._val === "number" ? el._val : 0;
  const reduce =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (from === to || duration <= 0 || reduce) {
    el.textContent = String(to);
    el._val = to;
    return;
  }
  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / duration);
    const v = from + (to - from) * (1 - Math.pow(1 - p, 3));
    el._val = v;
    el.textContent = String(Math.round(v));
    if (p < 1) el._raf = requestAnimationFrame(step);
    else {
      el._val = to;
      el.textContent = String(to);
    }
  };
  el._raf = requestAnimationFrame(step);
}

function setScoreDelta(id, delta) {
  const el = document.getElementById(id);
  if (!el) return;
  if (delta === null || delta === 0) {
    el.textContent = "";
    el.className = "score-delta";
    return;
  }
  el.className = `score-delta ${delta > 0 ? "up" : "down"}`;
  el.textContent = `${delta > 0 ? "▲" : "▼"} ${Math.abs(Math.round(delta))}`;
}

// Puts rings / bars back to empty (no transition) so the tab plays its intro again
function resetScoreVisuals() {
  const arcs = [];
  const bars = [];
  SCORE_KEYS.forEach((k) => {
    const arc = document.getElementById(`arc-${k}`);
    if (arc) {
      arc.style.transition = "none";
      arc.style.strokeDashoffset = String(SCORE_RING_C);
      arc.style.opacity = "0";
      arcs.push(arc);
    }
    const bar = document.getElementById(`sc-bar-${k}`);
    if (bar) {
      bar.style.transition = "none";
      bar.style.width = "0%";
      bars.push(bar);
    }
    [`val-${k}`, `sc-val-${k}`].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        cancelAnimationFrame(el._raf);
        el._val = 0;
        el.textContent = "0";
      }
    });
  });
  const total = document.getElementById("score-total");
  if (total) {
    cancelAnimationFrame(total._raf);
    total._val = 0;
    total.textContent = "0";
  }
  const svg = document.getElementById("score-svg");
  if (svg) void svg.getBoundingClientRect(); // flush so the reset isn't animated
  arcs.forEach((a) => (a.style.transition = ""));
  bars.forEach((b) => (b.style.transition = ""));
}

function applyScoreValues() {
  const s = computeFinanceScore();
  const byKey = { spend: s.spend, goals: s.goals, debts: s.debts, save: s.savings };

  SCORE_KEYS.forEach((k) => {
    const v = byKey[k];
    const arc = document.getElementById(`arc-${k}`);
    if (arc) {
      arc.style.opacity = v ? "1" : "0";
      arc.style.strokeDashoffset = String(SCORE_RING_C * (1 - (v || 0) / 100));
    }
    tweenNumber(document.getElementById(`val-${k}`), v);
    tweenNumber(document.getElementById(`sc-val-${k}`), v);
    const bar = document.getElementById(`sc-bar-${k}`);
    if (bar) bar.style.width = `${v || 0}%`;
    const det = document.getElementById(`sc-det-${k}`);
    if (det) det.textContent = s.details[k];
  });
  tweenNumber(document.getElementById("score-total"), s.total, 1100);

  setScoreDelta("delta-spend", s.deltas.spend);
  setScoreDelta("delta-save", s.deltas.save);
  setScoreDelta("delta-goals", null);
  setScoreDelta("delta-debts", null);

  // Status card
  const status = document.getElementById("score-status");
  const pill = document.getElementById("score-pill");
  const rating = document.getElementById("score-rating");
  const sub = document.getElementById("score-rating-sub");
  const pct = s.monthChangePct;
  if (status) {
    status.classList.remove("up", "down", "flat");
    status.classList.add(
      pct === null || Math.abs(pct) < 0.05 ? "flat" : pct > 0 ? "up" : "down",
    );
  }
  if (pill) {
    pill.textContent =
      pct === null
        ? "—"
        : `${pct > 0 ? "+" : pct < 0 ? "-" : ""}${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}% / μήνα`;
  }
  if (rating) rating.textContent = scoreRating(s.total);
  if (sub) {
    sub.textContent =
      s.total === null
        ? "Πρόσθεσε συναλλαγές"
        : s.months !== null
          ? `Αποθεματικό ${s.months.toFixed(1)} μηνών εξόδων`
          : "Οικονομική βαθμολογία";
  }
}

function renderSavingsScore() {
  if (!document.getElementById("score-hero")) return;
  clearTimeout(_scoreTimer);
  if (_savingsReplay) {
    _savingsReplay = false;
    resetScoreVisuals();
    // let the tab finish sliding in before the rings draw
    _scoreTimer = setTimeout(applyScoreValues, 280);
  } else {
    applyScoreValues();
  }
}

function renderSavingsBalances() {
  const mainEl = document.getElementById("savings-main-balance");
  const savingsEl = document.getElementById("savings-amount");
  const trendEl = document.getElementById("savings-trend");
  if (mainEl) mainEl.textContent = `${formatCurrency(state.balance)}€`;
  if (savingsEl) savingsEl.textContent = `${formatCurrency(state.savings)}€`;
  if (trendEl) trendEl.textContent = `Διαθέσιμο`;
  // if (trendEl) trendEl.textContent = `+${formatCurrency(0)}€ αυτόν τον μήνα`;
}

function setTransferSliderFill(pct) {
  const slider = document.getElementById("transfer-slider");
  if (slider)
    slider.style.setProperty("--p", `${Math.max(0, Math.min(100, pct))}%`);
  document.querySelectorAll(".transfer-chip").forEach((chip) => {
    chip.classList.toggle(
      "active",
      pct > 0 && Number(chip.dataset.pct) === Math.round(pct),
    );
  });
}

function getTransferSourceBalance() {
  return state.savingsTransferSource === "savings"
    ? state.savings
    : state.balance;
}

function updateTransferSlider() {
  const slider = document.getElementById("transfer-slider");
  const maxLabel = document.getElementById("slider-max");
  const sourceBalance =
    state.savingsTransferSource === "savings" ? state.savings : state.balance;
  if (maxLabel) maxLabel.textContent = `${formatCurrency(sourceBalance)}€`;
  if (slider) slider.value = 0;
  const inputEl = document.getElementById("transfer-amount");
  if (inputEl) inputEl.value = "";
  setTransferSliderFill(0);
}

function renderSavingsTransferUI() {
  document.querySelectorAll(".savings-account-btn").forEach((btn) => {
    btn.classList.toggle(
      "active",
      btn.dataset.account === state.savingsTransferSource,
    );
  });

  const fromSavings = state.savingsTransferSource === "savings";
  const direction = fromSavings ? "withdraw" : "save";

  const panelEl = document.getElementById("transfer-panel");
  if (panelEl) panelEl.classList.toggle("is-withdraw", fromSavings);

  const hintEl = document.getElementById("transfer-panel-hint");
  if (hintEl) {
    hintEl.textContent = fromSavings
      ? "από αποταμίευση"
      : "από κύριο υπόλοιπο";
  }

  const mainEl = document.getElementById("transfer-action-main");
  if (mainEl) {
    mainEl.textContent = fromSavings ? "Ανάληψη" : "Αποθήκευση";
  }

  const subEl = document.getElementById("transfer-action-sub");
  if (subEl) {
    subEl.textContent = fromSavings
      ? "Αποταμίευση → Κύριο"
      : "Κύριο → Αποταμίευση";
  }

  const btnEl = document.getElementById("transfer-action-btn");
  if (btnEl) {
    btnEl.classList.toggle("save", direction === "save");
    btnEl.classList.toggle("withdraw", direction === "withdraw");
  }

  const iconEl = document.getElementById("transfer-action-icon");
  if (iconEl) {
    iconEl.innerHTML =
      direction === "save"
        ? '<path d="M5 12h14M15 8l4 4-4 4"/>'
        : '<path d="M19 12H5M9 8l-4 4 4 4"/>';
  }
}

function animateTransfer(direction) {
  const rightArrow = document.querySelector(".xfer-arrow.xfer-right");
  const leftArrow = document.querySelector(".xfer-arrow.xfer-left");
  const mainCard = document.getElementById("main-balance-card");
  const savCard = document.getElementById("savings-balance-card");

  const arrow = direction === "save" ? rightArrow : leftArrow;
  const targetCard = direction === "save" ? savCard : mainCard;

  if (arrow) {
    arrow.classList.remove("animating");
    void arrow.offsetWidth;
    arrow.classList.add("animating");
    arrow.addEventListener(
      "animationend",
      () => arrow.classList.remove("animating"),
      { once: true },
    );
  }
  if (targetCard) {
    targetCard.classList.remove("card-received");
    void targetCard.offsetWidth;
    targetCard.classList.add("card-received");
    targetCard.addEventListener(
      "animationend",
      () => targetCard.classList.remove("card-received"),
      { once: true },
    );
  }
}

function renderGoals() {
  const container = document.getElementById("goals-list");
  if (!container) return;

  if (state.savingsGoals.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${renderFaIcon("fa-solid fa-bullseye", "fa-solid fa-bullseye")}</div>
        <p>Δεν υπάρχουν στόχοι</p>
      </div>
      <button class="add-goal-btn" onclick="openGoalSheet()">
        ${icons.plus}
        <span>Προσθήκη Στόχου</span>
      </button>`;
    return;
  }

  let html = state.savingsGoals
    .map((g) => {
      const pct =
        g.target > 0 ? Math.round(((g.current || 0) / g.target) * 100) : 0;
      const ringPct = Math.max(0, Math.min(100, pct));
      const ringC = 2 * Math.PI * 16;
      return `
      <div class="goal-card ${g.color || "green"}" data-id="${g.id}">
        <div class="goal-header">
          <div class="goal-emoji">${renderFaIcon(g.icon || g.emoji, "fa-solid fa-bullseye")}</div>
          <div class="goal-ring ${g.color || "green"}">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <circle class="gr-track" cx="20" cy="20" r="16"/>
              <circle class="gr-arc" cx="20" cy="20" r="16" transform="rotate(-90 20 20)"
                stroke-dasharray="${ringC.toFixed(2)}" stroke-dashoffset="${(ringC * (1 - ringPct / 100)).toFixed(2)}"
                style="opacity:${ringPct > 0 ? 1 : 0}"/>
            </svg>
            <span>${pct}%</span>
          </div>
        </div>
        <div class="goal-name">${g.name}</div>
        <div class="goal-amounts">
          <span>${formatCurrency(g.current)}€</span>
          <span>από ${formatCurrency(g.target)}€</span>
        </div>
        <div class="goal-progress">
          <div class="goal-progress-fill ${g.color}" style="width:${pct}%"></div>
        </div>
      </div>`;
    })
    .join("");

  html += `
    <button class="add-goal-btn" onclick="openGoalSheet()">
      ${icons.plus}
      <span>Προσθήκη Στόχου</span>
    </button>`;

  container.innerHTML = html;
}

// ---- UPCOMING PAYMENTS (embedded in Transactions view) ----
function renderUpcomingPayments() {
  const section = document.getElementById("upcoming-payments-section");
  if (!section) return;

  const pending = state.payments.filter((p) => p.status === "pending");
  if (pending.length === 0) {
    section.innerHTML = "";
    return;
  }

  // Sort: overdue first, then by due date ascending
  const sorted = [...pending].sort((a, b) => {
    const da = a.dueDate ? new Date(a.dueDate) : new Date(8640000000000000);
    const db = b.dueDate ? new Date(b.dueDate) : new Date(8640000000000000);
    return da - db;
  });

  const incomingTotal = sorted
    .filter((p) => p.type === "incoming")
    .reduce((s, p) => s + p.amount, 0);
  const outgoingTotal = sorted
    .filter((p) => p.type === "outgoing")
    .reduce((s, p) => s + p.amount, 0);

  section.innerHTML = `
    <div class="upcoming-payments-header" onclick="toggleUpcomingSection()">
      <div class="upcoming-payments-title">
        ${renderFaIcon("fa-solid fa-calendar-days", "fa-solid fa-calendar-days")}
        <span>Προγραμματισμένες Πληρωμές</span>
        <span class="upcoming-count">${sorted.length}</span>
      </div>
      <div class="upcoming-payments-summary">
        ${incomingTotal > 0 ? `<span class="upcoming-sum incoming">+${formatCurrency(incomingTotal)}€</span>` : ""}
        ${outgoingTotal > 0 ? `<span class="upcoming-sum outgoing">-${formatCurrency(outgoingTotal)}€</span>` : ""}
        <svg class="upcoming-chevron" id="upcoming-chevron" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><polyline points="6 9 12 15 18 9" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
    </div>
    <div class="upcoming-payments-list" id="upcoming-payments-list">
      ${sorted.map((p) => paymentCardHTML(p)).join("")}
    </div>`;
}

function toggleUpcomingSection() {
  const list = document.getElementById("upcoming-payments-list");
  const chevron = document.getElementById("upcoming-chevron");
  if (!list) return;
  const isOpen = list.classList.toggle("open");
  if (chevron) chevron.style.transform = isOpen ? "rotate(180deg)" : "";
}

function paymentCardHTML(p) {
  const isIncoming = p.type === "incoming";
  const isSettled = p.status === "settled";
  const dueDateLabel = p.dueDate
    ? new Date(p.dueDate).toLocaleDateString("el-GR", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
  const overdue = !isSettled && p.dueDate && new Date(p.dueDate) < new Date();

  return `
    <div class="payment-card ${isSettled ? "settled" : ""} ${overdue ? "overdue" : ""}" data-id="${p.id}">
      <div class="payment-card-icon">
        <div class="payment-direction-badge ${isIncoming ? "incoming" : "outgoing"}">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            ${
              isIncoming
                ? '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'
                : '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>'
            }
          </svg>
        </div>
      </div>
      <div class="payment-card-info">
        <div class="name">${p.name}</div>
        <div class="payment-due ${overdue ? "overdue-label" : ""}">
          ${overdue ? '<i class="fa-solid fa-circle-exclamation" style="font-size:11px;margin-right:3px"></i>' : ""}
          Λήξη: ${dueDateLabel}
        </div>
        ${p.note ? `<div class="payment-note">${p.note}</div>` : ""}
      </div>
      <div class="debt-card-right">
        <div class="debt-card-amount">
          <div class="amount ${isIncoming ? "lent" : "owe"}">${isIncoming ? "+" : "-"}${formatCurrency(p.amount)}€</div>
          <div class="date">${isSettled ? "Εξοφλήθηκε" : "Εκκρεμεί"}</div>
        </div>
        <div class="debt-card-actions">
          ${
            !isSettled
              ? `
          <button class="debt-action settle payment-settle-btn" onclick="settlePayment(${p.id}, event)" title="Εξόφληση">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </button>`
              : ""
          }
          <button class="debt-action edit" onclick="editPayment(${p.id}, event)" title="Επεξεργασία">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="debt-action delete" onclick="deletePayment(${p.id}, event)" title="Διαγραφή">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
    </div>`;
}

// ---- PAYMENT ACTIONS ----
function editPayment(id, event) {
  event.stopPropagation();
  const payment = state.payments.find((p) => p.id === id);
  if (!payment) return;

  // Reuse the add-sheet in future-payment edit mode
  state.editingPaymentId = id;
  state.addType = payment.type === "incoming" ? "income" : "expense";
  state.amountStr = String(payment.amount);
  state.selectedCategory = payment.category || null;
  state.isFuturePayment = true;
  state.scheduleMode = "future";
  state.editingRecurringId = null;
  state.recReturn = false;
  state.futurePaymentDueDate = payment.dueDate
    ? payment.dueDate.slice(0, 10)
    : "";

  const overlay = document.getElementById("add-sheet-overlay");
  overlay.classList.add("visible");
  state.addSheetOpen = true;

  const titleEl = document.getElementById("transaction-title");
  if (titleEl) {
    titleEl.value = payment.name;
  }
  const counter = document.getElementById("tx-title-counter");
  if (counter) counter.textContent = `${payment.name.length} / 40`;

  const dateInput = document.getElementById("future-payment-date");
  if (dateInput) dateInput.value = state.futurePaymentDueDate;

  const headerEl = document.querySelector(
    "#add-sheet-overlay .sheet-header h2",
  );
  if (headerEl) headerEl.textContent = "Επεξεργασία Πληρωμής";

  renderAddSheet();
  updateSaveButton();
}

async function deletePayment(id, event) {
  event.stopPropagation();
  const payment = state.payments.find((p) => p.id === id);
  if (!payment) return;
  await apiDelete(`/payments/${id}`).catch(() => null);
  state.payments = state.payments.filter((p) => p.id !== id);
  showToast("fa-solid fa-trash", `Διαγράφηκε: ${payment.name}`);
  renderUpcomingPayments();
}

async function settlePayment(id, event) {
  event.stopPropagation();
  const payment = state.payments.find((p) => p.id === id);
  if (!payment) return;

  const data = await apiPost(`/payments/${id}/settle`, {}).catch(() => null);
  if (!data) return;

  const idx = state.payments.findIndex((p) => p.id === id);
  if (idx !== -1) state.payments[idx] = data.payment;
  state.transactions.unshift(data.transaction);
  state.balance = data.balance;
  schedMarkPaymentSeen(id);

  const icon =
    payment.type === "incoming"
      ? "fa-solid fa-circle-arrow-down"
      : "fa-solid fa-circle-arrow-up";
  showToast(
    icon,
    `Εξοφλήθηκε: ${payment.name} — ${payment.type === "incoming" ? "+" : "-"}${formatCurrency(payment.amount)}€`,
  );
  renderUpcomingPayments();
  renderBalanceCard();
}

// ---- DEBTS VIEW ----
function renderDebts() {
  renderDebtSummary();
  renderDebtTabs();
  renderDebtList();
}

function renderDebtSummary() {
  const owed = state.debts
    .filter((d) => d.type === "owe")
    .reduce((s, d) => s + d.amount, 0);
  const lent = state.debts
    .filter((d) => d.type === "lent")
    .reduce((s, d) => s + d.amount, 0);
  const net = lent - owed;

  const oweEl = document.getElementById("total-owed");
  const lentEl = document.getElementById("total-lent");
  if (oweEl) oweEl.textContent = `${formatCurrency(owed)}€`;
  if (lentEl) lentEl.textContent = `${formatCurrency(lent)}€`;

  // Net balance hero
  const netEl = document.getElementById("dbt-net");
  const captionEl = document.getElementById("dbt-net-caption");
  if (netEl) {
    const sign = net > 0 ? "+" : net < 0 ? "-" : "";
    netEl.textContent = `${sign}${formatCurrency(Math.abs(net))}€`;
    netEl.classList.toggle("pos", net > 0);
    netEl.classList.toggle("neg", net < 0);
  }
  if (captionEl) {
    captionEl.textContent =
      net > 0
        ? "Συνολικά σου χρωστούν περισσότερα"
        : net < 0
          ? "Συνολικά χρωστάς περισσότερα"
          : owed === 0 && lent === 0
            ? "Δεν υπάρχουν εκκρεμότητες"
            : "Τα χρέη ισοφαρίζονται";
  }

  // Owe / lent proportion bar
  const total = owed + lent;
  const oweBar = document.getElementById("dbt-split-owe");
  const lentBar = document.getElementById("dbt-split-lent");
  if (oweBar) oweBar.style.width = total ? `${(owed / total) * 100}%` : "0%";
  if (lentBar) lentBar.style.width = total ? `${(lent / total) * 100}%` : "0%";

  // Counts on the filter tabs
  const oweCount = state.debts.filter((d) => d.type === "owe").length;
  const lentCount = state.debts.filter((d) => d.type === "lent").length;
  const oweCountEl = document.getElementById("dbt-count-owe");
  const lentCountEl = document.getElementById("dbt-count-lent");
  if (oweCountEl) oweCountEl.textContent = oweCount;
  if (lentCountEl) lentCountEl.textContent = lentCount;
}

function renderDebtTabs() {
  document.querySelectorAll(".dbt-tab").forEach((el) => {
    el.classList.toggle("active", el.dataset.tab === state.debtViewTab);
  });
}

function renderDebtList() {
  const container = document.getElementById("debt-list");
  if (!container) return;

  const isOwe = state.debtViewTab === "owe";
  const filtered = state.debts.filter((d) => d.type === state.debtViewTab);

  const titleEl = document.getElementById("dbt-list-title");
  if (titleEl) {
    const n = filtered.length;
    titleEl.textContent = `${isOwe ? "Χρωστάω" : "Μου Χρωστούν"} · ${n} ${n === 1 ? "εγγραφή" : "εγγραφές"}`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${renderFaIcon(isOwe ? "fa-solid fa-face-smile-beam" : "fa-solid fa-money-bill-wave", "fa-solid fa-circle-check")}</div>
        <p>${isOwe ? "Δεν χρωστάς σε κανέναν" : "Κανείς δεν σου χρωστάει"}</p>
      </div>`;
    return;
  }

  container.innerHTML = filtered
    .map(
      (d) => `
    <div class="dbt-card ${d.type}" data-id="${d.id}" onclick="toggleDebtCard(${d.id})">
      <div class="dbt-card-main">
        <div class="dbt-avatar" style="background:${escapeHtml(d.color || "#8B7D6B")}">${escapeHtml(d.initial || "?")}</div>
        <div class="dbt-info">
          <div class="dbt-name">${escapeHtml(d.name)}</div>
          <div class="dbt-reason">${escapeHtml(d.reason || "")}</div>
        </div>
        <div class="dbt-amount-col">
          <div class="dbt-amount ${d.type}">${d.type === "owe" ? "-" : "+"}${formatCurrency(d.amount)}€</div>
          <div class="dbt-date">${formatDate(d.date)}</div>
        </div>
      </div>
      <div class="dbt-actions">
        <div class="dbt-actions-clip">
          <div class="dbt-actions-row">
            <button class="dbt-act edit" type="button" onclick="editDebt(${d.id}, event)">
              <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Επεξεργασία
            </button>
            <button class="dbt-act delete" type="button" onclick="deleteDebt(${d.id}, event)">
              <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
              Διαγραφή
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
    )
    .join("");
}

// Tap a debt card to reveal its actions (only one open at a time)
function toggleDebtCard(id) {
  document.querySelectorAll("#debt-list .dbt-card").forEach((el) => {
    if (el.dataset.id === String(id)) el.classList.toggle("open");
    else el.classList.remove("open");
  });
}

// ---- ADD TRANSACTION SHEET ----
// mode: "now" (default) | "future" | "recurring". (Also used directly as a click
// handler, so anything that isn't one of those strings means "now".)
function openAddSheet(mode) {
  const initialMode =
    mode === "future" || mode === "recurring" ? mode : "now";
  state.addSheetOpen = true;
  state.amountStr = "";
  state.selectedCategory = null;
  state.addType = "expense";
  state.scheduleMode = initialMode;
  state.isFuturePayment = initialMode === "future";
  state.futurePaymentDueDate = "";
  state.editingPaymentId = null;
  state.editingRecurringId = null;
  state.recReturn = false;
  state.rec = recDefaults();

  const overlay = document.getElementById("add-sheet-overlay");
  overlay.classList.add("visible");

  // Reset title field
  const titleEl = document.getElementById("transaction-title");
  if (titleEl) {
    titleEl.value = "";
    titleEl.blur();
  }
  const counter = document.getElementById("tx-title-counter");
  if (counter) counter.textContent = "0 / 40";

  // Reset future-payment UI
  const dateInput = document.getElementById("future-payment-date");
  if (dateInput) dateInput.value = "";
  const headerEl = overlay.querySelector(".sheet-header h2");
  if (headerEl) headerEl.textContent = "Νέα Συναλλαγή";

  renderAddSheet();
}

function closeAddSheet() {
  state.addSheetOpen = false;
  state.editingPaymentId = null;
  state.editingRecurringId = null;
  const overlay = document.getElementById("add-sheet-overlay");
  overlay.classList.remove("visible");
  // Restore sheet title in case it was changed for editing
  const headerEl = overlay.querySelector(".sheet-header h2");
  if (headerEl) headerEl.textContent = "Νέα Συναλλαγή";
  // Came here from the recurring list: go back to it
  if (state.recReturn) {
    state.recReturn = false;
    openRecurringSheet();
  }
}

function renderAddSheet() {
  renderTypeToggle();
  renderAmountDisplay();
  renderCategoryPicker();
  renderScheduleMode();
  updateSaveButton();
}

function renderTypeToggle() {
  document.querySelectorAll(".type-toggle button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.type === state.addType);
  });
  // Stamp data attribute so CSS can color-code the active pill
  const toggle = document.querySelector(".type-toggle");
  if (toggle) toggle.dataset.activeType = state.addType;

  renderCategoryPicker();
  renderAmountDisplay(); // keep amount color in sync
}

function renderAmountDisplay() {
  const el = document.getElementById("amount-value");
  if (el) el.textContent = state.amountStr || "0";
  // Color-code the entire amount display by transaction type
  const display = document.querySelector(".amount-display");
  if (display) display.dataset.txType = state.addType;
}

function renderCategoryPicker() {
  const container = document.getElementById("category-grid");
  if (!container) return;

  const cats = categories[state.addType];
  container.innerHTML = cats
    .map(
      (c) => `
    <div class="category-item ${state.selectedCategory === c.id ? "selected" : ""}" data-cat="${c.id}">
      <div class="cat-icon" style="background:${c.bg}">${renderFaIcon(c.icon, "fa-solid fa-tag")}</div>
      <div class="cat-name">${c.name}</div>
    </div>
  `,
    )
    .join("");

  container.querySelectorAll(".category-item").forEach((el) => {
    el.addEventListener("click", () => {
      state.selectedCategory = el.dataset.cat;
      document.getElementById("transaction-title").value = getCategoryInfo(
        state.selectedCategory,
      ).name; // Auto-fill title with category name
      document
        .getElementById("transaction-title")
        .setAttribute("data-auto-filled", "true");
      renderCategoryPicker();
      updateSaveButton();
    });
  });
}

function handleNumpad(key) {
  if (key === "delete") {
    state.amountStr = state.amountStr.slice(0, -1);
  } else if (key === ".") {
    if (!state.amountStr.includes(".")) {
      state.amountStr += state.amountStr ? "." : "0.";
    }
  } else {
    // Limit decimal places to 2
    const parts = state.amountStr.split(".");
    if (parts[1] && parts[1].length >= 2) return;
    // Limit total length
    if (state.amountStr.replace(".", "").length >= 7) return;
    state.amountStr += key;
  }

  renderAmountDisplay();
  updateSaveButton();
}

function updateSaveButton() {
  const btn = document.getElementById("save-transaction-btn");
  if (!btn) return;
  const amount = parseFloat(state.amountStr);
  const title = (
    document.getElementById("transaction-title")?.value ?? ""
  ).trim();
  const ready = !!(
    amount > 0 &&
    state.selectedCategory &&
    title &&
    (state.scheduleMode !== "recurring" || recIsValid())
  );
  const wasReady = !btn.disabled;

  btn.disabled = !ready;

  // Pulse the button the moment all three conditions are first satisfied
  if (ready && !wasReady) {
    btn.classList.remove("just-enabled");
    void btn.offsetWidth; // reflow
    btn.classList.add("just-enabled");
    btn.addEventListener(
      "animationend",
      () => btn.classList.remove("just-enabled"),
      { once: true },
    );
  }
}

async function saveTransaction() {
  const amount = parseFloat(state.amountStr);
  if (!amount || !state.selectedCategory) return;

  const cat = getCategoryInfo(state.selectedCategory);
  const title = (
    document.getElementById("transaction-title")?.value ?? ""
  ).trim();

  // ── Recurring path ──
  if (state.scheduleMode === "recurring") {
    await saveRecurring(title, cat, amount);
    return;
  }

  // ── Future payment path ──
  if (state.isFuturePayment) {
    const dueDateEl = document.getElementById("future-payment-date");
    const dueDate = dueDateEl ? dueDateEl.value : "";
    const paymentType = state.addType === "income" ? "incoming" : "outgoing";

    const payload = {
      name: title || cat.name,
      category: state.selectedCategory,
      type: paymentType,
      amount,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      note: title,
      date: new Date().toISOString(),
    };

    if (state.editingPaymentId) {
      const updated = await apiPut(
        `/payments/${state.editingPaymentId}`,
        payload,
      ).catch(() => null);
      if (!updated) return;
      const idx = state.payments.findIndex(
        (p) => p.id === state.editingPaymentId,
      );
      if (idx !== -1) state.payments[idx] = updated;
      schedMarkPaymentSeenIfDue(updated);
      closeAddSheet();
      showToast("fa-solid fa-circle-check", `Ενημερώθηκε: ${updated.name}`);
    } else {
      const payment = await apiPost("/payments", payload).catch(() => null);
      if (!payment) return;
      state.payments.unshift(payment);
      schedMarkPaymentSeenIfDue(payment);
      closeAddSheet();
      const icon =
        paymentType === "incoming"
          ? "fa-solid fa-calendar-check"
          : "fa-solid fa-calendar-xmark";
      showToast(
        icon,
        `Προγραμματίστηκε: ${payment.name} — ${paymentType === "incoming" ? "+" : "-"}${formatCurrency(amount)}€`,
      );
    }

    renderView(state.currentView);
    return;
  }

  // ── Regular transaction path ──
  const payload = {
    name: title || cat.name,
    category: state.selectedCategory,
    type: state.addType,
    amount,
    date: new Date().toISOString(),
    note: title,
  };

  const data = await apiPost("/transactions", payload).catch(() => null);
  if (!data) return;

  state.transactions.unshift(data.transaction);
  state.balance = data.balance;

  closeAddSheet();

  const sign = state.addType === "expense" ? "-" : "+";
  const icon =
    state.addType === "expense"
      ? "fa-solid fa-money-bill-trend-up"
      : "fa-solid fa-sack-dollar";
  showToast(
    icon,
    `${data.transaction.name} — ${sign}${formatCurrency(amount)}€`,
  );

  renderView(state.currentView);
}

// ---- RECURRING TRANSACTIONS ----
const REC_PRESETS = {
  day: { unit: "day", interval: 1 },
  week: { unit: "week", interval: 1 },
  biweek: { unit: "week", interval: 2 },
  month: { unit: "month", interval: 1 },
  quarter: { unit: "month", interval: 3 },
  year: { unit: "year", interval: 1 },
};
const REC_UNIT_LABELS = {
  day: "μέρες",
  week: "εβδομάδες",
  month: "μήνες",
  year: "χρόνια",
};
const REC_SINGULAR = {
  day: "Κάθε μέρα",
  week: "Κάθε εβδομάδα",
  month: "Κάθε μήνα",
  year: "Κάθε χρόνο",
};

function recDefaults() {
  return {
    preset: "month",
    unit: "month",
    interval: 1,
    startDate: toDayKey(new Date()),
    hasEnd: false,
    endDate: "",
  };
}

function recFrequencyText(unit, interval) {
  const n = Number(interval);
  if (n === 1) return REC_SINGULAR[unit] || "";
  return `Κάθε ${n} ${REC_UNIT_LABELS[unit] || ""}`.trim();
}

function recPresetFor(unit, interval) {
  const hit = Object.keys(REC_PRESETS).find(
    (k) => REC_PRESETS[k].unit === unit && REC_PRESETS[k].interval === interval,
  );
  return hit || "custom";
}

function isValidDayKey(s) {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    toDayKey(fromDayKey(s)) === s
  );
}

function recFormatDay(key) {
  const d = fromDayKey(key);
  const opts = { day: "numeric", month: "long" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("el-GR", opts);
}

function recValidationMessage() {
  const r = state.rec;
  if (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > 999)
    return "Το διάστημα πρέπει να είναι τουλάχιστον 1.";
  if (!isValidDayKey(r.startDate)) return "Διάλεξε ημερομηνία έναρξης.";
  if (!state.editingRecurringId && r.startDate < toDayKey(new Date()))
    return "Η έναρξη δεν μπορεί να είναι στο παρελθόν.";
  if (r.hasEnd) {
    if (!isValidDayKey(r.endDate)) return "Διάλεξε ημερομηνία λήξης.";
    if (r.endDate < r.startDate)
      return "Η λήξη πρέπει να είναι μετά την έναρξη.";
  }
  return "";
}

function recIsValid() {
  return recValidationMessage() === "";
}

function recSummaryText() {
  const r = state.rec;
  const parts = [recFrequencyText(r.unit, r.interval)];
  if (isValidDayKey(r.startDate)) {
    parts.push(
      r.startDate === toDayKey(new Date())
        ? "Πρώτη πληρωμή σήμερα"
        : `Έναρξη ${recFormatDay(r.startDate)}`,
    );
  }
  if (r.hasEnd && isValidDayKey(r.endDate) && r.endDate >= r.startDate) {
    parts.push(`Μέχρι ${recFormatDay(r.endDate)}`);
  }
  return parts.join(" • ");
}

function renderRecurringPanel() {
  const panel = document.getElementById("recurring-panel");
  if (!panel) return;
  const active = state.scheduleMode === "recurring";
  panel.hidden = !active;
  if (!active) return;

  const r = state.rec;
  panel.querySelectorAll(".rec-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.preset === r.preset);
  });

  const custom = document.getElementById("rec-custom");
  if (custom) custom.hidden = r.preset !== "custom";
  const intervalEl = document.getElementById("rec-interval");
  if (intervalEl && document.activeElement !== intervalEl) {
    intervalEl.value = Number.isFinite(r.interval) ? String(r.interval) : "";
  }
  const unitEl = document.getElementById("rec-unit");
  if (unitEl) unitEl.value = r.unit;

  const editingRule = state.editingRecurringId
    ? state.recurring.find((x) => x.id === state.editingRecurringId)
    : null;
  const startLocked = !!(editingRule && editingRule.lastRunDate);
  const startEl = document.getElementById("rec-start");
  if (startEl) {
    startEl.value = r.startDate || "";
    startEl.disabled = startLocked;
    if (state.editingRecurringId) startEl.removeAttribute("min");
    else startEl.min = toDayKey(new Date());
  }
  const startHint = document.getElementById("rec-start-hint");
  if (startHint) startHint.hidden = !startLocked;

  const endSwitch = document.getElementById("rec-end-switch");
  if (endSwitch) endSwitch.classList.toggle("on", r.hasEnd);
  const endToggle = document.getElementById("rec-end-toggle");
  if (endToggle) endToggle.setAttribute("aria-checked", String(r.hasEnd));
  const endRow = document.getElementById("rec-end-row");
  if (endRow) endRow.hidden = !r.hasEnd;
  const endEl = document.getElementById("rec-end");
  if (endEl) {
    endEl.value = r.endDate || "";
    if (r.startDate) endEl.min = r.startDate;
    else endEl.removeAttribute("min");
  }

  const summary = document.getElementById("rec-summary");
  if (summary) {
    const msg = recValidationMessage();
    summary.textContent = msg || recSummaryText();
    summary.classList.toggle("error", !!msg);
  }
}

function setScheduleMode(mode) {
  state.scheduleMode = mode;
  state.isFuturePayment = mode === "future";
  renderScheduleMode();
  updateSaveButton();
}

function renderScheduleMode() {
  const mode = state.scheduleMode;
  const editing = !!(state.editingPaymentId || state.editingRecurringId);

  const toggle = document.getElementById("schedule-toggle");
  if (toggle) {
    // While editing an existing payment / rule the mode is fixed: hide the switcher
    toggle.hidden = editing;
    toggle.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === mode);
    });
  }

  const dateWrap = document.getElementById("future-payment-date-wrap");
  if (dateWrap) dateWrap.classList.toggle("visible", mode === "future");

  renderRecurringPanel();

  const saveBtn = document.getElementById("save-transaction-btn");
  if (saveBtn) {
    saveBtn.textContent =
      mode === "future"
        ? "Προγραμματισμός Πληρωμής"
        : mode === "recurring"
          ? state.editingRecurringId
            ? "Αποθήκευση"
            : "Προσθήκη Επανάληψης"
          : "Προσθήκη Συναλλαγής";
  }
}

function initRecurringFormEvents() {
  const toggle = document.getElementById("schedule-toggle");
  if (toggle) {
    toggle.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => setScheduleMode(btn.dataset.mode));
    });
  }

  const refresh = () => {
    renderRecurringPanel();
    updateSaveButton();
  };

  document.querySelectorAll("#rec-preset-chips .rec-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const key = chip.dataset.preset;
      state.rec.preset = key;
      if (REC_PRESETS[key]) {
        state.rec.unit = REC_PRESETS[key].unit;
        state.rec.interval = REC_PRESETS[key].interval;
      }
      refresh();
    });
  });

  const intervalEl = document.getElementById("rec-interval");
  if (intervalEl) {
    intervalEl.addEventListener("input", () => {
      state.rec.interval =
        intervalEl.value === "" ? NaN : Number(intervalEl.value);
      refresh();
    });
    intervalEl.addEventListener("blur", () => {
      const n = state.rec.interval;
      if (!Number.isInteger(n) || n < 1) state.rec.interval = 1;
      refresh();
    });
    intervalEl.addEventListener("keydown", (e) => e.stopPropagation());
  }

  const unitEl = document.getElementById("rec-unit");
  if (unitEl) {
    unitEl.addEventListener("change", () => {
      state.rec.unit = unitEl.value;
      refresh();
    });
  }

  const startEl = document.getElementById("rec-start");
  if (startEl) {
    const onStart = () => {
      state.rec.startDate = startEl.value;
      refresh();
    };
    startEl.addEventListener("input", onStart);
    startEl.addEventListener("change", onStart);
    startEl.addEventListener("keydown", (e) => e.stopPropagation());
  }

  const endEl = document.getElementById("rec-end");
  if (endEl) {
    const onEnd = () => {
      state.rec.endDate = endEl.value;
      refresh();
    };
    endEl.addEventListener("input", onEnd);
    endEl.addEventListener("change", onEnd);
    endEl.addEventListener("keydown", (e) => e.stopPropagation());
  }

  const endToggle = document.getElementById("rec-end-toggle");
  if (endToggle) {
    const flip = () => {
      state.rec.hasEnd = !state.rec.hasEnd;
      refresh();
    };
    endToggle.addEventListener("click", flip);
    endToggle.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        flip();
      }
    });
  }
}

// Merges a create/update/delete response into local state
function applyRecurringResponse(data) {
  if (!data) return;
  if (data.rule) {
    const idx = state.recurring.findIndex((r) => r.id === data.rule.id);
    if (idx !== -1) state.recurring[idx] = data.rule;
    else state.recurring.unshift(data.rule);
    // The person did this themselves - never celebrate it as a "new" occurrence
    schedMarkRuleKnown(data.rule);
  }
  if (Array.isArray(data.created)) {
    data.created.forEach((tx) => {
      if (!state.transactions.some((t) => t.id === tx.id))
        state.transactions.unshift(tx);
    });
  }
  if (data.balance !== undefined) state.balance = data.balance;
}

async function saveRecurring(title, cat, amount) {
  if (!recIsValid()) return;
  const r = state.rec;
  const payload = {
    name: title || cat.name,
    category: state.selectedCategory,
    type: state.addType,
    amount,
    note: title,
    unit: r.unit,
    interval: r.interval,
    startDate: r.startDate,
    endDate: r.hasEnd ? r.endDate : null,
  };
  const q = `?today=${toDayKey(new Date())}`;

  if (state.editingRecurringId) {
    const data = await apiPut(
      `/recurring/${state.editingRecurringId}${q}`,
      payload,
    ).catch(() => null);
    if (!data) return;
    applyRecurringResponse(data);
    closeAddSheet();
    showToast("fa-solid fa-circle-check", `Ενημερώθηκε: ${data.rule.name}`);
  } else {
    const data = await apiPost(`/recurring${q}`, payload).catch(() => null);
    if (!data) return;
    applyRecurringResponse(data);
    closeAddSheet();
    const sign = payload.type === "expense" ? "-" : "+";
    showToast(
      "fa-solid fa-rotate",
      `${data.rule.name} — ${sign}${formatCurrency(amount)}€ • ${recFrequencyText(r.unit, r.interval)}`,
    );
  }

  renderRecurringEntry();
  renderView(state.currentView);
}

// ---- RECURRING LIST (entry point + sheet) ----
function renderRecurringEntry() {
  // Only show the button on the Συναλλαγές tab when at least one recurring rule exists
  const btn = document.getElementById("recurring-entry-btn");
  if (btn) btn.style.display = state.recurring.length > 0 ? "" : "none";

  const el = document.getElementById("recurring-entry-value");
  if (!el) return;
  const n = state.recurring.filter((r) => r.active && !r.finished).length;
  el.textContent = n > 0 ? `${n} ενεργά` : "";
}

function openRecurringSheet() {
  const overlay = document.getElementById("recurring-sheet-overlay");
  if (!overlay) return;
  renderRecurringList();
  overlay.classList.add("visible");
}

function closeRecurringSheet() {
  const overlay = document.getElementById("recurring-sheet-overlay");
  if (overlay) overlay.classList.remove("visible");
}

function addRecurringFromList() {
  closeRecurringSheet();
  openAddSheet("recurring");
  state.recReturn = true;
}

function recCardHTML(r) {
  const income = r.type === "income";
  const paused = !r.active && !r.finished;
  const status = r.finished
    ? "Ολοκληρώθηκε"
    : paused
      ? "Σε παύση"
      : `Επόμενη: ${recFormatDay(r.nextDate)}`;
  const freq =
    recFrequencyText(r.unit, r.interval) +
    (r.endDate ? ` • Μέχρι ${recFormatDay(r.endDate)}` : "");
  const arrow = income
    ? '<path d="M12 5v14M5 12l7 7 7-7" />'
    : '<path d="M12 19V5M5 12l7-7 7 7" />';
  return `
    <div class="rec-card ${paused ? "paused" : ""} ${r.finished ? "finished" : ""}" data-id="${r.id}">
      <div class="rec-card-top">
        <div class="payment-card-icon">
          <div class="payment-direction-badge ${income ? "incoming" : "outgoing"}">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">${arrow}</svg>
          </div>
        </div>
        <div class="payment-card-info">
          <div class="name">${escapeHtml(r.name)}</div>
          <div class="payment-due">${escapeHtml(freq)}</div>
          <div class="payment-due rec-status ${paused ? "paused" : ""}">${status}</div>
        </div>
        <div class="rec-amount ${income ? "pos" : "neg"}">${income ? "+" : "-"}${formatCurrency(r.amount)}€</div>
      </div>
      <div class="rec-actions">
        ${
          r.finished
            ? ""
            : `<button type="button" class="rec-action-btn" onclick="toggleRecurringActive(${r.id})">${r.active ? "Παύση" : "Συνέχεια"}</button>`
        }
        <button type="button" class="rec-action-btn" onclick="editRecurring(${r.id})">Επεξεργασία</button>
        <button type="button" class="rec-action-btn danger" onclick="deleteRecurring(${r.id}, this)">Διαγραφή</button>
      </div>
    </div>`;
}

function renderRecurringList() {
  const el = document.getElementById("recurring-list");
  if (!el) return;
  if (state.recurring.length === 0) {
    el.innerHTML = `<div class="rec-empty">Δεν έχεις επαναλαμβανόμενες συναλλαγές ακόμη.</div>`;
    return;
  }
  const rank = (r) => (r.finished ? 2 : !r.active ? 1 : 0);
  const sorted = [...state.recurring].sort(
    (a, b) =>
      rank(a) - rank(b) || String(a.nextDate).localeCompare(String(b.nextDate)),
  );
  el.innerHTML = sorted.map(recCardHTML).join("");
}

function recRefreshAfterChange() {
  renderRecurringList();
  renderRecurringEntry();
  renderView(state.currentView);
}

async function toggleRecurringActive(id) {
  const rule = state.recurring.find((r) => r.id === id);
  if (!rule) return;
  const data = await apiPut(`/recurring/${id}?today=${toDayKey(new Date())}`, {
    active: !rule.active,
  }).catch(() => null);
  if (!data) return;
  applyRecurringResponse(data);
  recRefreshAfterChange();
  showToast(
    data.rule.active ? "fa-solid fa-play" : "fa-solid fa-pause",
    `${data.rule.active ? "Συνεχίστηκε" : "Παύση"}: ${data.rule.name}`,
  );
}

function editRecurring(id) {
  const rule = state.recurring.find((r) => r.id === id);
  if (!rule) return;

  closeRecurringSheet();
  state.editingPaymentId = null;
  state.editingRecurringId = id;
  state.addType = rule.type;
  state.amountStr = String(rule.amount);
  state.selectedCategory = rule.category || null;
  state.scheduleMode = "recurring";
  state.isFuturePayment = false;
  state.rec = {
    preset: recPresetFor(rule.unit, rule.interval),
    unit: rule.unit,
    interval: rule.interval,
    startDate: rule.startDate,
    hasEnd: !!rule.endDate,
    endDate: rule.endDate || "",
  };

  const overlay = document.getElementById("add-sheet-overlay");
  overlay.classList.add("visible");
  state.addSheetOpen = true;
  state.recReturn = true;

  const titleEl = document.getElementById("transaction-title");
  if (titleEl) titleEl.value = rule.name;
  const counter = document.getElementById("tx-title-counter");
  if (counter) counter.textContent = `${rule.name.length} / 40`;
  const headerEl = overlay.querySelector(".sheet-header h2");
  if (headerEl) headerEl.textContent = "Επεξεργασία Επανάληψης";

  renderAddSheet();
}

async function deleteRecurring(id, btn) {
  // Two-tap confirmation so a stray tap can't remove a rule
  if (btn && btn.dataset.armed !== "1") {
    btn.dataset.armed = "1";
    btn.textContent = "Πάτα ξανά";
    setTimeout(() => {
      if (btn.isConnected) {
        btn.dataset.armed = "";
        btn.textContent = "Διαγραφή";
      }
    }, 3000);
    return;
  }
  const rule = state.recurring.find((r) => r.id === id);
  if (!rule) return;
  const data = await apiDelete(
    `/recurring/${id}?today=${toDayKey(new Date())}`,
  ).catch(() => null);
  if (!data) return;
  state.recurring = state.recurring.filter((r) => r.id !== id);
  applyRecurringResponse(data);
  recRefreshAfterChange();
  showToast(
    "fa-solid fa-trash",
    `Διαγράφηκε: ${rule.name} (οι συναλλαγές παραμένουν)`,
  );
}

// ---- DEBT SHEET ----
function openDebtSheet(debt = null) {
  state.debtSheetOpen = true;
  state.editingDebtId = debt ? debt.id : null;
  state.debtType = debt ? debt.type : "owe";

  const overlay = document.getElementById("debt-sheet-overlay");
  const header = overlay.querySelector(".sheet-header h2");
  const saveBtn = overlay.querySelector(".save-btn");
  if (header)
    header.textContent = debt ? "Επεξεργασία Χρέους" : "Προσθήκη Χρέους";
  if (saveBtn) saveBtn.textContent = debt ? "Αποθήκευση" : "Προσθήκη Χρέους";

  const nameEl = document.getElementById("debt-name");
  const amountEl = document.getElementById("debt-amount");
  const reasonEl = document.getElementById("debt-reason");
  if (nameEl) nameEl.value = debt ? debt.name : "";
  if (amountEl) amountEl.value = debt ? debt.amount : "";
  if (reasonEl)
    reasonEl.value = debt && debt.reason !== "Χωρίς αιτία" ? debt.reason : "";

  overlay.classList.add("visible");
  renderDebtTypeToggle();
}

function closeDebtSheet() {
  state.debtSheetOpen = false;
  state.editingDebtId = null;
  const overlay = document.getElementById("debt-sheet-overlay");
  overlay.classList.remove("visible");
}

function renderDebtTypeToggle() {
  document.querySelectorAll(".debt-type-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.type === state.debtType);
  });
}

async function saveDebt() {
  const nameEl = document.getElementById("debt-name");
  const amountEl = document.getElementById("debt-amount");
  const reasonEl = document.getElementById("debt-reason");

  const name = nameEl ? nameEl.value.trim() : "";
  const amount = amountEl ? parseFloat(amountEl.value) : 0;
  const reason = reasonEl ? reasonEl.value.trim() : "";

  if (!name || !amount) {
    showToast("fa-solid fa-triangle-exclamation", "Συμπλήρωσε όνομα και ποσό");
    return;
  }

  if (state.editingDebtId) {
    const updated = await apiPut(`/debts/${state.editingDebtId}`, {
      name,
      initial: name.charAt(0).toUpperCase(),
      type: state.debtType,
      amount,
      reason: reason || "Χωρίς αιτία",
    }).catch(() => null);
    if (!updated) return;

    const idx = state.debts.findIndex((d) => d.id === state.editingDebtId);
    if (idx !== -1) state.debts[idx] = updated;

    closeDebtSheet();
    showToast("fa-solid fa-circle-check", `Ενημερώθηκε ${name}`);
    renderDebts();
    renderPeopleRow();
    return;
  }

  const colors = [
    "#FF9500",
    "#AF52DE",
    "#5AC8FA",
    "#FF2D55",
    "#30D158",
    "#007AFF",
    "#FFCC00",
    "#5856D6",
  ];

  const debt = await apiPost("/debts", {
    name,
    initial: name.charAt(0).toUpperCase(),
    type: state.debtType,
    amount,
    reason: reason || "Χωρίς αιτία",
    date: new Date().toISOString(),
    color: colors[Math.floor(Math.random() * colors.length)],
  }).catch(() => null);
  if (!debt) return;

  state.debts.push(debt);
  closeDebtSheet();
  showToast(
    "fa-solid fa-circle-check",
    `${state.debtType === "owe" ? "Χρέος" : "Δάνειο"} προστέθηκε για ${name}`,
  );
  renderDebts();
  renderPeopleRow();

  if (nameEl) nameEl.value = "";
  if (amountEl) amountEl.value = "";
  if (reasonEl) reasonEl.value = "";
}

function editDebt(id, event) {
  event.stopPropagation();
  const debt = state.debts.find((d) => d.id === id);
  if (!debt) return;
  openDebtSheet(debt);
}

async function deleteDebt(id, event) {
  event.stopPropagation();
  const debt = state.debts.find((d) => d.id === id);
  if (!debt) return;

  await apiDelete(`/debts/${id}`).catch(() => null);

  state.debts = state.debts.filter((d) => d.id !== id);
  showToast("fa-solid fa-trash", `Διαγράφηκε ${debt.name}`);
  renderDebts();
  renderPeopleRow();
}

// ---- GOAL SHEET ----
function openGoalSheet() {
  state.goalSheetOpen = true;
  const overlay = document.getElementById("goal-sheet-overlay");
  const iconInput = document.getElementById("goal-icon-input");
  if (iconInput && !iconInput.value.trim()) {
    iconInput.value = "fa-solid fa-bullseye";
  }
  updateGoalIconPreview();
  overlay.classList.add("visible");
}

function closeGoalSheet() {
  state.goalSheetOpen = false;
  const overlay = document.getElementById("goal-sheet-overlay");
  overlay.classList.remove("visible");
  closeFaIconPicker();
}

async function saveGoal() {
  const nameEl = document.getElementById("goal-name-input");
  const targetEl = document.getElementById("goal-target-input");
  const iconEl = document.getElementById("goal-icon-input");

  const name = nameEl ? nameEl.value.trim() : "";
  const target = targetEl ? parseFloat(targetEl.value) : 0;
  const icon = sanitizeFaClass(
    iconEl ? iconEl.value : "",
    "fa-solid fa-bullseye",
  );

  if (!name || !target) {
    showToast("fa-solid fa-triangle-exclamation", "Συμπλήρωσε όνομα και στόχο");
    return;
  }

  const colors = ["green", "blue", "orange", "purple"];

  const goal = await apiPost("/goals", {
    name,
    icon,
    target,
    current: 0,
    color: colors[state.savingsGoals.length % colors.length],
  }).catch(() => null);
  if (!goal) return;

  state.savingsGoals.push(goal);
  closeGoalSheet();
  showToast("fa-solid fa-bullseye", `Ο στόχος "${name}" δημιουργήθηκε`);
  renderGoals();

  if (nameEl) nameEl.value = "";
  if (targetEl) targetEl.value = "";
  if (iconEl) iconEl.value = "fa-solid fa-bullseye";
  updateGoalIconPreview();
}

// ---- SAVINGS TRANSFER ----
async function handleTransfer() {
  const direction =
    state.savingsTransferSource === "savings" ? "withdraw" : "save";
  return processSavingsTransfer(direction);
}

async function processSavingsTransfer(direction) {
  const inputEl = document.getElementById("transfer-amount");
  const amount = inputEl ? parseFloat(inputEl.value) : 0;
  if (!amount || amount <= 0) return;

  const fromSavings = direction === "withdraw";
  const sourceBalance = fromSavings ? state.savings : state.balance;
  if (amount > sourceBalance) {
    showToast(
      "fa-solid fa-triangle-exclamation",
      fromSavings ? "Ανεπαρκείς αποταμιεύσεις" : "Ανεπαρκές υπόλοιπο",
    );
    return;
  }

  const data = await apiPost("/transfer", { amount, direction }).catch(
    () => null,
  );
  if (!data) return;

  state.balance = data.balance;
  state.savings = data.savings;
  state.savingsGoals = data.goals || state.savingsGoals;

  recordSavingsSnapshot();
  animateTransfer(direction);
  showToast(
    "fa-solid fa-arrow-right-arrow-left",
    direction === "save"
      ? `${formatCurrency(amount)}€ μεταφέρθηκαν στις αποταμιεύσεις`
      : `${formatCurrency(amount)}€ επιστράφηκαν στο κύριο`,
  );

  const slider = document.getElementById("transfer-slider");
  if (slider) slider.value = 0;
  if (inputEl) inputEl.value = "";
  renderSavings();
  renderBalanceCard();
}

// ---- TRANSACTION DETAIL ----
function showTransactionDetail(id) {
  const tx = state.transactions.find((t) => t.id === id);
  if (!tx) return;

  const cat = getCategoryInfo(tx.category);
  const modal = document.getElementById("transaction-detail-modal");
  if (!modal) return;

  const isExpense = tx.type === "expense";

  modal.querySelector(".glass-modal-content").innerHTML = `
    <div style="text-align:center;margin-bottom:20px">
      <div style="font-size:34px;margin-bottom:12px;line-height:1">${renderFaIcon(cat.icon, "fa-solid fa-tag")}</div>
      <div style="font-size:24px;font-weight:700;margin-bottom:4px;color:${isExpense ? "var(--text-primary)" : "var(--green)"}">
        ${isExpense ? "-" : "+"}${formatCurrency(tx.amount)}€
      </div>
      <div style="font-size:15px;color:var(--text-secondary)">${tx.name}</div>
    </div>
    <div style="background:var(--bg);border-radius:14px;padding:16px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;margin-bottom:12px">
        <span style="color:var(--text-tertiary);font-size:13px">Κατηγορία</span>
        <span style="font-weight:500;font-size:14px">${cat.name}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:12px">
        <span style="color:var(--text-tertiary);font-size:13px">Ημερομηνία</span>
        <span style="font-weight:500;font-size:14px">${formatDate(tx.date)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:12px">
        <span style="color:var(--text-tertiary);font-size:13px">Ώρα</span>
        <span style="font-weight:500;font-size:14px">${formatTime(tx.date)}</span>
      </div>
      ${
        tx.note
          ? `<div style="display:flex;justify-content:space-between">
        <span style="color:var(--text-tertiary);font-size:13px">Σημείωση</span>
        <span style="font-weight:500;font-size:14px">${tx.note}</span>
      </div>`
          : ""
      }
    </div>
    <button class="save-btn" style="background:var(--red);margin-bottom:8px" onclick="deleteTransaction(${tx.id})">Διαγραφή Συναλλαγής</button>
    <button class="save-btn" style="background:var(--bg);color:var(--text-primary)" onclick="closeTransactionDetail()">Τέλος</button>
  `;

  modal.classList.add("visible");
}

function closeTransactionDetail() {
  const modal = document.getElementById("transaction-detail-modal");
  if (modal) modal.classList.remove("visible");
}

function isRunningAsPWA() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

async function deleteTransaction(id) {
  const data = await apiDelete(`/transactions/${id}`).catch(() => null);
  if (!data) return;

  state.transactions = state.transactions.filter((t) => t.id !== id);
  state.balance = data.balance;

  closeTransactionDetail();
  showToast("fa-solid fa-trash", "Η συναλλαγή διαγράφηκε");
  renderView(state.currentView);
}

// ---- TOAST ----
function showToast(iconClass, message) {
  const toast = document.getElementById("toast");
  if (!toast) return;

  const iconEl = toast.querySelector(".toast-icon");
  if (iconEl)
    iconEl.innerHTML = renderFaIcon(iconClass, "fa-solid fa-circle-info");
  toast.querySelector(".toast-message").textContent = message;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 2500);
}

// ---- SEARCH ----
function handleSearch(query) {
  state.searchQuery = query;
  renderTransactionList();
}

// ---- INIT ----
async function init(allowGuest = false) {
  const acc = localStorage.getItem("evx-account");
  const inPWA = isRunningAsPWA();
  const nonPwaRoot = document.getElementById("root-non-pwa");
  const mainRoot = document.getElementById("root-main");

  if (!acc) {
    if (inPWA || allowGuest) {
      window.location.href = "/login/?login=tazro";
      return;
    }

    if (nonPwaRoot) nonPwaRoot.style.display = "block";
    if (mainRoot) mainRoot.style.display = "none";

    const ignoreBtn = document.getElementById("non-pwa-ignore-btn");
    if (ignoreBtn) {
      ignoreBtn.addEventListener("click", () => init(true), { once: true });
    }
    return;
  }

  if (nonPwaRoot) nonPwaRoot.style.display = "none";
  if (mainRoot) mainRoot.style.display = "block";

  if (acc) {
    const parsedAccount = JSON.parse(acc);
    document.getElementById("evx-pfp").src = parsedAccount.pfp || "tazro.png";
    await loadData();
    initSSE();
  }

  // Long-lived PWA: when the app is brought back on a new day, reload so recurring
  // occurrences that became due meanwhile show up without a manual refresh.
  if (!window._recDayHook) {
    window._recDayHook = true;
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState !== "visible") return;
      if (!localStorage.getItem("evx-account")) return;
      if (toDayKey(new Date()) !== _lastDataDay) {
        await loadData();
        renderView(state.currentView);
        renderRecurringEntry();
      } else if (
        Date.now() - _lastLoadAt > 15000 &&
        navigator.onLine !== false
      ) {
        // Coming back to the app: pick up anything received while it was closed
        await loadData();
        renderBalanceCard();
        renderRecentTransactions();
        if (state.currentView === "transactions") renderTransactions();
        renderRecurringEntry();
      }
      checkReceivedPayments();
      checkScheduledPayments();
      checkWeeklyRecap();
    });

    // Back online after being offline: fetch what happened meanwhile and celebrate it
    window.addEventListener("online", async () => {
      if (!localStorage.getItem("evx-account")) return;
      await loadData();
      initSSE();
      renderView(state.currentView);
      renderBalanceCard();
      renderRecurringEntry();
      checkReceivedPayments();
      checkScheduledPayments();
      checkWeeklyRecap();
    });

    // App left open across midnight: pull the new day's recurring/future payments
    setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      if (!localStorage.getItem("evx-account")) return;
      if (toDayKey(new Date()) !== _lastDataDay && navigator.onLine !== false) {
        await loadData();
        renderView(state.currentView);
        renderBalanceCard();
        renderRecurringEntry();
      }
      checkScheduledPayments();
      checkWeeklyRecap();
    }, 30000);
  }

  // Always start on today's local date to avoid timezone-shifted persisted values.
  state.selectedDate = startOfDay(new Date());
  state.txSelectedDate = startOfDay(new Date());

  // Navigation
  document.querySelectorAll(".tab-item").forEach((tab) => {
    tab.addEventListener("click", () => {
      const view = tab.dataset.tab;
      if (view) {
        switchView(view);
      }
    });
  });

  const addFab = document.getElementById("fab-add-btn");
  if (addFab) {
    addFab.addEventListener("click", openAddSheet);
  }

  // Type toggle
  document.querySelectorAll(".type-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.addType = btn.dataset.type;
      state.selectedCategory = null;
      renderTypeToggle();
      renderAmountDisplay();
      updateSaveButton();
    });
  });

  // Numpad
  document.querySelectorAll(".numpad button").forEach((btn) => {
    btn.addEventListener("click", () => {
      handleNumpad(btn.dataset.key);
    });
  });

  // Sheet overlays close
  document
    .getElementById("add-sheet-overlay")
    .addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeAddSheet();
    });
  document
    .getElementById("recurring-sheet-overlay")
    .addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeRecurringSheet();
    });
  document
    .getElementById("debt-sheet-overlay")
    .addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeDebtSheet();
    });
  document
    .getElementById("goal-sheet-overlay")
    .addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeGoalSheet();
    });
  document
    .getElementById("transaction-detail-modal")
    .addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeTransactionDetail();
    });
  document
    .getElementById("fa-icon-picker-modal")
    .addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeFaIconPicker();
    });

  const faPickerCloseBtn = document.getElementById("fa-picker-close-btn");
  if (faPickerCloseBtn) {
    faPickerCloseBtn.addEventListener("click", closeFaIconPicker);
  }

  const faPickerSearch = document.getElementById("fa-icon-search");
  if (faPickerSearch) {
    faPickerSearch.addEventListener("input", (e) =>
      applyFaIconFilter(e.target.value),
    );
  }

  const faPickerLoadMore = document.getElementById("fa-picker-load-more");
  if (faPickerLoadMore) {
    faPickerLoadMore.addEventListener("click", () => {
      state.faIconPage += 1;
      renderFaIconGrid();
    });
  }

  const goalIconInput = document.getElementById("goal-icon-input");
  if (goalIconInput) {
    document
      .getElementById("goal-icon-preview")
      .addEventListener("click", openFaIconPicker);
    goalIconInput.addEventListener("focus", openFaIconPicker);
    goalIconInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openFaIconPicker();
      }
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.faIconPickerOpen) {
      closeFaIconPicker();
    }
  });

  // Debt tabs
  document.querySelectorAll(".dbt-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.debtViewTab = tab.dataset.tab;
      renderDebtTabs();
      renderDebtList();
    });
  });

  // Debt type toggle
  document.querySelectorAll(".debt-type-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.debtType = btn.dataset.type;
      renderDebtTypeToggle();
    });
  });

  // Transaction title field — gates save button + drives character counter
  const titleInput = document.getElementById("transaction-title");
  if (titleInput) {
    titleInput.addEventListener("input", () => {
      updateSaveButton();
      const counter = document.getElementById("tx-title-counter");
      if (counter) counter.textContent = `${titleInput.value.length} / 40`;
    });
    // Prevent numpad key events from leaking into the text field
    titleInput.addEventListener("keydown", (e) => e.stopPropagation());
  }

  // Scheduling toggle + recurring form
  initRecurringFormEvents();

  // Future payment date
  const futureDateInput = document.getElementById("future-payment-date");
  if (futureDateInput) {
    futureDateInput.addEventListener("change", (e) => {
      state.futurePaymentDueDate = e.target.value;
    });
    futureDateInput.addEventListener("keydown", (e) => e.stopPropagation());
  }

  // Search
  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => handleSearch(e.target.value));
  }

  // Transfer slider sync (0–100% of the selected source balance)
  const slider = document.getElementById("transfer-slider");
  const transferInput = document.getElementById("transfer-amount");
  if (slider && transferInput) {
    slider.addEventListener("input", () => {
      const pct = slider.value / 100;
      const amount = Math.round(getTransferSourceBalance() * pct * 100) / 100;
      transferInput.value = amount > 0 ? amount.toFixed(2) : "";
      setTransferSliderFill(Number(slider.value));
    });
  }
  // Typing an amount moves the slider accordingly
  if (transferInput) {
    transferInput.addEventListener("input", () => {
      const sourceBalance = getTransferSourceBalance();
      const maxLabel = document.getElementById("slider-max");
      if (maxLabel) maxLabel.textContent = `${formatCurrency(sourceBalance)}€`;
      const val = parseFloat(transferInput.value) || 0;
      const pct =
        sourceBalance > 0 ? Math.min(100, (val / sourceBalance) * 100) : 0;
      if (slider) slider.value = pct;
      setTransferSliderFill(pct);
    });
  }
  // Quick amount chips (25% / 50% / 75% / all)
  document.querySelectorAll(".transfer-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const pct = Number(chip.dataset.pct);
      const amount =
        Math.round(getTransferSourceBalance() * (pct / 100) * 100) / 100;
      if (transferInput)
        transferInput.value = amount > 0 ? amount.toFixed(2) : "";
      if (slider) slider.value = pct;
      setTransferSliderFill(pct);
    });
  });

  // Savings transfer source toggle
  document.querySelectorAll(".savings-account-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.savingsTransferSource =
        btn.dataset.account === "savings" ? "savings" : "main";
      renderSavingsTransferUI();
      updateTransferSlider();
    });
  });

  // Quick actions
  document.querySelectorAll(".qa-item, .action-item").forEach((item) => {
    item.addEventListener("click", () => {
      const action = item.dataset.action;
      if (action === "send" || action === "pay") {
        state.addType = "expense";
        openAddSheet();
      } else if (action === "request") {
        state.addType = "income";
        openAddSheet();
      } else if (action === "scan") {
        showToast("fa-solid fa-qrcode", "Η σάρωση έρχεται σύντομα");
      } else if (action === "more") {
        switchView("transactions");
      }
    });
  });

  // Activity range toggle (7 / 15 / 30 days)
  document.querySelectorAll(".range-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".range-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderActivityChart(parseInt(btn.dataset.range, 10));
    });
  });

  // Update time every minute
  updateTime();
  setInterval(updateTime, 60000);

  // Spending stats sheet
  const statsOverlay = document.getElementById("stats-sheet-overlay");
  if (statsOverlay) {
    statsOverlay.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeStatsSheet();
    });
  }

  // Messages sheet (Μηνύματα)
  const chatSheetOverlay = document.getElementById("chat-sheet-overlay");
  if (chatSheetOverlay) {
    chatSheetOverlay.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeChatSheet();
    });
  }

  // ---- AI ASSISTANT (DISABLED) - Chat input listeners ----
  // To re-enable: uncomment this block (and the AI section further down).
  // document.querySelectorAll(".chat-tab").forEach((tab) => {
  //   tab.addEventListener("click", () => switchChatTab(tab.dataset.chatTab));
  // });
  // const chatInput = document.getElementById("chat-input");
  // if (chatInput) {
  //   chatInput.addEventListener("keydown", (e) => {
  //     if (e.key === "Enter") sendChatMessage();
  //     e.stopPropagation();
  //   });
  //   chatInput.addEventListener("keyup", (e) => e.stopPropagation());
  // }

  // Network view (Δίκτυο) - section switcher
  document.querySelectorAll(".network-tab").forEach((tab) => {
    tab.addEventListener("click", () =>
      switchNetworkTab(tab.dataset.networkTab),
    );
  });

  const friendsSearchInput = document.getElementById("friends-search");
  if (friendsSearchInput) {
    friendsSearchInput.addEventListener("input", (e) => {
      clearTimeout(_friendSearchTimeout);
      _friendSearchTimeout = setTimeout(
        () => searchFriends(e.target.value.trim()),
        420,
      );
    });
    friendsSearchInput.addEventListener("keydown", (e) => e.stopPropagation());
  }
  const sendFriendModal = document.getElementById("send-friend-modal");
  if (sendFriendModal) {
    sendFriendModal.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeSendFriendModal();
    });
  }
  document.querySelectorAll("#send-numpad [data-send-key]").forEach((btn) => {
    btn.addEventListener("click", () => handleSendNumpad(btn.dataset.sendKey));
  });
  const sendFriendNoteInput = document.getElementById("send-friend-note");
  if (sendFriendNoteInput)
    sendFriendNoteInput.addEventListener("keydown", (e) => e.stopPropagation());

  // Initial render
  renderHome();
  updateGoalIconPreview();

  // Animate in
  setupAnimateIn(document.getElementById("home"));

  // Received-payment animation
  const recvContinue = document.getElementById("recv-continue");
  if (recvContinue) recvContinue.addEventListener("click", dismissReceivedPayment);

  // Weekly recap: chevron tap, swipe down, or Escape closes it
  const wkClose = document.getElementById("wk-close");
  if (wkClose) wkClose.addEventListener("click", dismissWeeklyRecap);
  const wkOverlay = document.getElementById("wk-overlay");
  if (wkOverlay) {
    wkOverlay.addEventListener(
      "touchstart",
      (e) => {
        wkState.touchY = e.touches[0].clientY;
      },
      { passive: true },
    );
    wkOverlay.addEventListener("touchend", (e) => {
      if (wkState.touchY === null) return;
      const dy = e.changedTouches[0].clientY - wkState.touchY;
      wkState.touchY = null;
      if (dy > 60) dismissWeeklyRecap();
    });
  }
  const updContinue = document.getElementById("upd-continue");
  if (updContinue) updContinue.addEventListener("click", dismissUpdateScreen);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      dismissWeeklyRecap();
      dismissUpdateScreen();
    }
  });
  checkReceivedPayments();
  checkScheduledPayments();
  checkWeeklyRecap();

  // Push notifications: tap handling and quiet daily re-registration
  ntfInitMessages();
  ntfHandleOpenParam();
  ntfQuietResync();

  // "App updated" screen (plays before the notifications popup)
  window._updCheck = updMaybeShow();
  ntfMaybePrompt();
}

function setupAnimateIn(container) {
  const elements = Array.from(
    (container || document).querySelectorAll(".animate-in"),
  );
  elements.forEach((el) => {
    el.classList.remove("visible");
    el.style.animationDelay = "";
  });

  const observer = new IntersectionObserver(
    (entries) => {
      const entering = entries.filter((e) => e.isIntersecting);
      entering.sort(
        (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
      );
      entering.forEach((entry, i) => {
        entry.target.style.animationDelay = `${i * 60}ms`;
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.1 },
  );

  elements.forEach((el) => observer.observe(el));
}

// ---- MESSAGES (Μηνύματα popup) ----
// The popup currently only shows an empty state.
function openChatSheet() {
  const overlay = document.getElementById("chat-sheet-overlay");
  if (overlay) overlay.classList.add("visible");
}

function closeChatSheet() {
  const overlay = document.getElementById("chat-sheet-overlay");
  if (overlay) overlay.classList.remove("visible");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================================================
// AI ASSISTANT (DISABLED)
// ----------------------------------------------------------------------------
// The AI assistant was removed from the Μηνύματα popup. HOW TO RE-IMPLEMENT:
//
// 1. index.html - in #chat-sheet-overlay add the ".chat-tabs" bar and the
//    #chat-ai-tab content (#chat-messages, #chat-input, #chat-send-btn).
//    The exact markup is described in the comment above the sheet.
// 2. app.js - add the state object back (it must live before it is used):
//        const chatState = { messages: [], activeTab: "ai", isTyping: false };
// 3. app.js - uncomment the functions below. The commented openChatSheet
//    REPLACES the simple openChatSheet above (it adds the welcome message and
//    focuses the input), so delete the simple one. Also uncomment
//    "Chat input listeners" in init().
// 4. Backend - streamChatResponse() calls  POST {API}/chat  (SSE stream:
//    lines "data: {delta}" ending with "data: [DONE]"). The backend endpoint
//    was not touched. If the server is unreachable it falls back to
//    generateLocalAIResponse(), a keyword-based offline responder.
// 5. CSS - all chat classes are still in styles.css, nothing to restore.
// ============================================================================
// function openChatSheet() {
//   const overlay = document.getElementById("chat-sheet-overlay");
//   if (!overlay) return;
//   overlay.classList.add("visible");
//   if (chatState.messages.length === 0) {
//     const firstName = (state.user.name || "φίλε").split(" ")[0];
//     chatState.messages.push({
//       role: "ai",
//       text: `Γεια σου, ${firstName}! 👋 Είμαι ο <strong>Tazro AI</strong>. Μπορώ να σε βοηθήσω με ερωτήσεις για το υπόλοιπό σου, τα χρέη σου, τους στόχους αποταμίευσης και τα μηνιαία έξοδα. Τι θέλεις να μάθεις;`,
//     });
//   }
//   renderChatMessages();
//   setTimeout(() => {
//     const input = document.getElementById("chat-input");
//     if (input) input.focus();
//   }, 420);
// }
//
// function switchChatTab(tab) {
//   chatState.activeTab = tab;
//   document.querySelectorAll(".chat-tab").forEach((t) => {
//     t.classList.toggle("active", t.dataset.chatTab === tab);
//   });
//   const aiTab = document.getElementById("chat-ai-tab");
//   const friendsTab = document.getElementById("chat-friends-tab");
//   if (aiTab) aiTab.classList.toggle("active", tab === "ai");
//   if (friendsTab) friendsTab.classList.toggle("active", tab === "friends");
// }
//
// function renderChatMessages() {
//   const container = document.getElementById("chat-messages");
//   if (!container) return;
//
//   container.innerHTML = chatState.messages
//     .map((msg) => {
//       if (msg.role === "ai") {
//         return `
//         <div class="chat-bubble-wrap ai">
//           <div class="chat-ai-avatar">
//             <i class="fa-solid fa-robot" style="font-size:13px"></i>
//           </div>
//           <div class="chat-bubble ai">${msg.text.replaceAll(/\*\*/g, "")}</div>
//         </div>`;
//       }
//       return `
//       <div class="chat-bubble-wrap user">
//         <div class="chat-bubble user">${escapeHtml(msg.text)}</div>
//       </div>`;
//     })
//     .join("");
//
//   if (chatState.isTyping) {
//     container.innerHTML += `
//       <div class="chat-bubble-wrap ai">
//         <div class="chat-ai-avatar">
//           <i class="fa-solid fa-robot" style="font-size:13px"></i>
//         </div>
//         <div class="chat-bubble ai typing">
//           <div class="typing-dot"></div>
//           <div class="typing-dot"></div>
//           <div class="typing-dot"></div>
//         </div>
//       </div>`;
//   }
//
//   container.scrollTop = container.scrollHeight;
// }
//
// async function sendChatMessage() {
//   const input = document.getElementById("chat-input");
//   if (!input) return;
//   const text = input.value.trim();
//   if (!text || chatState.isTyping) return;
//
//   input.value = "";
//   chatState.messages.push({ role: "user", text });
//   chatState.isTyping = true;
//   renderChatMessages();
//
//   await streamChatResponse(text);
// }
//
// async function streamChatResponse(userMessage) {
//   let msgIndex = -1;
//
//   try {
//     const response = await fetch(API + "/chat", {
//       method: "POST",
//       headers: withAuthHeaders({ "Content-Type": "application/json" }),
//       body: JSON.stringify({ message: userMessage }),
//     });
//
//     if (!response.ok) throw new Error(`HTTP ${response.status}`);
//
//     const reader = response.body.getReader();
//     const decoder = new TextDecoder();
//     let buffer = "";
//
//     while (true) {
//       const { done, value } = await reader.read();
//       if (done) break;
//
//       buffer += decoder.decode(value, { stream: true });
//       const lines = buffer.split("\n");
//       buffer = lines.pop(); // hold incomplete line for next chunk
//
//       for (const line of lines) {
//         if (!line.startsWith("data: ")) continue;
//         const payload = line.slice(6).trim();
//         if (payload === "[DONE]") break;
//
//         const parsed = JSON.parse(payload);
//         if (parsed.error) throw new Error(parsed.error);
//
//         if (parsed.delta) {
//           if (msgIndex === -1) {
//             // First token — swap typing indicator for a real bubble
//             chatState.isTyping = false;
//             chatState.messages.push({ role: "ai", text: "" });
//             msgIndex = chatState.messages.length - 1;
//           }
//           chatState.messages[msgIndex].text += parsed.delta;
//           renderChatMessages();
//         }
//       }
//     }
//
//     // Stream ended with no tokens (e.g. empty response)
//     if (msgIndex === -1) throw new Error("empty");
//   } catch (_) {
//     chatState.isTyping = false;
//     if (msgIndex === -1) {
//       // Server unreachable — fall back to local AI
//       const { income, expenses } = getMonthTotals();
//       const ctx = {
//         balance: state.balance,
//         savings: state.savings,
//         debts: state.debts.map((d) => ({
//           name: d.name,
//           amount: d.amount,
//           type: d.type,
//         })),
//         goals: state.savingsGoals.map((g) => ({
//           name: g.name,
//           target: g.target,
//           current: g.current || 0,
//         })),
//         monthIncome: income,
//         monthExpenses: expenses,
//       };
//       chatState.messages.push({
//         role: "ai",
//         text: generateLocalAIResponse(userMessage, ctx),
//       });
//     }
//     renderChatMessages();
//   }
// }
//
// function generateLocalAIResponse(message, ctx) {
//   const msg = message.toLowerCase();
//
//   if (
//     msg.includes("υπόλοιπο") ||
//     msg.includes("balance") ||
//     msg.includes("πόσα λεφτ") ||
//     msg.includes("πόσα χρήματ") ||
//     msg.includes("έχω;")
//   ) {
//     return `Το τρέχον υπόλοιπό σου είναι <strong>${formatCurrency(ctx.balance)}€</strong> και η αποταμίευσή σου <strong>${formatCurrency(ctx.savings)}€</strong>. Σύνολο: <strong>${formatCurrency(ctx.balance + ctx.savings)}€</strong>.`;
//   }
//
//   if (msg.includes("χρωστ") || msg.includes("χρέ") || msg.includes("debt")) {
//     const owe = ctx.debts.filter((d) => d.type === "owe");
//     const lent = ctx.debts.filter((d) => d.type === "lent");
//     if (ctx.debts.length === 0)
//       return "Δεν έχεις καταγεγραμμένα χρέη αυτή τη στιγμή. 🎉";
//     const totalOwe = owe.reduce((s, d) => s + d.amount, 0);
//     const totalLent = lent.reduce((s, d) => s + d.amount, 0);
//     let r = `Χρωστάς συνολικά <strong>${formatCurrency(totalOwe)}€</strong> και σου χρωστούν <strong>${formatCurrency(totalLent)}€</strong>.`;
//     if (owe.length)
//       r += `<br><br>Χρωστάς σε: ${owe.map((d) => `${escapeHtml(d.name)} (${formatCurrency(d.amount)}€)`).join(", ")}.`;
//     if (lent.length)
//       r += `<br>Σου χρωστούν: ${lent.map((d) => `${escapeHtml(d.name)} (${formatCurrency(d.amount)}€)`).join(", ")}.`;
//     return r;
//   }
//
//   if (msg.includes("στόχ") || msg.includes("goal") || msg.includes("αποταμ")) {
//     if (ctx.goals.length === 0)
//       return "Δεν έχεις ορίσει στόχους αποταμίευσης ακόμα. Μπορείς να προσθέσεις από την καρτέλα <strong>Αποταμίευση</strong>!";
//     const lines = ctx.goals
//       .map((g) => {
//         const pct = g.target > 0 ? Math.round((g.current / g.target) * 100) : 0;
//         return `<strong>${escapeHtml(g.name)}</strong>: ${formatCurrency(g.current)}€ / ${formatCurrency(g.target)}€ (${pct}%)`;
//       })
//       .join("<br>");
//     return `Οι στόχοι σου:<br>${lines}`;
//   }
//
//   if (
//     msg.includes("έξοδ") ||
//     msg.includes("δαπάν") ||
//     msg.includes("ξόδεψ") ||
//     msg.includes("expense") ||
//     msg.includes("spending")
//   ) {
//     const net = ctx.monthIncome - ctx.monthExpenses;
//     const sign = net >= 0 ? "+" : "";
//     return `Αυτόν τον μήνα έχεις ξοδέψει <strong>${formatCurrency(ctx.monthExpenses)}€</strong> και έχεις λάβει <strong>${formatCurrency(ctx.monthIncome)}€</strong> εισοδήματος. Καθαρό αποτέλεσμα: <strong>${sign}${formatCurrency(net)}€</strong>.`;
//   }
//
//   if (
//     msg.includes("εισόδ") ||
//     msg.includes("income") ||
//     msg.includes("μισθ") ||
//     msg.includes("βγάζ")
//   ) {
//     return `Αυτόν τον μήνα το συνολικό σου εισόδημα είναι <strong>${formatCurrency(ctx.monthIncome)}€</strong>.`;
//   }
//
//   if (msg.includes("αποταμίευ") || msg.includes("saving")) {
//     return `Η αποταμίευσή σου βρίσκεται στα <strong>${formatCurrency(ctx.savings)}€</strong>. ${ctx.monthIncome > 0 ? `Αποταμιεύεις περίπου ${Math.max(0, Math.round(((ctx.monthIncome - ctx.monthExpenses) / ctx.monthIncome) * 100))}% του εισοδήματός σου αυτόν τον μήνα.` : ""}`;
//   }
//
//   if (
//     msg.includes("συμβουλ") ||
//     msg.includes("tip") ||
//     msg.includes("πώς") ||
//     msg.includes("βοήθ")
//   ) {
//     const rate =
//       ctx.monthIncome > 0
//         ? ((ctx.monthIncome - ctx.monthExpenses) / ctx.monthIncome) * 100
//         : 0;
//     if (rate < 10)
//       return `💡 Αποταμιεύεις μόνο ${Math.max(0, rate.toFixed(0))}% του εισοδήματός σου αυτόν τον μήνα. Ο συνιστώμενος στόχος είναι <strong>20%</strong>. Δες πού μπορείς να μειώσεις τα έξοδα!`;
//     if (ctx.debts.filter((d) => d.type === "owe").length > 0)
//       return `💡 Έχεις ενεργά χρέη. Σκέψου να εξοφλήσεις πρώτα αυτά με το υψηλότερο ποσό για να ελαφρύνεις τον προϋπολογισμό σου.`;
//     return `💡 Αποταμιεύεις ${rate.toFixed(0)}% του εισοδήματός σου — καλή δουλειά! Σκέψου να θέσεις έναν στόχο για να αξιοποιήσεις καλύτερα την αποταμίευσή σου.`;
//   }
//
//   if (
//     msg.includes("γεια") ||
//     msg === "hello" ||
//     msg === "hi" ||
//     msg.startsWith("hi ")
//   ) {
//     return `Γεια σου! 😊 Πώς μπορώ να σε βοηθήσω; Μπορώ να σου πω για το <strong>υπόλοιπό</strong> σου, τα <strong>χρέη</strong> σου, τους <strong>στόχους</strong> ή τα έξοδα του μήνα.`;
//   }
//
//   const fallbacks = [
//     `Μπορώ να σε βοηθήσω με ερωτήσεις για το <strong>υπόλοιπό</strong> σου, τα <strong>χρέη</strong>, τους <strong>στόχους</strong> αποταμίευσης ή τα <strong>μηνιαία έξοδα</strong>. Τι θέλεις να μάθεις;`,
//     `Δεν κατάλαβα την ερώτηση. Δοκίμασε να ρωτήσεις για το <em>υπόλοιπό</em> σου, τα <em>χρέη</em> ή τις <em>αποταμιεύσεις</em> σου.`,
//   ];
//   return fallbacks[Math.floor(Math.random() * fallbacks.length)];
// }

// ---- FRIENDS / SEND MONEY ----
let _friendSearchTimeout = null;

const networkState = {
  activeTab: "debts", // "debts" (default) | "friends"
  selectedFriend: null,
  sendAmountStr: "",
};

// Δίκτυο view: renders the active section (friends & send money, or debts)
function renderNetwork() {
  renderDebts();
  // Χρέη is always the first section shown when entering Δίκτυο
  switchNetworkTab("debts");
}

function switchNetworkTab(tab) {
  networkState.activeTab = tab === "debts" ? "debts" : "friends";
  document.querySelectorAll(".network-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.networkTab === networkState.activeTab);
  });
  const friendsPanel = document.getElementById("network-friends-panel");
  const debtsPanel = document.getElementById("network-debts-panel");
  if (friendsPanel)
    friendsPanel.classList.toggle("active", networkState.activeTab === "friends");
  if (debtsPanel)
    debtsPanel.classList.toggle("active", networkState.activeTab === "debts");

  if (networkState.activeTab === "friends") {
    const input = document.getElementById("friends-search");
    searchFriends(input ? input.value.trim() : "");
  }
}

// ---- Duplicate guard: a user is a duplicate if EITHER the username OR the
// display name was already seen (case-insensitive). `seen` = { names, users }.
function isDuplicatePeer(u, seen) {
  const uname = String(u.username || "").trim().toLowerCase();
  const name = String(u.name || "").trim().toLowerCase();
  if ((uname && seen.users.has(uname)) || (name && seen.names.has(name))) {
    return true;
  }
  if (uname) seen.users.add(uname);
  if (name) seen.names.add(name);
  return false;
}

function newPeerSeen() {
  return { names: new Set(), users: new Set() };
}

function getRecentPeers(seen = newPeerSeen()) {
  const peers = [];
  for (const tx of state.transactions) {
    if (!tx.peerPfp) continue;
    // Name may include ': note' suffix — strip it to get the display name
    const rawName = tx.name || "";
    const name = rawName.includes(": ") ? rawName.split(": ")[0] : rawName;
    const peer = {
      id: tx.peerId || null,
      username: tx.peerUsername || name,
      name,
      pfp: tx.peerPfp,
    };
    if (isDuplicatePeer(peer, seen)) continue;
    peers.push(peer);
    if (peers.length >= 8) break;
  }
  return peers;
}

// "Άλλοι": up to 10 users from GET /users/all (API base already ends in /tazro),
// skipping anyone already listed under Πρόσφατοι.
const OTHER_USERS_MAX = 10;
let _friendsViewToken = 0;

// Identify the logged-in user so they never appear in their own list.
// Uses the stored evx-account (username, or the `name=` param of its pfp URL).
function getSelfIdentity() {
  let acc = {};
  try {
    acc = JSON.parse(localStorage.getItem("evx-account") || "null") || {};
  } catch (_) {}
  let username = String(acc.username || "").trim().toLowerCase();
  const pfp = String(acc.pfp || "").trim();
  if (!username && pfp) {
    try {
      username = (new URL(pfp).searchParams.get("name") || "")
        .trim()
        .toLowerCase();
    } catch (_) {}
  }
  return { username, pfp };
}

async function fetchOtherUsers(seen) {
  const data = await apiGet("/users/all");
  const all = Array.isArray(data) ? data : data.users || [];
  const me = getSelfIdentity();

  // 1) drop invalid entries and the current user
  const candidates = all.filter((u) => {
    if (!u || !u.username) return false;
    if (me.username && String(u.username).trim().toLowerCase() === me.username)
      return false;
    if (me.pfp && u.pfp === me.pfp) return false;
    return true;
  });

  // 2) users with Tazro first (order inside each group is preserved)
  const ordered = [
    ...candidates.filter((u) => u.hasTazro === true),
    ...candidates.filter((u) => u.hasTazro !== true),
  ];

  // 3) drop duplicates (against Πρόσφατοι too) and keep the first 10
  const others = [];
  for (const u of ordered) {
    if (isDuplicatePeer(u, seen)) continue;
    others.push(u);
    if (others.length >= OTHER_USERS_MAX) break;
  }
  return others;
}

const FRIENDS_EMPTY_HTML = `
  <div class="friends-empty">
    <i class="fa-solid fa-user-plus" style="font-size:28px;color:var(--text-tertiary)"></i>
    <p>Αναζήτησε χρήστες από το Evox Ecosystem για να στείλεις χρήματα.</p>
  </div>`;

async function searchFriends(query) {
  const list = document.getElementById("friends-list");
  if (!list) return;
  const token = ++_friendsViewToken;

  // ---- Default view: Πρόσφατοι + Άλλοι ----
  if (!query || query.length < 2) {
    const seen = newPeerSeen();
    const recent = getRecentPeers(seen);

    // Show recents immediately, with a loader under "Άλλοι"
    renderFriendsHome(recent, null);

    try {
      const others = await fetchOtherUsers(seen);
      if (token !== _friendsViewToken) return; // user typed / switched meanwhile
      renderFriendsHome(recent, others);
    } catch (_) {
      if (token !== _friendsViewToken) return;
      renderFriendsHome(recent, []); // apiFetch already showed a toast
    }
    return;
  }

  // ---- Search view ----
  list.innerHTML = `<div class="friends-empty"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px;color:var(--text-tertiary)"></i></div>`;

  try {
    const results = await apiGet(
      `/users/search?q=${encodeURIComponent(query)}`,
    );
    if (token !== _friendsViewToken) return;
    renderFriendResults(Array.isArray(results) ? results : results.users || []);
  } catch (_) {
    if (token !== _friendsViewToken) return;
    list.innerHTML = `<div class="friends-empty"><i class="fa-solid fa-triangle-exclamation" style="color:var(--text-tertiary)"></i><p>Σφάλμα αναζήτησης. Δοκίμασε ξανά.</p></div>`;
  }
}

// others === null -> still loading, [] -> nothing / failed
function renderFriendsHome(recent, others) {
  const list = document.getElementById("friends-list");
  if (!list) return;

  let html = "";
  if (recent.length > 0) {
    html += `<div class="friends-section-label">Πρόσφατοι</div>`;
    html += recent.map(friendItemHTML).join("");
  }

  if (others === null) {
    html += `<div class="friends-section-label">Άλλοι</div>
      <div class="friends-empty friends-empty--inline"><i class="fa-solid fa-spinner fa-spin" style="font-size:20px;color:var(--text-tertiary)"></i></div>`;
  } else if (others.length > 0) {
    html += `<div class="friends-section-label">Άλλοι</div>`;
    html += others.map(friendItemHTML).join("");
  }

  list.innerHTML = html || FRIENDS_EMPTY_HTML;
  bindFriendSendButtons(list);
}

function friendItemHTML(u) {
  const safeData = encodeURIComponent(JSON.stringify(u));
  // hasTazro is only present on /users/all; undefined (recents / search) = allowed
  const canReceive = u.hasTazro !== false;
  return `
      <div class="friend-item">
        <div class="friend-avatar">
          ${u.pfp ? `<img src="${escapeHtml(u.pfp)}" alt="" onerror="this.remove()">` : escapeHtml((u.name || u.username || "?")[0].toUpperCase())}
        </div>
        <div class="friend-info">
          <div class="friend-name">${escapeHtml(u.name || u.username || "Χρήστης")}</div>
          <div class="friend-username">@${escapeHtml(u.username || "")}</div>
        </div>
        ${
          canReceive
            ? `<button class="friend-send-btn" data-user="${safeData}">Αποστολή</button>`
            : `<button class="friend-send-btn" disabled>Χωρίς Tazro</button>`
        }
      </div>`;
}

function bindFriendSendButtons(list) {
  list.querySelectorAll(".friend-send-btn[data-user]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const user = JSON.parse(decodeURIComponent(btn.dataset.user));
      openSendFriendModal(user);
    });
  });
}

function renderFriendResults(users, headerHTML = "") {
  const list = document.getElementById("friends-list");
  if (!list) return;
  if (!users || users.length === 0) {
    list.innerHTML = `<div class="friends-empty"><i class="fa-solid fa-user-slash" style="font-size:28px;color:var(--text-tertiary)"></i><p>Δεν βρέθηκαν χρήστες.</p></div>`;
    return;
  }

  list.innerHTML = headerHTML + users.map(friendItemHTML).join("");
  bindFriendSendButtons(list);
}

function handleSendNumpad(key) {
  if (key === "delete") {
    networkState.sendAmountStr = networkState.sendAmountStr.slice(0, -1);
  } else if (key === ".") {
    if (!networkState.sendAmountStr.includes(".")) {
      networkState.sendAmountStr += networkState.sendAmountStr ? "." : "0.";
    }
  } else {
    const parts = networkState.sendAmountStr.split(".");
    if (parts[1] && parts[1].length >= 2) return;
    if (networkState.sendAmountStr.replace(".", "").length >= 7) return;
    networkState.sendAmountStr += key;
  }
  const el = document.getElementById("send-amount-value");
  if (el) el.textContent = networkState.sendAmountStr || "0";
  const btn = document.getElementById("send-friend-btn");
  if (btn) btn.disabled = !(parseFloat(networkState.sendAmountStr) > 0);
}

function openSendFriendModal(user) {
  networkState.selectedFriend = user;
  networkState.sendAmountStr = "";

  const avatarEl = document.getElementById("send-friend-avatar");
  if (avatarEl) {
    avatarEl.innerHTML = user.pfp
      ? `<img src="${escapeHtml(user.pfp)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : escapeHtml((user.name || user.username || "?")[0].toUpperCase());
  }
  const nameEl = document.getElementById("send-friend-name");
  if (nameEl) nameEl.textContent = user.name || user.username || "Χρήστης";

  const amountEl = document.getElementById("send-amount-value");
  if (amountEl) amountEl.textContent = "0";
  const noteEl = document.getElementById("send-friend-note");
  if (noteEl) noteEl.value = "";
  const btn = document.getElementById("send-friend-btn");
  if (btn) btn.disabled = true;

  document.getElementById("send-friend-modal").classList.add("visible");
}

function closeSendFriendModal() {
  document.getElementById("send-friend-modal").classList.remove("visible");
  networkState.selectedFriend = null;
  networkState.sendAmountStr = "";
}

async function confirmSendToFriend() {
  const friend = networkState.selectedFriend;
  if (!friend) return;

  const amount = parseFloat(networkState.sendAmountStr);
  const note = (document.getElementById("send-friend-note").value || "").trim();

  if (!amount || amount <= 0) {
    showToast("fa-solid fa-triangle-exclamation", "Συμπλήρωσε έγκυρο ποσό");
    return;
  }
  if (amount > state.balance) {
    showToast("fa-solid fa-triangle-exclamation", "Ανεπαρκές υπόλοιπο");
    return;
  }

  try {
    const data = await apiPost("/send", {
      recipientId: friend.id,
      recipientUsername: friend.username, // /users/all entries have no id
      amount,
      note: note,
    });
    if (data && data.balance !== undefined) state.balance = data.balance;
    else state.balance -= amount;
    renderBalanceCard();
    closeSendFriendModal();
    showToast(
      "fa-solid fa-circle-check",
      `Εστάλησαν ${formatCurrency(amount)}€ στον/ην ${escapeHtml(friend.name || friend.username || "")}`,
    );
  } catch (_) {
    /* apiFetch already shows toast */
  }
}

// ============================================================================
// RECEIVED PAYMENT ANIMATION (Apple Cash style)
// Shown when another user sends money and the person hasn't seen it yet:
//  - live, when the payment arrives over SSE while the app is open
//  - on the next open / resume, for payments received while away
// Seen payment ids are kept in localStorage so each one plays only once.
// ============================================================================
const RECV_SEEN_KEY = "tazroSeenReceived";
const RECV_MAX_QUEUE = 3;
const recvState = {
  queue: [],
  showing: false,
  closing: false,
  raf: 0,
  countRaf: 0,
  closeTimer: 0,
};

function isReceivedPayment(t) {
  return (
    !!t &&
    t.type === "income" &&
    !!(t.peerPfp || t.peerUsername || t.peerId)
  );
}

// null = never initialised on this device
function getSeenReceived() {
  try {
    const raw = localStorage.getItem(RECV_SEEN_KEY);
    if (raw === null) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch (_) {
    return null;
  }
}

function saveSeenReceived(ids) {
  try {
    localStorage.setItem(RECV_SEEN_KEY, JSON.stringify(ids.slice(-300)));
  } catch (_) {}
}

function checkReceivedPayments() {
  // Only play while the app is actually on screen; otherwise it stays
  // "unseen" and plays when the person comes back.
  if (document.visibilityState !== "visible") return;
  if (!localStorage.getItem("evx-account")) return;

  const received = state.transactions.filter(isReceivedPayment);
  const seen = getSeenReceived();

  if (seen === null) {
    // First run on this device: existing history counts as already seen
    if (_lastLoadAt === 0) return; // nothing loaded yet - try again later
    saveSeenReceived(received.map((t) => t.id));
    return;
  }

  const seenSet = new Set(seen.map(String));
  let fresh = received.filter((t) => !seenSet.has(String(t.id)));
  if (fresh.length === 0) return;

  fresh.sort((a, b) => new Date(a.date) - new Date(b.date));
  saveSeenReceived([...seen, ...fresh.map((t) => t.id)]);
  if (fresh.length > RECV_MAX_QUEUE) fresh = fresh.slice(-RECV_MAX_QUEUE);

  recvState.queue.push(...fresh);
  if (!recvState.showing) showNextReceivedPayment();
}

// Name shows up as "Name: note" on peer transactions
function recvParse(t) {
  const raw = String(t.name || "");
  const idx = raw.indexOf(": ");
  const nameFromTx = idx > -1 ? raw.slice(0, idx) : raw;
  const noteFromTx = idx > -1 ? raw.slice(idx + 2) : "";
  const name = String(t.peerName || nameFromTx || t.peerUsername || "Χρήστης").trim();
  let note = String(t.note || "").trim();
  if (!note || note === raw.trim()) note = noteFromTx.trim();
  return { name, note, pfp: t.peerPfp || "" };
}

function recvFormatAmount(v, decimals) {
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function recvCountUp(el, target, decimals, delay, duration) {
  cancelAnimationFrame(recvState.countRaf);
  const t0 = performance.now() + delay;
  const tick = (now) => {
    if (now < t0) {
      recvState.countRaf = requestAnimationFrame(tick);
      return;
    }
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 4);
    el.textContent = recvFormatAmount(target * eased, decimals);
    if (p < 1) recvState.countRaf = requestAnimationFrame(tick);
    else el.textContent = recvFormatAmount(target, decimals);
  };
  recvState.countRaf = requestAnimationFrame(tick);
}

function showNextReceivedPayment() {
  const t = recvState.queue.shift();
  if (t && t._update) {
    showUpdateScreen();
    return;
  }
  if (t && t._weekly) {
    showWeeklyRecap(t._weekly);
    return;
  }
  const overlay = document.getElementById("recv-overlay");
  if (!t || !overlay) {
    recvState.showing = false;
    return;
  }
  recvState.showing = true;
  recvState.closing = false;

  const sched = t._recv || null;
  const info = sched
    ? { name: sched.from, note: sched.note, pfp: "" }
    : recvParse(t);
  const outgoing = !!(sched && sched.outgoing);
  const amount = Number(t.amount) || 0;
  const decimals = Number.isInteger(amount) ? 0 : 2;
  const reduce =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const numEl = document.getElementById("recv-amount-num");
  const noteEl = document.getElementById("recv-note");
  const fromEl = document.getElementById("recv-from-text");
  const avatarEl = document.getElementById("recv-avatar");

  const curEl = overlay.querySelector(".recv-cur");
  if (curEl) curEl.textContent = outgoing ? "\u2212\u20AC" : "\u20AC";
  overlay.setAttribute(
    "aria-label",
    sched ? sched.title : "Λήψη πληρωμής",
  );

  if (numEl) numEl.textContent = recvFormatAmount(reduce ? amount : 0, decimals);
  if (noteEl) {
    noteEl.textContent = info.note
      ? sched
        ? info.note
        : `\u201C${info.note}\u201D`
      : "";
    noteEl.hidden = !info.note;
  }
  if (fromEl) fromEl.textContent = sched ? info.name : `Από ${info.name}`;
  if (avatarEl && sched) {
    avatarEl.innerHTML = SCHED_ICON_SVG;
  } else if (avatarEl) {
    const initial = escapeHtml((info.name || "?").charAt(0).toUpperCase());
    avatarEl.innerHTML = info.pfp
      ? `${initial}<img src="${escapeHtml(info.pfp)}" alt="" onerror="this.remove()">`
      : initial;
  }

  // Restart the CSS entrance animations from scratch
  clearTimeout(recvState.closeTimer);
  overlay.classList.remove("show", "hide");
  void overlay.offsetWidth;
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");

  recvStartParticles(reduce);
  if (numEl && !reduce) recvCountUp(numEl, amount, decimals, 350, 1150);

  try {
    if (navigator.vibrate) navigator.vibrate([12, 60, 22]);
  } catch (_) {}
}

function dismissReceivedPayment() {
  const overlay = document.getElementById("recv-overlay");
  if (!overlay || !recvState.showing || recvState.closing) return;
  recvState.closing = true;
  overlay.classList.remove("show");
  overlay.classList.add("hide");

  recvState.closeTimer = setTimeout(() => {
    cancelAnimationFrame(recvState.raf);
    cancelAnimationFrame(recvState.countRaf);
    overlay.classList.remove("hide");
    overlay.setAttribute("aria-hidden", "true");
    recvState.closing = false;
    recvState.showing = false;
    if (recvState.queue.length) showNextReceivedPayment();
  }, 460);
}

// Falling glitter streams above the amount + twinkling star dust
function recvStartParticles(reduce) {
  const canvas = document.getElementById("recv-canvas");
  const amountEl = document.getElementById("recv-amount");
  if (!canvas || !amountEl) return;
  cancelAnimationFrame(recvState.raf);

  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth || window.innerWidth;
  const H = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Where the number sits (transform-independent centre)
  const r = amountEl.getBoundingClientRect();
  const numTop = r.top + r.height / 2 - amountEl.offsetHeight / 2;
  const streamBottom = numTop - 4;
  const streamTop = Math.max(H * 0.07, streamBottom - Math.min(H * 0.36, 340));
  const streamH = Math.max(80, streamBottom - streamTop);
  const colW = Math.min(W * 0.16, 76);

  const cols = [
    { x: W * 0.3, hue: 198 }, // icy blue
    { x: W * 0.5, hue: 96 }, // lime green
    { x: W * 0.7, hue: 26 }, // warm peach
  ];

  function makeStream(c, initial) {
    const spread = Math.random() + Math.random() - 1; // denser in the middle
    return {
      c,
      x: c.x + spread * colW,
      p: initial ? Math.random() : 0,
      speed: 0.11 + Math.random() * 0.24,
      size: 0.9 + Math.random() * 2.1,
      phase: Math.random() * Math.PI * 2,
      tw: 3 + Math.random() * 7,
      sway: 1.5 + Math.random() * 5,
      shard: Math.random() < 0.5,
      color: `hsl(${c.hue + (Math.random() - 0.5) * 34} ${55 + Math.random() * 30}% ${
        64 + Math.random() * 28
      }%)`,
    };
  }

  const perCol = reduce ? 36 : 90;
  const streams = [];
  cols.forEach((c) => {
    for (let i = 0; i < perCol; i++) streams.push(makeStream(c, true));
  });

  const stars = Array.from({ length: reduce ? 30 : 95 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    s: 0.6 + Math.random() * 1.1,
    ph: Math.random() * Math.PI * 2,
    tw: 0.8 + Math.random() * 2.4,
    vy: 2 + Math.random() * 7,
  }));

  const start = performance.now();
  let last = start;

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - start) / 1000;
    const intro = Math.min(1, t / 0.9);

    ctx.clearRect(0, 0, W, H);

    // star dust
    ctx.fillStyle = "#cfd9ea";
    const starIn = Math.min(1, t / 0.6);
    for (const s of stars) {
      s.y += s.vy * dt;
      if (s.y > H + 2) {
        s.y = -2;
        s.x = Math.random() * W;
      }
      ctx.globalAlpha = (0.15 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.tw + s.ph))) * starIn;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }

    // glitter streams
    for (let i = 0; i < streams.length; i++) {
      let q = streams[i];
      q.p += q.speed * dt;
      if (q.p >= 1) {
        q = streams[i] = makeStream(q.c, false);
      }
      const p = q.p;
      const env = Math.min(1, p / 0.12) * Math.min(1, (1 - p) / 0.3);
      const twinkle = 0.5 + 0.5 * Math.sin(t * q.tw + q.phase);
      const a = env * (0.35 + 0.65 * twinkle) * intro;
      if (a < 0.02) continue;
      const x = q.x + Math.sin(t * 1.2 + q.phase) * q.sway;
      const y = streamTop + p * streamH;
      ctx.globalAlpha = a;
      ctx.fillStyle = q.color;
      if (q.shard) ctx.fillRect(x, y, q.size * 0.7, q.size * 2.2);
      else ctx.fillRect(x, y, q.size, q.size);
    }

    ctx.globalAlpha = 1;
    recvState.raf = requestAnimationFrame(frame);
  }
  recvState.raf = requestAnimationFrame(frame);
}

// ============================================================================
// SCHEDULED PAYMENTS -> same full-screen animation
// Recurring rules and future (due-dated) payments that came due are announced
// exactly like a received payment, whether the app was closed/offline when they
// happened or is open right now. Several at once play one after another via
// recvState.queue.
//  - recurring: the last seen "next date" of every rule is remembered on the
//    device; when the rule's nextDate moves forward, every date in between is
//    an occurrence that has not been shown yet.
//  - future payments: shown once when their due day is reached.
// The first run on a device only records a baseline (no replay of history).
// ============================================================================
const SCHED_REC_KEY = "tazroRecSnapshot";
const SCHED_PAY_KEY = "tazroSeenScheduled";
const SCHED_MAX_PER_RULE = 3; // more than this from one rule => one combined screen
const SCHED_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5"/></svg>';

function schedRead(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function schedWrite(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (_) {}
}

function schedRuleCursor(r) {
  if (r.finished) return "done";
  return isValidDayKey(r.nextDate) ? r.nextDate : "";
}

function schedMarkRuleKnown(rule) {
  if (!rule || rule.id === undefined) return;
  const snap = schedRead(SCHED_REC_KEY) || {};
  snap[rule.id] = schedRuleCursor(rule);
  schedWrite(SCHED_REC_KEY, snap);
}

function schedDueKey(p) {
  return p && p.dueDate ? String(p.dueDate).slice(0, 10) : "";
}

function schedMarkPaymentSeen(id) {
  const seen = schedRead(SCHED_PAY_KEY);
  if (seen === null) return;
  if (seen.map(String).includes(String(id))) return;
  schedWrite(SCHED_PAY_KEY, [...seen, id].slice(-300));
}

// A payment the person just created/edited with a due day that is already here
// is their own action - don't celebrate it a moment later.
function schedMarkPaymentSeenIfDue(p) {
  if (!p) return;
  const key = schedDueKey(p);
  if (key && key <= toDayKey(new Date())) schedMarkPaymentSeen(p.id);
}

function schedAddInterval(dayKey, unit, interval, anchorDay) {
  const d = fromDayKey(dayKey);
  if (unit === "day") {
    d.setDate(d.getDate() + interval);
  } else if (unit === "week") {
    d.setDate(d.getDate() + 7 * interval);
  } else {
    const months = unit === "year" ? interval * 12 : interval;
    const y = d.getFullYear();
    const m = d.getMonth() + months;
    const last = new Date(y, m + 1, 0).getDate();
    return toDayKey(new Date(y, m, Math.min(anchorDay || d.getDate(), last)));
  }
  return toDayKey(d);
}

// Every occurrence date from `fromKey` up to (not including) the rule's new nextDate
function schedRuleOccurrences(r, fromKey, todayKey) {
  const out = [];
  const interval = Math.max(1, Number(r.interval) || 1);
  const anchor =
    Number(String(r.startDate || fromKey).slice(8, 10)) || undefined;
  const limit =
    !r.finished && isValidDayKey(r.nextDate) ? String(r.nextDate) : null;
  const endKey = isValidDayKey(r.endDate) ? String(r.endDate) : null;
  let d = fromKey;
  while (out.length < 400) {
    if (d > todayKey) break;
    if (endKey && d > endKey) break;
    if (limit && d >= limit) break;
    out.push(d);
    d = schedAddInterval(d, r.unit, interval, anchor);
  }
  return out;
}

function schedDayToISO(key) {
  return fromDayKey(key).toISOString();
}

function checkScheduledPayments() {
  // Only play while the app is on screen; otherwise it stays unseen and plays
  // when the person comes back.
  if (document.visibilityState !== "visible") return;
  if (!localStorage.getItem("evx-account")) return;
  if (_lastLoadAt === 0) return; // nothing loaded yet

  const today = toDayKey(new Date());
  const events = [];

  // ---- recurring rules ----
  const snap = schedRead(SCHED_REC_KEY);
  const nextSnap = {};
  (state.recurring || []).forEach((r) => {
    nextSnap[r.id] = schedRuleCursor(r);
    const prev = snap ? snap[r.id] : undefined;
    if (!prev || prev === "done" || !isValidDayKey(prev)) return;

    const dates = schedRuleOccurrences(r, prev, today);
    if (dates.length === 0) return;

    // Only incoming payments get the full-screen animation. Outgoing ones are
    // skipped here (their cursor is already stored in nextSnap above).
    const income = r.type === "income";
    if (!income) return;
    const title = "Λήψη πληρωμής";
    const amount = Number(r.amount) || 0;
    const base = {
      type: income ? "income" : "expense",
    };
    if (dates.length > SCHED_MAX_PER_RULE) {
      events.push({
        ...base,
        id: `rec-${r.id}-${dates[dates.length - 1]}-x${dates.length}`,
        amount: Math.round(amount * dates.length * 100) / 100,
        date: schedDayToISO(dates[dates.length - 1]),
        _recv: {
          from: r.name,
          note: `Επαναλαμβανόμενη πληρωμή · ${dates.length} φορές`,
          outgoing: !income,
          title,
        },
      });
    } else {
      dates.forEach((d) =>
        events.push({
          ...base,
          id: `rec-${r.id}-${d}`,
          amount,
          date: schedDayToISO(d),
          _recv: {
            from: r.name,
            note: "Επαναλαμβανόμενη πληρωμή",
            outgoing: !income,
            title,
          },
        }),
      );
    }
  });
  schedWrite(SCHED_REC_KEY, nextSnap);

  // ---- future (due-dated) payments ----
  const due = (state.payments || []).filter((p) => {
    const key = schedDueKey(p);
    return key && key <= today;
  });
  const seenPay = schedRead(SCHED_PAY_KEY);
  if (seenPay === null) {
    schedWrite(SCHED_PAY_KEY, due.map((p) => p.id));
  } else {
    const seenSet = new Set(seenPay.map(String));
    const fresh = due.filter((p) => !seenSet.has(String(p.id)));
    fresh.forEach((p) => {
      // Outgoing payments are marked seen (below) but never shown full screen
      const income = p.type === "incoming";
      if (!income) return;
      events.push({
        id: `pay-${p.id}`,
        type: income ? "income" : "expense",
        amount: Number(p.amount) || 0,
        date: schedDayToISO(schedDueKey(p)),
        _recv: {
          from: p.name,
          note: "Προγραμματισμένη πληρωμή",
          outgoing: !income,
          title: income ? "Λήψη πληρωμής" : "Πληρωμή",
        },
      });
    });
    if (fresh.length) {
      schedWrite(SCHED_PAY_KEY, [...seenPay, ...fresh.map((p) => p.id)].slice(-300));
    }
  }

  if (events.length === 0) return;
  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  recvState.queue.push(...events);
  if (!recvState.showing) showNextReceivedPayment();
}

// ============================================================================
// WEEKLY SPENDING RECAP (full screen)
// At the end of every week (Monday-Sunday) the total spent in the week that just
// ended is shown full screen, as a pixel-bar chart against the previous weeks,
// with a short text about whether the person spent less or more.
// It plays once per week: on the first open / resume / reconnect after the week
// ended. It goes through recvState.queue, so it plays after any payment
// animations. The first run on a device only records a baseline.
// Test from the console: previewWeeklyRecap()
// ============================================================================
const WK_SEEN_KEY = "tazroSeenWeeklyRecap";
const WK_MAX_WEEKS = 8;
const WK_MSGS = {
  less: [
    "Χαλάτε λιγότερα χρήματα...",
    "Χαλάτε λιγότερα από την προηγούμενη εβδομάδα...",
    "Οι δαπάνες σας μειώνονται...",
    "Κρατάτε τα έξοδα χαμηλά, μπράβο...",
  ],
  more: [
    "Χαλάτε περισσότερα χρήματα...",
    "Χαλάτε περισσότερα από την προηγούμενη εβδομάδα...",
    "Τα έξοδά σας ανεβαίνουν...",
    "Το πορτοφόλι σας ελάφρυνε λίγο παραπάνω...",
  ],
  same: [
    "Χαλάτε περίπου τα ίδια χρήματα...",
    "Κρατάτε τον ίδιο ρυθμό εξόδων...",
    "Σταθερά έξοδα σε σχέση με την προηγούμενη εβδομάδα...",
  ],
  zero: [
    "Δεν χαλάσατε καθόλου χρήματα...",
    "Μηδενικά έξοδα αυτή την εβδομάδα...",
  ],
  first: [
    "Ξεκινάμε να συγκρίνουμε τα εβδομαδιαία έξοδά σας...",
    "Πρώτη εβδομάδα με καταγεγραμμένα έξοδα...",
  ],
};
const wkState = { raf: 0, closing: false, closeTimer: 0, touchY: null };

// Monday 00:00 (local) of the week containing `date`
function wkMonday(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

// Totals of the last N weeks, oldest first; the last item is the week that ended
function wkBuildData(endedMonday) {
  const sums = {};
  let earliest = null;
  (state.transactions || []).forEach((t) => {
    const d = new Date(t.date);
    if (isNaN(d)) return;
    if (!earliest || d < earliest) earliest = d;
    if (t.type !== "expense") return;
    const k = toDayKey(wkMonday(d));
    sums[k] = (sums[k] || 0) + (Number(t.amount) || 0);
  });
  let avail = WK_MAX_WEEKS;
  if (earliest) {
    avail =
      Math.round((endedMonday - wkMonday(earliest)) / (7 * 86400000)) + 1;
  }
  const n = Math.max(2, Math.min(WK_MAX_WEEKS, avail));
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(endedMonday);
    m.setDate(m.getDate() - 7 * i);
    const k = toDayKey(m);
    weeks.push({ start: k, total: Math.round((sums[k] || 0) * 100) / 100 });
  }
  return weeks;
}

function wkPickMessage(cur, prev) {
  let pool;
  if (cur <= 0) pool = WK_MSGS.zero;
  else if (prev <= 0) pool = WK_MSGS.first;
  else {
    const r = cur / prev;
    pool = r < 0.95 ? WK_MSGS.less : r > 1.05 ? WK_MSGS.more : WK_MSGS.same;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function wkQueueRecap(id, weeks) {
  const cur = weeks[weeks.length - 1].total;
  const prev = weeks[weeks.length - 2].total;
  recvState.queue.push({
    id,
    _weekly: { weeks, msg: wkPickMessage(cur, prev) },
  });
  if (!recvState.showing) showNextReceivedPayment();
}

function checkWeeklyRecap() {
  if (document.visibilityState !== "visible") return;
  if (!localStorage.getItem("evx-account")) return;
  if (_lastLoadAt === 0) return; // nothing loaded yet

  const endedMonday = wkMonday(new Date());
  endedMonday.setDate(endedMonday.getDate() - 7);
  const key = toDayKey(endedMonday);

  let seen = null;
  try {
    seen = localStorage.getItem(WK_SEEN_KEY);
  } catch (_) {}
  if (seen === null) {
    // First run on this device: no replay, wait for the next week end
    try {
      localStorage.setItem(WK_SEEN_KEY, key);
    } catch (_) {}
    return;
  }
  if (seen >= key) return;

  try {
    localStorage.setItem(WK_SEEN_KEY, key);
  } catch (_) {}
  if (!(state.transactions || []).length) return;
  wkQueueRecap(`week-${key}`, wkBuildData(endedMonday));
}

function wkDayMonth(key) {
  return fromDayKey(key).toLocaleDateString("el-GR", {
    day: "numeric",
    month: "short",
  });
}

function showWeeklyRecap(data) {
  const overlay = document.getElementById("wk-overlay");
  if (!overlay || !data || !data.weeks || data.weeks.length < 2) {
    recvState.showing = false;
    if (recvState.queue.length) showNextReceivedPayment();
    return;
  }
  recvState.showing = true;
  recvState.closing = false;
  wkState.closing = false;

  const weeks = data.weeks;
  const last = weeks[weeks.length - 1];
  const cur = last.total;
  const decimals = Number.isInteger(cur) ? 0 : 2;
  const reduce =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const numEl = document.getElementById("wk-amount-num");
  const rangeEl = document.getElementById("wk-range");
  const msgEl = document.getElementById("wk-msg");
  if (numEl) numEl.textContent = recvFormatAmount(reduce ? cur : 0, decimals);
  if (rangeEl) {
    const s = fromDayKey(last.start);
    const e = new Date(s);
    e.setDate(e.getDate() + 6);
    rangeEl.textContent = `${wkDayMonth(last.start)} – ${wkDayMonth(toDayKey(e))}`;
  }
  if (msgEl) msgEl.textContent = data.msg || "";

  overlay.classList.remove("show", "hide");
  void overlay.offsetWidth;
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");

  wkStartChart(weeks, reduce);
  if (numEl && !reduce) recvCountUp(numEl, cur, decimals, 350, 1300);

  try {
    if (navigator.vibrate) navigator.vibrate([10, 50, 16]);
  } catch (_) {}
}

function dismissWeeklyRecap() {
  const overlay = document.getElementById("wk-overlay");
  if (!overlay || wkState.closing || !overlay.classList.contains("show")) return;
  wkState.closing = true;
  overlay.classList.remove("show");
  overlay.classList.add("hide");
  clearTimeout(wkState.closeTimer);
  wkState.closeTimer = setTimeout(() => {
    cancelAnimationFrame(wkState.raf);
    cancelAnimationFrame(recvState.countRaf);
    overlay.classList.remove("hide");
    overlay.setAttribute("aria-hidden", "true");
    wkState.closing = false;
    recvState.closing = false;
    recvState.showing = false;
    if (recvState.queue.length) showNextReceivedPayment();
  }, 460);
}

// Pixel-bar chart: one bar per week, oldest on the left, the week that just
// ended (orange) on the right. Previous weeks are grey; the two before it are
// labelled with their total.
function wkStartChart(weeks, reduce) {
  const canvas = document.getElementById("wk-canvas");
  const header = document.getElementById("wk-header");
  const footer = document.getElementById("wk-footer");
  if (!canvas) return;
  cancelAnimationFrame(wkState.raf);

  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth || window.innerWidth;
  const H = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const n = weeks.length;
  const cw = Math.max(2, Math.floor(32 / n)); // cells per bar
  const cell = W / (n * cw);
  const chartBottom = H - (footer ? footer.offsetHeight : 90) - 14;
  const chartTop = (header ? header.getBoundingClientRect().bottom : 160) + 46;
  const maxRows = Math.max(6, Math.floor((chartBottom - chartTop) / cell));
  const maxV = Math.max(1, ...weeks.map((w) => w.total));
  const rows = weeks.map((w) =>
    Math.max(1, Math.round((w.total / maxV) * maxRows)),
  );

  const ease = (x) => 1 - Math.pow(1 - x, 3);
  const mix = (a, b, t) => Math.round(a + (b - a) * t);
  const t0 = performance.now();

  function draw(now) {
    const el = reduce ? 99 : (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    const lps = weeks.map((_, i) => {
      const delay = i === n - 1 ? 0.95 : 0.25 + i * 0.07;
      return Math.min(1, Math.max(0, (el - delay) / (i === n - 1 ? 1.1 : 0.9)));
    });

    for (let i = 0; i < n; i++) {
      const isCur = i === n - 1;
      const lp = ease(lps[i]);
      const vis = Math.ceil(rows[i] * lp);
      for (let c = 0; c < cw; c++) {
        const x = (i * cw + c) * cell;
        for (let r = 0; r < vis; r++) {
          const y = chartBottom - (r + 1) * cell;
          const fade = 0.45 + 0.55 * Math.min(1, r / (maxRows * 0.6));
          let fill;
          if (isCur) {
            const t = rows[i] > 1 ? r / (rows[i] - 1) : 1;
            if (r === rows[i] - 1 && lps[i] >= 1) {
              const pulse = 0.78 + 0.22 * Math.sin(el * 3.2);
              fill = `rgba(255,66,33,${pulse})`;
            } else {
              fill = `rgb(${mix(105, 255, t)},${mix(48, 122, t)},${mix(20, 43, t)})`;
            }
            ctx.globalAlpha = 1;
          } else {
            fill = "#2d2d30";
            ctx.globalAlpha = fade;
          }
          ctx.fillStyle = fill;
          ctx.fillRect(x + 0.75, y + 0.75, cell - 1.5, cell - 1.5);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Labels above the two weeks before the one that just ended
    ctx.font = "600 12px Inter, -apple-system, system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    const barW = cw * cell;
    let prevY = null;
    [n - 2, n - 3].forEach((k) => {
      if (k < 0) return;
      const text = `${wkDayMonth(weeks[k].start)}: €${recvFormatAmount(weeks[k].total, Number.isInteger(weeks[k].total) ? 0 : 2)}`;
      const tw = ctx.measureText(text).width;
      const right = Math.max(tw + 6, (k + 1) * barW - 2);
      const left = right - tw;
      let top = chartBottom - rows[k] * cell;
      for (let j = Math.max(0, Math.floor(left / barW)); j <= k; j++) {
        top = Math.min(top, chartBottom - rows[j] * cell);
      }
      let y = top - 8;
      if (prevY !== null) y = Math.min(y, prevY - 17);
      y = Math.max(y, 16);
      prevY = y;
      ctx.fillStyle = `rgba(255,255,255,${0.45 * lps[k]})`;
      ctx.fillText(text, right, y);
    });
  }

  if (reduce) {
    draw(t0);
    return;
  }
  const loop = (now) => {
    draw(now);
    wkState.raf = requestAnimationFrame(loop);
  };
  wkState.raf = requestAnimationFrame(loop);
}

// Console tests:
//   previewWeeklyRecap()                  demo data
//   previewWeeklyRecap([120,300,90,410])  your own weekly totals, last = week that just ended
//   previewWeeklyRecap("real")            your real data for the last finished week
//   forceWeeklyRecapCheck()               runs the normal end-of-week check as if it never played
function previewWeeklyRecap(input) {
  const endedMonday = wkMonday(new Date());
  endedMonday.setDate(endedMonday.getDate() - 7);
  let weeks;
  if (input === "real") {
    weeks = wkBuildData(endedMonday);
  } else {
    const vals =
      Array.isArray(input) && input.length >= 2
        ? input.slice(-WK_MAX_WEEKS).map((v) => Number(v) || 0)
        : [180, 240, 210, 320, 150, 280, 260, 123];
    weeks = vals.map((v, idx) => {
      const m = new Date(endedMonday);
      m.setDate(m.getDate() - 7 * (vals.length - 1 - idx));
      return { start: toDayKey(m), total: v };
    });
  }
  wkQueueRecap(`week-preview-${Date.now()}`, weeks);
}

function forceWeeklyRecapCheck() {
  const d = wkMonday(new Date());
  d.setDate(d.getDate() - 14);
  try {
    localStorage.setItem(WK_SEEN_KEY, toDayKey(d));
  } catch (_) {}
  checkWeeklyRecap();
}

// ============================================================================
// PUSH NOTIFICATIONS (phone notifications)
// The server sends them (see /tazro/push/* in index.js). This part lets the
// person turn them on for this device, choose which ones they want, and makes
// a tap on a notification open the right thing:
//  - received / scheduled payment / weekly recap: the app opens and the
//    matching full-screen animation plays (they are still "unseen")
//  - upcoming payment: the scheduled payments list in the Transactions view
// ============================================================================
const ntfState = {
  serverEnabled: true,
  publicKey: "",
  subscribed: false,
  busy: false,
  prefs: {
    received: true,
    scheduledIn: true,
    upcoming: true,
    weekly: true,
    hideAmounts: false,
  },
};
const NTF_SYNC_KEY = "tazroPushSyncedAt";

function ntfSupported() {
  return (
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
  );
}

function ntfB64ToUint8(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function ntfRegistration() {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, rej) => setTimeout(() => rej(new Error("sw timeout")), 5000)),
  ]);
}

async function ntfGetSub() {
  try {
    const reg = await ntfRegistration();
    return await reg.pushManager.getSubscription();
  } catch (_) {
    return null;
  }
}

function ntfTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch (_) {
    return "";
  }
}

function ntfNoteText() {
  if (!ntfSupported()) {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    return ios && !isRunningAsPWA()
      ? "Στο iPhone, πρόσθεσε πρώτα την εφαρμογή στην Αρχική οθόνη και άνοιξέ τη από εκεί."
      : "Οι ειδοποιήσεις δεν υποστηρίζονται σε αυτή τη συσκευή ή τον browser.";
  }
  if (!ntfState.serverEnabled) return "Οι ειδοποιήσεις δεν είναι διαθέσιμες αυτή τη στιγμή.";
  if (Notification.permission === "denied")
    return "Οι ειδοποιήσεις είναι αποκλεισμένες. Ενεργοποίησέ τες από τις ρυθμίσεις της συσκευής.";
  return "";
}

function ntfRender() {
  const note = document.getElementById("ntf-note");
  const master = document.getElementById("ntf-master");
  const list = document.getElementById("ntf-prefs");
  const testBtn = document.getElementById("ntf-test-btn");
  if (!master) return;

  const text = ntfNoteText();
  const usable = !text;
  if (note) {
    note.textContent = text;
    note.hidden = !text;
  }
  master.checked = usable && ntfState.subscribed;
  master.disabled = !usable || ntfState.busy;

  if (list) list.classList.toggle("disabled", !master.checked);
  document.querySelectorAll("[data-ntf-pref]").forEach((el) => {
    el.checked = !!ntfState.prefs[el.dataset.ntfPref];
    el.disabled = !master.checked;
  });
  if (testBtn) testBtn.disabled = !master.checked || ntfState.busy;
}

async function ntfLoad() {
  if (!ntfSupported()) return;
  try {
    const sub = await ntfGetSub();
    const info = await apiGet(
      `/push/prefs?endpoint=${encodeURIComponent(sub ? sub.endpoint : "")}`,
    );
    ntfState.serverEnabled = !!info.enabled;
    ntfState.publicKey = info.publicKey || "";
    ntfState.prefs = { ...ntfState.prefs, ...(info.prefs || {}) };
    ntfState.subscribed =
      !!info.subscribed && !!sub && Notification.permission === "granted";
  } catch (_) {
    /* apiFetch already shows a toast */
  }
}

async function openNotificationsSheet() {
  const overlay = document.getElementById("ntf-sheet-overlay");
  if (!overlay) return;
  ntfRender();
  overlay.classList.add("visible");
  await ntfLoad();
  ntfRender();
}

function closeNotificationsSheet() {
  const overlay = document.getElementById("ntf-sheet-overlay");
  if (overlay) overlay.classList.remove("visible");
}

async function ntfToggleMaster(on) {
  if (ntfState.busy) return;
  ntfState.busy = true;
  ntfRender();
  try {
    if (on) {
      if (!ntfState.publicKey) await ntfLoad();
      if (!ntfState.serverEnabled || !ntfState.publicKey) {
        showToast("fa-solid fa-triangle-exclamation", "Οι ειδοποιήσεις δεν είναι διαθέσιμες");
        return;
      }
      const perm =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      if (perm !== "granted") {
        showToast("fa-solid fa-triangle-exclamation", "Δεν επιτράπηκαν οι ειδοποιήσεις");
        return;
      }
      const reg = await ntfRegistration();
      const key = ntfB64ToUint8(ntfState.publicKey);
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
      }
      await apiPost("/push/subscribe", {
        subscription: sub.toJSON(),
        tz: ntfTimezone(),
      });
      ntfState.subscribed = true;
      try {
        localStorage.setItem(NTF_SYNC_KEY, String(Date.now()));
      } catch (_) {}
      showToast("fa-solid fa-circle-check", "Οι ειδοποιήσεις ενεργοποιήθηκαν");
    } else {
      const sub = await ntfGetSub();
      if (sub) {
        await apiPost("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      ntfState.subscribed = false;
    }
  } catch (e) {
    ntfState.subscribed = on ? false : ntfState.subscribed;
    if (!e || !e.message || e.message !== "sw timeout") {
      showToast("fa-solid fa-triangle-exclamation", "Κάτι πήγε στραβά με τις ειδοποιήσεις");
    }
  } finally {
    ntfState.busy = false;
    ntfRender();
  }
}

async function ntfTogglePref(key, value) {
  const prev = ntfState.prefs[key];
  ntfState.prefs[key] = !!value;
  try {
    await apiPut("/push/prefs", { prefs: { [key]: !!value }, tz: ntfTimezone() });
  } catch (_) {
    ntfState.prefs[key] = prev;
  }
  ntfRender();
}

async function ntfSendTest() {
  if (ntfState.busy) return;
  ntfState.busy = true;
  ntfRender();
  try {
    const r = await apiPost("/push/test", {});
    showToast(
      r && r.delivered ? "fa-solid fa-circle-check" : "fa-solid fa-triangle-exclamation",
      r && r.delivered
        ? "Στάλθηκε δοκιμαστική ειδοποίηση"
        : "Δεν βρέθηκε συνδεδεμένη συσκευή",
    );
  } catch (_) {
    /* toast already shown */
  } finally {
    ntfState.busy = false;
    ntfRender();
  }
}

// Once a day, quietly re-register this device (keeps the timezone current and
// restores the device if the server dropped it, e.g. after switching accounts).
async function ntfQuietResync() {
  try {
    if (!ntfSupported() || Notification.permission !== "granted") return;
    if (navigator.onLine === false || !getAuthToken()) return;
    const last = Number(localStorage.getItem(NTF_SYNC_KEY) || 0);
    if (Date.now() - last < 20 * 3600 * 1000) return;
    const sub = await ntfGetSub();
    if (!sub) return;
    const res = await fetch(API + "/push/subscribe", {
      method: "POST",
      headers: withAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ subscription: sub.toJSON(), tz: ntfTimezone() }),
    });
    if (res.ok) localStorage.setItem(NTF_SYNC_KEY, String(Date.now()));
  } catch (_) {}
}

// ---- First-login popup: asks once (per device) whether to turn notifications on.
// Only shown when the browser supports push, the server has it configured, the
// permission has not been decided yet and this device is not already subscribed.
// Whatever the person answers, we do not ask again - the bell on the home
// screen (openNotificationsSheet) stays available to switch them on or off.
const NTF_PROMPT_KEY = "tazroNtfPromptDone";

function ntfPromptDone() {
  try {
    return !!localStorage.getItem(NTF_PROMPT_KEY);
  } catch (_) {
    return true;
  }
}

function ntfPromptMark() {
  try {
    localStorage.setItem(NTF_PROMPT_KEY, String(Date.now()));
  } catch (_) {}
}

function ntfPromptSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ntfMaybePrompt() {
  try {
    if (window._ntfPromptChecked) return;
    window._ntfPromptChecked = true;
    if (!localStorage.getItem("evx-account")) return;
    if (!ntfSupported() || Notification.permission !== "default") return;
    if (ntfPromptDone()) return;

    // Let the home screen settle, and never stack on top of the full-screen
    // update / received / scheduled / weekly animations.
    await (window._updCheck || Promise.resolve());
    await ntfPromptSleep(1500);
    for (let i = 0; i < 180 && recvState.showing; i++) await ntfPromptSleep(1000);
    if (recvState.showing) return; // try again on the next launch

    // Load the server's public key now, so tapping "Ενεργοποίηση" can ask for
    // permission immediately (iOS requires that to happen inside the tap).
    await ntfLoad();
    if (!ntfState.serverEnabled || !ntfState.publicKey || ntfState.subscribed) return;
    if (!localStorage.getItem("evx-account")) return;
    if (Notification.permission !== "default") return;

    const overlay = document.getElementById("ntf-prompt-overlay");
    if (!overlay) return;
    overlay.setAttribute("aria-hidden", "false");
    overlay.classList.add("visible");
  } catch (_) {}
}

function ntfPromptClose() {
  const overlay = document.getElementById("ntf-prompt-overlay");
  if (!overlay) return;
  overlay.classList.remove("visible");
  overlay.setAttribute("aria-hidden", "true");
}

async function ntfPromptAccept() {
  const yes = document.getElementById("ntf-prompt-yes");
  const later = document.getElementById("ntf-prompt-later");
  if (yes) yes.disabled = true;
  if (later) later.disabled = true;
  ntfPromptMark();
  try {
    await ntfToggleMaster(true); // asks for permission, subscribes, shows a toast
  } finally {
    ntfPromptClose();
    if (yes) yes.disabled = false;
    if (later) later.disabled = false;
  }
}

function ntfPromptDismiss() {
  ntfPromptMark();
  ntfPromptClose();
}

// Scheduled payments list = the collapsible section in the Transactions view
function ntfOpenUpcoming() {
  switchView("transactions");
  setTimeout(() => {
    const list = document.getElementById("upcoming-payments-list");
    if (list && !list.classList.contains("open")) toggleUpcomingSection();
    const section = document.getElementById("upcoming-payments-section");
    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 350);
}

// App opened from a notification (cold start): ?ntf=<kind>
function ntfHandleOpenParam() {
  let kind = "";
  try {
    kind = new URLSearchParams(location.search).get("ntf") || "";
    if (kind) history.replaceState(null, "", location.pathname + location.hash);
  } catch (_) {}
  if (kind === "upcoming") ntfOpenUpcoming();
}

function ntfWhenVisible() {
  if (document.visibilityState === "visible") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      document.removeEventListener("visibilitychange", onVis);
      resolve();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") done();
    };
    document.addEventListener("visibilitychange", onVis);
    setTimeout(done, 1500);
  });
}

// App already open when a notification is tapped (service worker message)
function ntfInitMessages() {
  if (!("serviceWorker" in navigator) || window._ntfMsgHook) return;
  window._ntfMsgHook = true;
  navigator.serviceWorker.addEventListener("message", async (e) => {
    const d = e.data || {};
    if (d.type !== "ntf-open") return;
    if (!localStorage.getItem("evx-account")) return;
    await ntfWhenVisible();
    await loadData();
    renderView(state.currentView);
    renderBalanceCard();
    renderRecentTransactions();
    renderRecurringEntry();
    checkReceivedPayments();
    checkScheduledPayments();
    checkWeeklyRecap();
    if (d.kind === "upcoming") ntfOpenUpcoming();
  });
}

// ============================================================================
// APP UPDATED SCREEN ("what's new")
// The version is the service worker's cache name (CACHE in sw.js). When it
// differs from localStorage "tazroVersion", a full-screen animation lists what
// is new; closing it stores the version so it is shown once per update.
// It goes through recvState.queue, so it never overlaps the other full-screen
// animations and always plays first.
// ============================================================================
const UPD_VERSION_KEY = "tazroVersion";
const updState = { raf: 0, closeTimer: 0, closing: false, version: "" };

async function updGetSwVersion() {
  // 1) Ask the service worker that is running right now
  try {
    if ("serviceWorker" in navigator) {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, rej) => setTimeout(() => rej(new Error("sw timeout")), 2000)),
      ]);
      const sw = navigator.serviceWorker.controller || reg.active;
      if (sw) {
        const v = await new Promise((resolve) => {
          const ch = new MessageChannel();
          const t = setTimeout(() => resolve(""), 1500);
          ch.port1.onmessage = (e) => {
            clearTimeout(t);
            resolve((e.data && e.data.version) || "");
          };
          sw.postMessage({ type: "get-version" }, [ch.port2]);
        });
        if (v) return String(v);
      }
    }
  } catch (_) {}

  // 2) Fallback (e.g. the old worker does not answer yet): read the deployed sw.js
  try {
    const res = await fetch("sw.js", { cache: "no-store" });
    if (!res.ok) return "";
    const m = /CACHE\s*=\s*['"]([^'"]+)['"]/.exec(await res.text());
    return m ? m[1] : "";
  } catch (_) {
    return "";
  }
}

async function updMaybeShow() {
  try {
    if (window._updChecked) return;
    window._updChecked = true;
    if (!localStorage.getItem("evx-account")) return;
    const version = await updGetSwVersion();
    if (!version) return;
    if (localStorage.getItem(UPD_VERSION_KEY) === version) return;
    if (!localStorage.getItem("evx-account")) return;
    updState.version = version;
    recvState.queue.unshift({ _update: true });
    if (!recvState.showing) showNextReceivedPayment();
  } catch (_) {}
}

function showUpdateScreen() {
  const overlay = document.getElementById("upd-overlay");
  if (!overlay) {
    recvState.showing = false;
    if (recvState.queue.length) showNextReceivedPayment();
    return;
  }
  recvState.showing = true;
  recvState.closing = false;
  updState.closing = false;
  const reduce =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const list = overlay.querySelector(".upd-list");
  if (list) list.scrollTop = 0;

  clearTimeout(updState.closeTimer);
  overlay.classList.remove("show", "hide");
  void overlay.offsetWidth;
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");

  updStartParticles(reduce);

  try {
    if (navigator.vibrate) navigator.vibrate([12, 60, 22]);
  } catch (_) {}
}

function dismissUpdateScreen() {
  const overlay = document.getElementById("upd-overlay");
  if (!overlay || updState.closing || !overlay.classList.contains("show")) return;
  updState.closing = true;
  if (updState.version) {
    try {
      localStorage.setItem(UPD_VERSION_KEY, updState.version);
    } catch (_) {}
  }
  overlay.classList.remove("show");
  overlay.classList.add("hide");
  clearTimeout(updState.closeTimer);
  updState.closeTimer = setTimeout(() => {
    cancelAnimationFrame(updState.raf);
    overlay.classList.remove("hide");
    overlay.setAttribute("aria-hidden", "true");
    updState.closing = false;
    recvState.closing = false;
    recvState.showing = false;
    if (recvState.queue.length) showNextReceivedPayment();
  }, 460);
}

// Star dust + glitter streams falling behind the headline (same feel as the
// received-payment screen, in the five feature colours)
function updStartParticles(reduce) {
  const canvas = document.getElementById("upd-canvas");
  if (!canvas) return;
  cancelAnimationFrame(updState.raf);

  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth || window.innerWidth;
  const H = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const streamTop = H * 0.03;
  const streamH = Math.min(H * 0.32, 300);
  const colW = Math.min(W * 0.11, 56);
  const cols = [280, 198, 135, 32, 212].map((hue, i) => ({
    x: W * (0.12 + i * 0.19),
    hue,
  }));

  function makeStream(c, initial) {
    const spread = Math.random() + Math.random() - 1;
    return {
      c,
      x: c.x + spread * colW,
      p: initial ? Math.random() : 0,
      speed: 0.11 + Math.random() * 0.24,
      size: 0.9 + Math.random() * 2.1,
      phase: Math.random() * Math.PI * 2,
      tw: 3 + Math.random() * 7,
      sway: 1.5 + Math.random() * 5,
      shard: Math.random() < 0.5,
      color: `hsl(${c.hue + (Math.random() - 0.5) * 30} ${55 + Math.random() * 30}% ${
        64 + Math.random() * 28
      }%)`,
    };
  }

  const perCol = reduce ? 16 : 34;
  const streams = [];
  cols.forEach((c) => {
    for (let i = 0; i < perCol; i++) streams.push(makeStream(c, true));
  });

  const stars = Array.from({ length: reduce ? 30 : 90 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    s: 0.6 + Math.random() * 1.1,
    ph: Math.random() * Math.PI * 2,
    tw: 0.8 + Math.random() * 2.4,
    vy: 2 + Math.random() * 7,
  }));

  const start = performance.now();
  let last = start;

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - start) / 1000;
    const intro = Math.min(1, t / 0.9);

    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = "#cfd9ea";
    const starIn = Math.min(1, t / 0.6);
    for (const s of stars) {
      s.y += s.vy * dt;
      if (s.y > H + 2) {
        s.y = -2;
        s.x = Math.random() * W;
      }
      ctx.globalAlpha = (0.15 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.tw + s.ph))) * starIn;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }

    for (let i = 0; i < streams.length; i++) {
      let q = streams[i];
      q.p += q.speed * dt;
      if (q.p >= 1) q = streams[i] = makeStream(q.c, false);
      const p = q.p;
      const env = Math.min(1, p / 0.12) * Math.min(1, (1 - p) / 0.3);
      const twinkle = 0.5 + 0.5 * Math.sin(t * q.tw + q.phase);
      const a = env * (0.35 + 0.65 * twinkle) * intro;
      if (a < 0.02) continue;
      const x = q.x + Math.sin(t * 1.2 + q.phase) * q.sway;
      const y = streamTop + p * streamH;
      ctx.globalAlpha = a;
      ctx.fillStyle = q.color;
      if (q.shard) ctx.fillRect(x, y, q.size * 0.7, q.size * 2.2);
      else ctx.fillRect(x, y, q.size, q.size);
    }

    ctx.globalAlpha = 1;
    updState.raf = requestAnimationFrame(frame);
  }
  updState.raf = requestAnimationFrame(frame);
}

// Handy for testing from the console: previewUpdateScreen()
// (to see it for real: localStorage.removeItem("tazroVersion") and reload)
function previewUpdateScreen() {
  recvState.queue.push({ _update: true });
  if (!recvState.showing) showNextReceivedPayment();
}

// Handy for testing from the console: previewReceivedPayment(20, "Elisha", "Thank you x 20!")
function previewReceivedPayment(amount = 20, name = "Elisha", note = "") {
  recvState.queue.push({
    id: `preview-${Date.now()}`,
    type: "income",
    amount,
    name: note ? `${name}: ${note}` : name,
    peerUsername: name,
    peerPfp: "",
    date: new Date().toISOString(),
  });
  if (!recvState.showing) showNextReceivedPayment();
}

// Start
document.addEventListener("DOMContentLoaded", () => init());

document
  .getElementById("transaction-title")
  .addEventListener("focus", function () {
    if (this.getAttribute("data-auto-filled") === "true") {
      this.value = "";
      this.setAttribute("data-auto-filled", "false");
    }
  });