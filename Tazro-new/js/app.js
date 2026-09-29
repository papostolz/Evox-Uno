/* ============================================
   Finavox — Apple-Style Finance App
   Application Logic
   ============================================ */

// ---- STATE ----
const defaultState = {
  user: { name: 'Unknown', initial: 'G' },
  balance: 1957.43,
  savings: 842.50,
  currentView: 'home',
  selectedDate: new Date(),
  addSheetOpen: false,
  debtSheetOpen: false,
  goalSheetOpen: false,
  addType: 'expense',
  amountStr: '',
  selectedCategory: null,
  debtType: 'owe',
  savingsTransferSource: 'main',
  debtViewTab: 'owe',
  faIconPickerOpen: false,
  faFreeIcons: [],
  faFilteredFreeIcons: [],
  faIconPage: 0,
  faIconQuery: '',
  faIconsLoading: false,
  editingDebtId: null,
  isFuturePayment: false,
  futurePaymentDueDate: '',
  paymentViewTab: 'incoming',
  editingPaymentId: null,
  transactionFilter: 'all',
  searchQuery: '',
  transactions: [],
  savingsGoals: [],
  debts: [],
  payments: [],
};

let persistedState = null;
try {
  const rawState = localStorage.getItem('tazroState');
  persistedState = rawState ? JSON.parse(rawState) : null;
} catch (_err) {
  persistedState = null;
}

const state = {
  ...defaultState,
  ...(persistedState && typeof persistedState === 'object' ? persistedState : {}),
  user: {
    ...defaultState.user,
    ...(persistedState && persistedState.user ? persistedState.user : {}),
  },
};

// ---- SAVINGS HISTORY ----
const SAVINGS_HISTORY_KEY = 'tazroSavingsHistory';

function recordSavingsSnapshot() {
  let history = [];
  try { history = JSON.parse(localStorage.getItem(SAVINGS_HISTORY_KEY)) || []; } catch { }
  history.push({ date: new Date().toISOString(), savings: state.savings });
  if (history.length > 90) history = history.slice(-90);
  localStorage.setItem(SAVINGS_HISTORY_KEY, JSON.stringify(history));
}

function getSavingsHistory() {
  try { return JSON.parse(localStorage.getItem(SAVINGS_HISTORY_KEY)) || []; } catch { return []; }
}

// ---- API ----
const API = 'https://uno.evox.uno/tazro';

function getAuthToken() {
  const localToken = localStorage.getItem('evx-account') ? JSON.parse(localStorage.getItem('evx-account')).evxToken : '';

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
    showToast('fa-solid fa-triangle-exclamation', e.message || 'Σφάλμα σύνδεσης');
    throw e;
  }
}

function apiGet(path) { return apiFetch(path); }
function apiDelete(path) { return apiFetch(path, { method: 'DELETE' }); }
function apiPost(path, body) { return apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
function apiPut(path, body) { return apiFetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

async function loadData() {
  const data = await apiGet('/data').catch(() => null);
  if (!data) return;
  state.balance = data.balance ?? 0;
  state.savings = data.savings ?? 0;
  state.transactions = data.transactions ?? [];
  state.savingsGoals = data.goals ?? [];
  state.debts = data.debts ?? [];
  state.payments = data.payments ?? [];

  // Seed savings history on first run so the chart always has a starting point
  if (getSavingsHistory().length === 0) recordSavingsSnapshot();
}

// ---- SSE ----
let _sseSource = null;

function initSSE() {
  const token = getAuthToken();
  if (!token) return;
  if (_sseSource) { _sseSource.close(); _sseSource = null; }

  const dot = document.getElementById('sse-dot');
  const url = `${API}/stream?evxToken=${encodeURIComponent(token)}`;
  _sseSource = new EventSource(url);

  _sseSource.addEventListener('update', (e) => {
    const d = JSON.parse(e.data);
    if (d.balance !== undefined) state.balance = d.balance;
    if (d.savings !== undefined) state.savings = d.savings;
    if (Array.isArray(d.transactions)) state.transactions = d.transactions;
    renderBalanceCard();
    renderFlowCard();
    renderStats();
    if (Array.isArray(d.transactions)) {
      renderRecentTransactions();
      if (state.currentView === 'transactions') renderTransactions();
    }
  });

  _sseSource.addEventListener('aiTips', (e) => {
    const d = JSON.parse(e.data);
    if (Array.isArray(d.aiTips)) {
      const forecasts = d.aiTips.filter(t => t.type === 'forecast');
      const tips      = d.aiTips.filter(t => t.type === 'tips');
      if (forecasts.length || tips.length) renderAIInsights();
    }
  });

  _sseSource.onopen = () => { if (dot) { dot.className = 'sse-dot sse-dot--on'; dot.title = 'Live'; } };
  _sseSource.onerror = () => {
    if (dot) { dot.className = 'sse-dot sse-dot--off'; dot.title = 'Offline'; }
    // auto-reconnect: browser retries EventSource by default
  };
}

// ---- HELPERS ----
function formatCurrency(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 0) return 'Σήμερα';
  if (diff === 1) return 'Χθες';
  if (diff < 7) return d.toLocaleDateString('el-GR', { weekday: 'long' });
  return d.toLocaleDateString('el-GR', { month: 'short', day: 'numeric' });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('el-GR', { hour: 'numeric', minute: '2-digit' });
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
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function toDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fromDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// ---- CATEGORIES ----
const categories = {
  expense: [
    { id: 'food', name: 'Φαγητό', icon: 'fa-solid fa-burger', bg: '#FFF3E021' },
    { id: 'coffee', name: 'Καφές', icon: 'fa-solid fa-mug-hot', bg: '#EFEBE921' },
    { id: 'transport', name: 'Μεταφορά', icon: 'fa-solid fa-bus', bg: '#E3F2FD21' },
    { id: 'books', name: 'Βιβλία', icon: 'fa-solid fa-book', bg: '#FCE4EC21' },
    { id: 'entertainment', name: 'Διασκέδαση', icon: 'fa-solid fa-gamepad', bg: '#F3E5F521' },
    { id: 'shopping', name: 'Ψώνια', icon: 'fa-solid fa-shirt', bg: '#E8F5E921' },
    { id: 'subscriptions', name: 'Συνδρομές', icon: 'fa-solid fa-mobile-screen-button', bg: '#E0F7FA21' },
    { id: 'health', name: 'Υγεία', icon: 'fa-solid fa-capsules', bg: '#FFF8E121' },
    { id: 'utilities', name: 'Λογαριασμοί', icon: 'fa-solid fa-lightbulb', bg: '#FFFDE721' },
    { id: 'rent', name: 'Ενοίκιο', icon: 'fa-solid fa-house', bg: '#F1F8E921' },
    { id: 'other_expense', name: 'Άλλο', icon: 'fa-solid fa-thumbtack', bg: '#ECEFF121' },
  ],
  income: [
    { id: 'job', name: 'Εργασία', icon: 'fa-solid fa-briefcase', bg: '#E8F5E921' },
    { id: 'scholarship', name: 'Υποτροφία', icon: 'fa-solid fa-graduation-cap', bg: '#FFF8E121' },
    { id: 'family', name: 'Οικογένεια', icon: 'fa-solid fa-people-group', bg: '#FCE4EC21' },
    { id: 'freelance', name: 'Freelance', icon: 'fa-solid fa-sack-dollar', bg: '#F3E5F521' },
    { id: 'aid', name: 'Ενίσχυση', icon: 'fa-solid fa-building-columns', bg: '#E3F2FD21' },
    { id: 'gift', name: 'Δώρο', icon: 'fa-solid fa-gift', bg: '#FFF3E021' },
    { id: 'refund', name: 'Επιστροφή', icon: 'fa-solid fa-rotate-left', bg: '#E0F7FA21' },
    { id: 'other_income', name: 'Άλλο', icon: 'fa-solid fa-thumbtack', bg: '#ECEFF121' },
  ],
};

function getCategoryInfo(id) {
  const all = [...categories.expense, ...categories.income];
  return all.find(c => c.id === id) || { icon: 'fa-solid fa-thumbtack', name: 'Άλλο', bg: '#eceff121' };
}

function sanitizeFaClass(iconClass, fallback = 'fa-solid fa-circle') {
  if (typeof iconClass !== 'string') return fallback;
  const trimmed = iconClass.trim();
  if (!trimmed) return fallback;
  if (!/^fa[a-z-]*\s+fa-[a-z0-9-]+(?:\s+fa-[a-z0-9-]+)*$/i.test(trimmed)) return fallback;
  return trimmed;
}

function renderFaIcon(iconClass, fallback, extraClass = '') {
  const safe = sanitizeFaClass(iconClass, fallback);
  const cls = extraClass ? `${safe} ${extraClass}` : safe;
  return `<i class="${cls}" aria-hidden="true"></i>`;
}

const FA_FREE_ICONS_URL = 'https://raw.githubusercontent.com/mehmetsahindev/FontAwesome-v6.4.2.json/refs/heads/master/fontawesome-v6.4.2-free.json';
const FA_STYLE_TO_CLASS = {
  solid: 'fa-solid',
  regular: 'fa-regular',
  brands: 'fa-brands',
};
const FA_ICON_PAGE_SIZE = 180;
const FALLBACK_FREE_ICON_CLASSES = [
  'fa-solid fa-bullseye',
  'fa-solid fa-house',
  'fa-solid fa-wallet',
  'fa-solid fa-piggy-bank',
  'fa-solid fa-briefcase',
  'fa-solid fa-car',
  'fa-solid fa-plane',
  'fa-solid fa-bus',
  'fa-solid fa-book',
  'fa-solid fa-graduation-cap',
  'fa-solid fa-gamepad',
  'fa-solid fa-heart',
  'fa-solid fa-dumbbell',
  'fa-solid fa-cart-shopping',
  'fa-solid fa-lightbulb',
  'fa-solid fa-mobile-screen-button',
  'fa-solid fa-camera',
  'fa-solid fa-laptop',
  'fa-solid fa-gift',
  'fa-solid fa-star',
  'fa-solid fa-gem',
  'fa-solid fa-rocket',
  'fa-solid fa-seedling',
  'fa-solid fa-hand-holding-dollar',
  'fa-brands fa-apple',
  'fa-brands fa-google',
  'fa-brands fa-paypal',
  'fa-brands fa-amazon',
  'fa-brands fa-github',
  'fa-brands fa-linkedin',
];

let _faIconLoadPromise = null;

function normalizeFreeFaIcons(rawIcons) {
  const unique = new Set();
  const normalized = [];

  rawIcons.forEach(icon => {
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
      if (!res.ok) throw new Error('Could not load Font Awesome metadata');

      const metadata = await res.json();
      const icons = [];

      // metadata = { solid: ["fa-house", ...], regular: [...], brands: [...] }
      Object.entries(metadata || {}).forEach(([style, iconList]) => {
        const styleClass = FA_STYLE_TO_CLASS[style];
        if (!styleClass || !Array.isArray(iconList)) return;

        iconList.forEach(iconName => {
          const safeName = iconName.startsWith('fa-') ? iconName : `fa-${iconName}`;

          icons.push({
            className: `${styleClass} ${safeName}`,
            name: safeName,
            label: safeName.replace('fa-', '').replace(/-/g, ' '),
            style,
          });
        });
      });

      state.faFreeIcons = normalizeFreeFaIcons(icons);

      if (!state.faFreeIcons.length) {
        throw new Error('No free icon metadata returned');
      }

      return true;
    } catch (_err) {
      console.log("err", _err);

      state.faFreeIcons = normalizeFreeFaIcons(
        FALLBACK_FREE_ICON_CLASSES.map(cls => ({
          className: cls,
          name: cls.split(' ').slice(1).join(' '),
          label: cls,
          style: cls.split(' ')[0].replace('fa-', ''),
        }))
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
  const input = document.getElementById('goal-icon-input');
  const iconSlot = document.getElementById('goal-icon-preview-icon');
  const textSlot = document.getElementById('goal-icon-preview-text');
  const safeClass = sanitizeFaClass(input ? input.value : '', 'fa-solid fa-bullseye');

  if (iconSlot) iconSlot.innerHTML = renderFaIcon(safeClass, 'fa-solid fa-bullseye');
  if (textSlot) textSlot.textContent = safeClass.replace('fa-', '').replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase()).split(' ')
    .slice(2)
    .join(' ');
}

function renderFaIconGrid() {
  const grid = document.getElementById('fa-icon-grid');
  const countEl = document.getElementById('fa-picker-count');
  const loadMoreBtn = document.getElementById('fa-picker-load-more');
  const selected = sanitizeFaClass((document.getElementById('goal-icon-input') || {}).value || '', 'fa-solid fa-bullseye');

  if (!grid) return;

  const max = state.faIconPage * FA_ICON_PAGE_SIZE;
  const visibleIcons = state.faFilteredFreeIcons.slice(0, max);

  if (!visibleIcons.length) {
    grid.innerHTML = '<div class="fa-picker-empty">Δεν βρέθηκαν εικονίδια.</div>';
  } else {
    grid.innerHTML = visibleIcons.map(icon => `
      <button type="button" class="fa-picker-item ${icon.className === selected ? 'selected' : ''}" data-icon="${icon.className}" title="${icon.className}">
        <span class="fa-picker-item-icon">${renderFaIcon(icon.className, 'fa-solid fa-circle')}</span>
        <span class="fa-picker-item-name">${icon.name.replace('fa-', '').replace(/-/g, ' ').replace("icon", "").replace(/\b\w/g, char => char.toUpperCase())}</span>
      </button>
    `).join('');

    grid.querySelectorAll('.fa-picker-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('goal-icon-input');
        const iconClass = sanitizeFaClass(btn.dataset.icon, 'fa-solid fa-bullseye');
        if (input) input.value = iconClass;
        updateGoalIconPreview();
        closeFaIconPicker();
      });
    });
  }

  if (countEl) countEl.textContent = `${visibleIcons.length} / ${state.faFilteredFreeIcons.length}`;
  if (loadMoreBtn) loadMoreBtn.style.display = visibleIcons.length < state.faFilteredFreeIcons.length ? 'block' : 'none';
}

function applyFaIconFilter(query = '') {
  const q = String(query).trim().toLowerCase();
  state.faIconQuery = q;

  state.faFilteredFreeIcons = !q
    ? [...state.faFreeIcons]
    : state.faFreeIcons.filter(icon => (
      icon.name.toLowerCase().includes(q)
      || icon.className.toLowerCase().includes(q)
      || icon.label.toLowerCase().includes(q)
    ));

  state.faIconPage = 1;
  renderFaIconGrid();
}

async function openFaIconPicker() {
  const modal = document.getElementById('fa-icon-picker-modal');
  const loadingEl = document.getElementById('fa-picker-loading');
  const searchEl = document.getElementById('fa-icon-search');
  if (!modal) return;

  state.faIconPickerOpen = true;
  modal.classList.add('visible');
  if (loadingEl) loadingEl.hidden = false;

  const loadedFromMetadata = await loadFreeFaIcons();
  if (!loadedFromMetadata) {
    showToast('fa-solid fa-circle-info', 'Χωρίς internet: Έγινε φόρτωση βασικών icons');
  }

  if (loadingEl) loadingEl.hidden = true;
  if (searchEl) {
    searchEl.value = '';
    searchEl.focus();
  }
  applyFaIconFilter('');
}

function closeFaIconPicker() {
  const modal = document.getElementById('fa-icon-picker-modal');
  if (!modal) return;
  modal.classList.remove('visible');
  state.faIconPickerOpen = false;
}

// ---- SVG ICONS ----
const icons = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  piggy: '<svg viewBox="0 0 24 24"><path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-3.5c1.3-1.2 2-2.7 2-4.5 0-2-1-3-1-3s1-1.5 1-3.5c0-.6-.5-1.5-1-1.5z" stroke-linecap="round" stroke-linejoin="round"/><circle cx="14" cy="10" r="0.5" fill="currentColor" stroke="none"/></svg>',
  users: '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" stroke-linecap="round"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  creditCard: '<svg viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/></svg>',
  x: '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  check: '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  delete: '<svg viewBox="0 0 24 24"><path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z" stroke-linecap="round" stroke-linejoin="round"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevDown: '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrowUp: '<svg viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrowDown: '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  wallet: '<svg viewBox="0 0 24 24"><path d="M21 12V7H5a2 2 0 010-4h14v4" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 5v14a2 2 0 002 2h16v-5" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 12a2 2 0 100 4h4v-4h-4z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

// ---- TIME ----
function updateTime() {
  const now = new Date();
  const el = document.getElementById('status-time');
  if (el) el.textContent = now.toLocaleTimeString('el-GR', { hour: 'numeric', minute: '2-digit', hour12: false });
}

// ---- NAVIGATION ----
function switchView(viewId) {
  if (viewId === state.currentView) return;
  const oldView = document.querySelector('.view.active');
  const newView = document.getElementById(viewId);
  if (!oldView || !newView) return;

  const tabs = ['home', 'transactions', 'savings', 'debts'];
  const oldIdx = tabs.indexOf(state.currentView);
  const newIdx = tabs.indexOf(viewId);

  oldView.classList.remove('active');
  if (newIdx > oldIdx) oldView.classList.add('exit-left');

  setTimeout(() => {
    oldView.classList.remove('exit-left');
    oldView.style.transform = '';
  }, 300);

  newView.classList.add('active');
  state.currentView = viewId;

  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  const tabEl = document.querySelector(`[data-tab="${viewId}"]`);
  if (tabEl) tabEl.classList.add('active');

  renderView(viewId);
  setupAnimateIn(newView);
}

function renderView(viewId) {
  switch (viewId) {
    case 'home': renderHome(); break;
    case 'transactions': renderTransactions(); break;
    case 'savings': renderSavings(); break;
    case 'debts': renderDebts(); break;
  }
}

// ---- AI INSIGHTS ----

/**
 * Toggles the forecast card between collapsed and expanded states.
 */
function toggleForecastCard() {
  const card = document.getElementById('ai-forecast-card');
  if (card) card.classList.toggle('collapsed');
}

/**
 * Shows the hidden tips (called when user taps "Δείτε περισσότερα").
 */
function showMoreTips() {
  const btn = document.getElementById('ai-tips-more-btn');
  document.querySelectorAll('#ai-tips-list .ai-tip-card.ai-tip-hidden').forEach((el, i) => {
    el.classList.remove('ai-tip-hidden');
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
    case 'view_spending': switchView('transactions'); break;
    case 'view_debts':    switchView('debts'); break;
    case 'view_savings':  switchView('savings'); break;
    case 'set_limit':
      showToast('fa-solid fa-circle-info', 'Δυνατότητα σύντομα διαθέσιμη');
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
  const recentExpenses = (userData.transactions || []).filter(t => t.type === 'expense').slice(0, 14);
  const dailySpend = recentExpenses.length
    ? Math.round((recentExpenses.reduce((s, t) => s + t.amount, 0) / Math.max(recentExpenses.length, 1)) * 10) / 10
    : 3;

  const now = new Date();
  const balances = [];
  let bal = balance;

  for (let i = 0; i < 7; i++) {
    // Apply incoming payments due on this offset day
    (userData.payments || [])
      .filter(p => p.type === 'incoming' && p.status === 'pending' && p.dueDate)
      .forEach(p => {
        const offset = Math.round((new Date(p.dueDate) - now) / 86400000);
        if (offset === i) bal += p.amount;
      });
    // Apply outgoing payments due on this offset day
    (userData.payments || [])
      .filter(p => p.type === 'outgoing' && p.status === 'pending' && p.dueDate)
      .forEach(p => {
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
    events.push({ day: 0, label: 'Χαμηλό υπόλοιπο σήμερα', type: 'warn' });
  }
  (userData.payments || [])
    .filter(p => p.type === 'incoming' && p.status === 'pending' && p.dueDate)
    .forEach(p => {
      const offset = Math.round((new Date(p.dueDate) - now) / 86400000);
      if (offset >= 0 && offset < 7) {
        events.push({ day: offset, label: `Πληρωμή +${p.amount}€ (${p.name})`, type: 'income' });
      }
    });

  // One-line insight
  const hasIncoming = events.some(e => e.type === 'income');
  let insight;
  if (balance < 10 && hasIncoming) {
    insight = 'Είσαι χαμηλά σήμερα, αλλά θα ανακάμψεις μετά την επερχόμενη πληρωμή σου.';
  } else if (balance < 10) {
    insight = 'Προσοχή — το υπόλοιπό σου είναι χαμηλό. Απόφυγε μη απαραίτητες αγορές.';
  } else {
    insight = 'Το υπόλοιπό σου φαίνεται σταθερό για τις επόμενες 7 ημέρες.';
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
  const debts = (userData.debts || []).filter(d => d.type === 'owe');
  const transactions = userData.transactions || [];
  const incoming = (userData.payments || []).filter(p => p.type === 'incoming' && p.status === 'pending');

  const tips = [];

  // Tip 1 — Low balance warning
  if (balance < 10) {
    tips.push({
      icon: '⚠️',
      accent: 'orange',
      title: 'Χαμηλό υπόλοιπο',
      body: `Έχεις μόνο ${balance.toFixed(2)}€ — απόφυγε αγορές σήμερα.`,
      action: { label: 'Ορισμός ορίου', type: 'set_limit' },
    });
  }

  // Tip 2 — Frequent small spending pattern
  const smallSpends = transactions.filter(t => t.type === 'expense' && t.amount <= 5);
  if (smallSpends.length >= 2) {
    const cats = [...new Set(smallSpends.map(t => t.category))].slice(0, 2);
    const catNames = cats.map(c => getCategoryInfo(c).name.toLowerCase()).join(' & ');
    tips.push({
      icon: '💡',
      accent: 'blue',
      title: 'Μικρές συχνές δαπάνες',
      body: `Ξοδεύεις συχνά σε μικρά ποσά (${catNames}). Πρόσεχε τις συνήθειες σου.`,
      action: { label: 'Δες συναλλαγές', type: 'view_spending' },
    });
  }

  // Tip 3 — Debt repayment opportunity
  const totalDebt = debts.reduce((s, d) => s + d.amount, 0);
  const totalIncoming = incoming.reduce((s, p) => s + p.amount, 0);
  if (totalDebt > 0 && (balance + totalIncoming) >= totalDebt) {
    const debtPerson = debts[0]?.name ?? '';
    tips.push({
      icon: '🎯',
      accent: 'green',
      title: 'Αποπλήρωσε το χρέος',
      body: `Μπορείς να αποπληρώσεις τα ${totalDebt}€ που χρωστάς${debtPerson ? ` στον ${debtPerson}` : ''} μετά την πληρωμή.`,
      action: { label: 'Δες χρέη', type: 'view_debts' },
    });
  }

  // Fallback tip
  if (tips.length === 0) {
    tips.push({
      icon: '💰',
      accent: 'green',
      title: 'Καλή πορεία!',
      body: 'Συνέχισε έτσι — το υπόλοιπό σου είναι σε καλό επίπεδο.',
      action: { label: 'Δες αποταμίευση', type: 'view_savings' },
    });
  }

  return tips;
}

// ---- RENDER FUNCTION ----

async function renderAIInsights() {
  // Build user data object from current state for the AI functions
  const userData = {
    balance:      state.balance,
    savings:      state.savings,
    transactions: state.transactions,
    goals:        state.savingsGoals,
    debts:        state.debts,
    payments:     state.payments,
  };

  // Fetch AI tips from backend
  let forecastData = null;
  let tipsData = null;
  try {
    const aiTips = await apiPost('/aiTips');
    if (Array.isArray(aiTips)) {
      const forecasts = aiTips.filter(t => t.type === 'forecast');
      const tips      = aiTips.filter(t => t.type === 'tips');
      if (forecasts.length) forecastData = forecasts[forecasts.length - 1];
      if (tips.length)      tipsData     = tips[tips.length - 1];
    }
  } catch (_) { /* fall back to mock data */ }

  // --- Forecast ---
  const { balances, events, insight } = forecastData ?? getAIForecast(userData);

  // Normalize + dedupe events so the UI does not render duplicate pills/markers.
  const uniqueEvents = (Array.isArray(events) ? events : []).reduce((acc, ev) => {
    const day = Number(ev?.day);
    const label = String(ev?.label || '').trim();
    const type = String(ev?.type || 'warn').trim();

    if (!Number.isInteger(day) || day < 0 || day >= balances.length || !label) return acc;

    const key = `${day}|${type.toLowerCase()}|${label.toLowerCase()}`;
    if (acc.seen.has(key)) return acc;

    acc.seen.add(key);
    acc.items.push({ day, type, label });
    return acc;
  }, { seen: new Set(), items: [] }).items;

  // Pills should show unique messages only, even if repeated across multiple days.
  const uniquePillEvents = uniqueEvents.reduce((acc, ev) => {
    const key = `${String(ev.type || '').toLowerCase()}|${String(ev.label || '').toLowerCase()}`;
    if (acc.seen.has(key)) return acc;
    acc.seen.add(key);
    acc.items.push(ev);
    return acc;
  }, { seen: new Set(), items: [] }).items;

  // Render SVG chart
  const chartEl = document.getElementById('ai-forecast-chart');
  if (chartEl) {
    const W = 300, H = 72, pX = 6, pY = 8;
    const min = Math.min(...balances);
    const max = Math.max(...balances);
    const range = max - min || 1;
    const n = balances.length;

    const pts = balances.map((v, i) => [
      pX + (i / (n - 1)) * (W - pX * 2),
      pY + (1 - (v - min) / range) * (H - pY * 2),
    ]);

    const polyLine = pts.map(p => p.join(',')).join(' ');
    const areaPath  = `${pts[0][0]},${H} ${polyLine} ${pts[n - 1][0]},${H}`;

    const today = new Date();
    const dayLabels = balances.map((_, i) => {
      if (i === 0) return 'Σήμερα';
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      return d.toLocaleDateString('el-GR', { weekday: 'narrow' });
    });

    const dots = pts.map(([x, y], i) => {
      const ev = uniqueEvents.find(e => e.day === i);
      if (!ev) return '';
      const fill = ev.type === 'income' ? '#30D158' : '#FF9500';
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5" fill="${fill}" stroke="#1B1B1D" stroke-width="2"/>`;
    }).join('');

    const labels = pts.map(([x], i) =>
      `<text x="${x.toFixed(1)}" y="${H + 14}" font-size="8.5" fill="#7B7B85" text-anchor="middle" font-family="Inter,sans-serif">${dayLabels[i]}</text>`
    ).join('');

    const valueTips = pts.map(([x, y], i) => {
      const ev = uniqueEvents.find(e => e.day === i);
      if (!ev) return '';
      const col = ev.type === 'income' ? '#30D158' : '#FF9500';
      return `<text x="${x.toFixed(1)}" y="${(y - 8).toFixed(1)}" font-size="8" fill="${col}" text-anchor="middle" font-weight="600" font-family="Inter,sans-serif">${balances[i]}€</text>`;
    }).join('');

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
  const eventsEl = document.getElementById('ai-forecast-events');
  if (eventsEl) {
    eventsEl.innerHTML = uniquePillEvents.map(ev => `
      <div class="ai-event-pill ${ev.type}">
        <span class="ai-event-dot"></span>
        <span>${ev.label}</span>
      </div>`).join('');
  }

  // Render footer (final balance + insight)
  const footerEl = document.getElementById('ai-forecast-footer');
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
  const tipsEl = document.getElementById('ai-tips-list');
  if (!tipsEl) return;

  const tips = tipsData?.tips ?? getAITips(userData);

  const tipHTML = tips.map((t, i) => `
    <div class="ai-tip-card ai-tip-${t.accent}${i > 0 ? ' ai-tip-hidden' : ''}">
      <div class="ai-tip-top">
        <span class="ai-tip-icon">${t.icon}</span>
        <span class="ai-tip-title">${t.title}</span>
      </div>
      <p class="ai-tip-body">${t.body}</p>
      <button class="ai-tip-action" onclick="handleTipAction('${t.action.type}')">${t.action.label}</button>
    </div>`).join('');

  const moreBtnHTML = tips.length > 1
    ? `<button class="ai-tips-more-btn" id="ai-tips-more-btn" onclick="showMoreTips()">
        Δείτε περισσότερα
        <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M6 9l6 6 6-6"/></svg>
       </button>`
    : '';

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
  renderRecentTransactions();
}

function renderGreeting() {
  const el = document.getElementById('greeting-text');
  if (el) el.textContent = `Γεια σου, ${state.user.name}!`;

  const dateEl = document.getElementById('date-label');
  if (dateEl) {
    const selected = new Date(state.selectedDate);
    dateEl.innerHTML = selected.toLocaleDateString('el-GR', { month: 'short', day: 'numeric', weekday: 'short' }) + ` ${icons.chevDown}`;
  }
}

function renderWeekCalendar() {
  const container = document.getElementById('week-days');
  if (!container) return;

  const today = startOfDay(new Date());
  const selected = startOfDay(new Date(state.selectedDate));
  const dayRangeBefore = 90;
  const dayRangeAfter = 90;
  const start = addDaysToDate(today, -dayRangeBefore);
  let html = '';

  for (let i = 0; i <= dayRangeBefore + dayRangeAfter; i++) {
    const d = addDaysToDate(start, i);
    const isToday = sameDay(d, today);
    const isSelected = sameDay(d, selected);
    const dayName = d.toLocaleDateString('el-GR', { weekday: 'narrow' });

    html += `
      <div class="week-day ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}" data-date-key="${toDayKey(d)}">
        <span class="day-name">${dayName}</span>
        <span class="day-num">${d.getDate()}</span>
      </div>`;
  }

  container.innerHTML = html;

  const centerSelected = (behavior = 'auto') => {
    const active = container.querySelector('.week-day.selected') || container.querySelector('.week-day.today');
    if (!active) return;

    const left = active.offsetLeft - ((container.clientWidth - active.offsetWidth) / 2);
    container.scrollTo({ left: Math.max(0, left), behavior });
  };

  container.querySelectorAll('.week-day').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.dateKey;
      if (!key) return;
      state.selectedDate = fromDayKey(key);
      renderWeekCalendar();
      renderGreeting();
      renderRecentTransactions();
      centerSelected('smooth');
    });
  });

  requestAnimationFrame(() => centerSelected('auto'));
}

function renderPeopleRow() {
  const container = document.getElementById('people-scroll');
  if (!container) return;

  const people = state.debts.slice(0, 3);
  let html = '';

  people.forEach(p => {
    html += `
      <div class="person-chip" data-id="${p.id}">
        <div class="avatar" style="background: ${p.color}">${p.initial}</div>
        <span>${p.name.split(' ')[0]}</span>
      </div>`;
  });

  if (state.debts.length > 3) {
    html += `
      <div class="people-more" onclick="switchView('debts')">
        <span>+${state.debts.length - 3}</span>
        <div class="avatar-stack">
          ${state.debts.slice(3, 6).map(p => `<div class="avatar" style="background:${p.color}">${p.initial}</div>`).join('')}
        </div>
      </div>`;
  }

  container.innerHTML = html;
}

let _prevBalance = null;

function renderBalanceCard() {
  const amountEl = document.getElementById('balance-amount');
  if (amountEl) {
    // Animate on change
    if (_prevBalance !== null && _prevBalance !== state.balance) {
      amountEl.classList.remove('balance-animating');
      void amountEl.offsetWidth; // force reflow
      amountEl.classList.add('balance-animating');
      amountEl.addEventListener('animationend', () => amountEl.classList.remove('balance-animating'), { once: true });
    }
    amountEl.textContent = formatCurrency(state.balance);
    _prevBalance = state.balance;
  }

  // Mini income / expense stats
  const { income, expenses } = getMonthTotals();
  const incomeEl = document.getElementById('balance-income');
  const expenseEl = document.getElementById('balance-expense');
  if (incomeEl) incomeEl.textContent = `+${formatCurrency(income)}€`;
  if (expenseEl) expenseEl.textContent = `-${formatCurrency(expenses)}€`;
}

function getMonthTotals() {
  const now = new Date();
  const monthTx = state.transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const income = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenses = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  return { income, expenses };
}

function renderFlowCard() {
  const { income, expenses } = getMonthTotals();
  const net = income - expenses;
  const total = income + expenses;
  const incomePct = total > 0 ? (income / total) * 100 : 0;
  const expensePct = total > 0 ? (expenses / total) * 100 : 0;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('flow-income-amount', `+${formatCurrency(income)}€`);
  set('flow-expense-amount', `-${formatCurrency(expenses)}€`);
  set('flow-period', new Date().toLocaleDateString('el-GR', { month: 'long' }));

  const netEl = document.getElementById('flow-net-value');
  if (netEl) {
    netEl.textContent = `${net >= 0 ? '+' : '-'}${formatCurrency(Math.abs(net))}€`;
    netEl.className = `flow-net-value ${net >= 0 ? 'positive' : 'negative'}`;
  }

  // Bars animate in after paint
  requestAnimationFrame(() => {
    const ib = document.getElementById('flow-income-bar');
    const eb = document.getElementById('flow-expense-bar');
    if (ib) ib.style.width = `${incomePct}%`;
    if (eb) eb.style.width = `${expensePct}%`;
  });
}

function renderQuickActions() {
  // Static — already in HTML
}

function renderStats() {
  const now = new Date();
  const monthTx = state.transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const income = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenses = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const net = income - expenses;
  const savingsRate = income > 0 ? ((state.savings / income) * 100) : 0;

  const el = document.getElementById('stat-earnings');
  if (el) el.textContent = `+${((income / (income || 1)) * 23.78).toFixed(2)}%`;

  const savEl = document.getElementById('stat-savings');
  if (savEl) savEl.textContent = `+${savingsRate.toFixed(2)}%`;

  const invEl = document.getElementById('stat-investment');
  if (invEl) invEl.textContent = `+${(net > 0 ? (net / income * 100) : 0).toFixed(2)}%`;

  renderMiniChart();
}

function renderMiniChart() {
  const container = document.getElementById('mini-chart');
  if (!container) return;

  const now = new Date();
  let html = '';
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayTx = state.transactions.filter(t => new Date(t.date).toDateString() === d.toDateString());
    const total = dayTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const h = Math.max(8, Math.min(100, (total / 80) * 100));
    html += `<div class="bar ${i === 0 ? 'accent' : ''}" style="height:${h}%;animation-delay:${(6 - i) * 50}ms"></div>`;
  }
  container.innerHTML = html;
}

function renderRecentTransactions() {
  const container = document.getElementById('recent-transactions');
  const titleEl = document.getElementById('recent-title');
  if (!container) return;

  const selectedDate = startOfDay(new Date(state.selectedDate));
  const today = startOfDay(new Date());
  const isTodaySelected = sameDay(selectedDate, today);
  const selectedLabel = selectedDate.toLocaleDateString('el-GR', { day: 'numeric', month: 'long' });

  if (titleEl) {
    titleEl.textContent = isTodaySelected ? 'Πρόσφατα' : `Συναλλαγές ${selectedLabel}`;
  }

  const sourceTx = isTodaySelected
    ? state.transactions
    : state.transactions.filter(t => sameDay(new Date(t.date), selectedDate));

  // Pending payments: on "today" view show all pending; on a specific date show payments due that day
  const sourcePay = isTodaySelected
    ? state.payments.filter(p => p.status === 'pending')
    : state.payments.filter(p => p.status === 'pending' && p.dueDate && sameDay(new Date(p.dueDate), selectedDate));

  // Tag items so we know which renderer to use, then sort together
  const tagged = [
    ...sourceTx.map(t => ({ _item: t, _kind: 'tx', _date: new Date(t.date) })),
    ...sourcePay.map(p => ({ _item: p, _kind: 'pay', _date: p.dueDate ? new Date(p.dueDate) : new Date() })),
  ];

  // Overdue payments first, then sort everything by effective date descending
  const now = new Date();
  tagged.sort((a, b) => {
    const aOverdue = a._kind === 'pay' && a._date < now;
    const bOverdue = b._kind === 'pay' && b._date < now;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    return b._date - a._date;
  });

  if (tagged.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${renderFaIcon('fa-solid fa-receipt', 'fa-solid fa-receipt')}</div>
        <p>${isTodaySelected ? 'Δεν υπάρχουν συναλλαγές' : 'Δεν υπάρχουν συναλλαγές για αυτή την ημέρα'}</p>
      </div>`;
    return;
  }

  const slice = tagged.slice(0, 5);
  container.innerHTML = slice.map(({ _item, _kind }) =>
    _kind === 'pay' ? futurePaymentItemHTML(_item) : transactionItemHTML(_item)
  ).join('');
}

function transactionItemHTML(t) {
  const cat = getCategoryInfo(t.category);
  const isExpense = t.type === 'expense';
  const sign = isExpense ? '-' : '+';
  const cls = isExpense ? 'expense' : 'income';

  const iconHTML = t.peerPfp
    ? `<div class="transaction-icon tx-peer-icon"><img src="${escapeHtml(t.peerPfp)}" alt="" onerror="this.parentElement.innerHTML='<i class=\\'fa-solid fa-user\\'></i>'"></div>`
    : `<div class="transaction-icon" style="background:${cat.bg}">${renderFaIcon(cat.icon, 'fa-solid fa-tag')}</div>`;

  return `
    <div class="transaction-item" data-id="${t.id}" onclick="toggleTransactionDetail(${t.id})">

      <!-- ── Main row ── -->
      <div class="transaction-main">
        ${iconHTML}
        <div class="transaction-info">
          <div class="name">${t.name}</div>
          <div class="category">${t.peerPfp ? (isExpense ? 'Αποστολή' : 'Εισαγωγή') : cat.name} · ${formatDate(t.date)}</div>
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
              <span class="detail-val">${renderFaIcon(cat.icon, 'fa-solid fa-tag', 'category-inline-icon')} ${cat.name}</span>
            </div>
            <div class="detail-field">
              <span class="detail-key">Τύπος</span>
              <span class="detail-val">${isExpense ? 'Έξοδο' : 'Εισόδημα'}</span>
            </div>
            ${t.note ? `<div class="detail-field">
              <span class="detail-key">Σημείωση</span>
              <span class="detail-val">${t.note}</span>
            </div>` : ''}
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
  document.querySelectorAll('.transaction-item[data-id]').forEach(el => {
    if (parseInt(el.dataset.id) === id) {
      el.classList.toggle('expanded');
    } else {
      el.classList.remove('expanded');
    }
  });
}

// ---- FUTURE PAYMENT ITEMS ----
function futurePaymentItemHTML(p) {
  const isIncoming = p.type === 'incoming';
  const cat = getCategoryInfo(p.category);
  const sign = isIncoming ? '+' : '-';
  const cls = isIncoming ? 'income' : 'expense';
  const now = new Date();
  const overdue = p.dueDate && new Date(p.dueDate) < now;
  const dueDateLabel = p.dueDate
    ? new Date(p.dueDate).toLocaleDateString('el-GR', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Χωρίς λήξη';

  return `
    <div class="transaction-item fp-item fp-${isIncoming ? 'incoming' : 'outgoing'}${overdue ? ' fp-overdue' : ''}"
         data-pid="${p.id}" onclick="toggleFuturePaymentDetail(${p.id})">

      <!-- ── Main row ── -->
      <div class="transaction-main">
        <div class="transaction-icon fp-icon-wrap" style="background:${cat.bg}">
          ${renderFaIcon(cat.icon, 'fa-solid fa-tag')}
          <div class="fp-clock-badge">
            <i class="fa-solid fa-clock" aria-hidden="true"></i>
          </div>
        </div>
        <div class="transaction-info">
          <div class="name">${p.name}</div>
          <div class="category fp-due ${overdue ? 'fp-overdue-label' : ''}">
            ${overdue ? '<i class="fa-solid fa-circle-exclamation fp-warn-icon"></i>' : ''}
            Λήξη: ${dueDateLabel}
          </div>
        </div>
        <div class="transaction-amount">
          <div class="amount ${cls} fp-amount-dim">${sign}${formatCurrency(p.amount)}€</div>
          <div class="fp-pending-pill ${isIncoming ? 'fp-pill-in' : 'fp-pill-out'}">
            ${isIncoming ? 'Εισερχόμενο' : 'Εξερχόμενο'}
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
              <span class="detail-val ${overdue ? 'fp-overdue-label' : ''}">${dueDateLabel}${overdue ? ' · Εκπρόθεσμο' : ''}</span>
            </div>
            <div class="detail-field">
              <span class="detail-key">Κατηγορία</span>
              <span class="detail-val">${renderFaIcon(cat.icon, 'fa-solid fa-tag', 'category-inline-icon')} ${cat.name}</span>
            </div>
            <div class="detail-field">
              <span class="detail-key">Τύπος</span>
              <span class="detail-val">${isIncoming ? 'Εισερχόμενο' : 'Εξερχόμενο'}</span>
            </div>
            ${p.note ? `<div class="detail-field">
              <span class="detail-key">Σημείωση</span>
              <span class="detail-val">${p.note}</span>
            </div>` : ''}
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
  document.querySelectorAll('.fp-item[data-pid]').forEach(el => {
    if (parseInt(el.dataset.pid) === id) {
      el.classList.toggle('expanded');
    } else {
      el.classList.remove('expanded');
    }
  });
}

async function settlePaymentInline(id) {
  const payment = state.payments.find(p => p.id === id);
  if (!payment) return;
  const data = await apiPost(`/payments/${id}/settle`, {}).catch(() => null);
  if (!data) return;
  const idx = state.payments.findIndex(p => p.id === id);
  if (idx !== -1) state.payments[idx] = data.payment;
  state.transactions.unshift(data.transaction);
  state.balance = data.balance;
  const icon = payment.type === 'incoming' ? 'fa-solid fa-circle-arrow-down' : 'fa-solid fa-circle-arrow-up';
  showToast(icon, `Εξοφλήθηκε: ${payment.name} — ${payment.type === 'incoming' ? '+' : '-'}${formatCurrency(payment.amount)}€`);
  renderView(state.currentView);
  renderBalanceCard();
}

async function deletePaymentInline(id) {
  const payment = state.payments.find(p => p.id === id);
  if (!payment) return;
  await apiDelete(`/payments/${id}`).catch(() => null);
  state.payments = state.payments.filter(p => p.id !== id);
  showToast('fa-solid fa-trash', `Διαγράφηκε: ${payment.name}`);
  renderView(state.currentView);
}

// ---- TRANSACTIONS VIEW ----
function renderTransactions() {
  renderTransactionFilters();
  renderTransactionList();
  renderMonthlySummary();
}

function renderTransactionFilters() {
  const container = document.getElementById('filter-chips');
  if (!container) return;

  const filters = [
    { id: 'all', label: 'Όλα' },
    { id: 'income', label: 'Εισόδημα' },
    { id: 'expense', label: 'Έξοδα' },
    { id: 'food', label: `${renderFaIcon('fa-solid fa-burger', 'fa-solid fa-burger', 'chip-icon')} Φαγητό` },
    { id: 'transport', label: `${renderFaIcon('fa-solid fa-bus', 'fa-solid fa-bus', 'chip-icon')} Μεταφορά` },
    { id: 'entertainment', label: `${renderFaIcon('fa-solid fa-gamepad', 'fa-solid fa-gamepad', 'chip-icon')} Διασκέδαση` },
    { id: 'shopping', label: `${renderFaIcon('fa-solid fa-shirt', 'fa-solid fa-shirt', 'chip-icon')} Ψώνια` },
  ];

  container.innerHTML = filters.map(f =>
    `<div class="chip ${state.transactionFilter === f.id ? 'active' : ''}" data-filter="${f.id}">${f.label}</div>`
  ).join('');

  container.querySelectorAll('.chip').forEach(el => {
    el.addEventListener('click', () => {
      state.transactionFilter = el.dataset.filter;
      renderTransactions();
    });
  });
}

function renderTransactionList() {
  const container = document.getElementById('transaction-list');
  if (!container) return;

  const q = state.searchQuery ? state.searchQuery.toLowerCase() : '';
  const f = state.transactionFilter;

  // ── Filter transactions ──
  let filteredTx = state.transactions.filter(t => {
    if (q && !t.name.toLowerCase().includes(q) && !(t.note || '').toLowerCase().includes(q)) return false;
    if (f === 'income') return t.type === 'income';
    if (f === 'expense') return t.type === 'expense';
    if (f !== 'all') return t.category === f;
    return true;
  });

  // ── Filter pending payments ──
  let filteredPay = state.payments.filter(p => p.status === 'pending').filter(p => {
    if (q && !p.name.toLowerCase().includes(q) && !(p.note || '').toLowerCase().includes(q)) return false;
    if (f === 'income') return p.type === 'incoming';
    if (f === 'expense') return p.type === 'outgoing';
    if (f !== 'all') return p.category === f;
    return true;
  });

  // ── Tag & merge ──
  const now = new Date();
  const tagged = [
    ...filteredTx.map(t => ({ _item: t, _kind: 'tx', _date: new Date(t.date) })),
    ...filteredPay.map(p => ({ _item: p, _kind: 'pay', _date: p.dueDate ? new Date(p.dueDate) : now })),
  ];

  // Sort: overdue payments first, then by date descending
  tagged.sort((a, b) => {
    const aOverdue = a._kind === 'pay' && a._date < now;
    const bOverdue = b._kind === 'pay' && b._date < now;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    return b._date - a._date;
  });

  if (tagged.length === 0) {
    const isEmpty = state.transactions.length === 0 && state.payments.filter(p => p.status === 'pending').length === 0;
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${renderFaIcon(isEmpty ? 'fa-solid fa-receipt' : 'fa-solid fa-magnifying-glass', 'fa-solid fa-receipt')}</div>
        <p>${isEmpty ? 'Δεν υπάρχουν συναλλαγές' : 'Δεν βρέθηκαν αποτελέσματα'}</p>
      </div>`;
    return;
  }

  // ── Group by date label ──
  const groups = {};
  tagged.forEach(({ _item, _kind, _date }) => {
    // Pending future payments get a "Προγραμματισμένο" prefix so they group together
    let key;
    if (_kind === 'pay') {
      const overdue = _date < now;
      key = overdue ? `⚠ Εκπρόθεσμο · ${formatDate(_item.dueDate || _item.date)}` : `📅 ${formatDate(_item.dueDate || _item.date)}`;
    } else {
      key = formatDate(_item.date);
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push({ _item, _kind });
  });

  let html = '';
  Object.entries(groups).forEach(([dateLabel, items]) => {
    html += `<div class="date-group">
      <div class="date-group-header">${dateLabel}</div>
      <div class="transaction-list-inner">
        ${items.map(({ _item, _kind }) =>
      _kind === 'pay' ? futurePaymentItemHTML(_item) : transactionItemHTML(_item)
    ).join('')}
      </div>
    </div>`;
  });

  container.innerHTML = html;
}

function renderMonthlySummary() {
  const now = new Date();
  const monthTx = state.transactions.filter(t => {
    const d = new Date(t.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const income = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenses = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

  const incomeEl = document.getElementById('summary-income');
  const expenseEl = document.getElementById('summary-expense');
  const netEl = document.getElementById('summary-net');

  if (incomeEl) incomeEl.textContent = `+${formatCurrency(income)}€`;
  if (expenseEl) expenseEl.textContent = `-${formatCurrency(expenses)}€`;
  if (netEl) {
    const net = income - expenses;
    netEl.textContent = `${net >= 0 ? '+' : '-'}${formatCurrency(Math.abs(net))}€`;
    netEl.className = `summary-value ${net >= 0 ? 'income' : 'expense'}`;
  }
}

// ---- SAVINGS VIEW ----
function renderSavings() {
  renderSavingsBalances();
  renderSavingsChart();
  renderGoals();
  renderSavingsTransferUI();
  updateTransferSlider();
}

function renderSavingsBalances() {
  const mainEl = document.getElementById('savings-main-balance');
  const savingsEl = document.getElementById('savings-amount');
  const trendEl = document.getElementById('savings-trend');
  if (mainEl) mainEl.textContent = `${formatCurrency(state.balance)}€`;
  if (savingsEl) savingsEl.textContent = `${formatCurrency(state.savings)}€`;
  if (trendEl) trendEl.textContent = `Διαθέσιμο`;
  // if (trendEl) trendEl.textContent = `+${formatCurrency(0)}€ αυτόν τον μήνα`;
}

function updateTransferSlider() {
  const slider = document.getElementById('transfer-slider');
  const maxLabel = document.getElementById('slider-max');
  const sourceBalance = state.savingsTransferSource === 'savings' ? state.savings : state.balance;
  if (maxLabel) maxLabel.textContent = `${formatCurrency(sourceBalance)}€`;
  if (slider) slider.value = 0;
  const inputEl = document.getElementById('transfer-amount');
  if (inputEl) inputEl.value = '';
}

function renderSavingsTransferUI() {
  document.querySelectorAll('.savings-account-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.account === state.savingsTransferSource);
  });

  const fromSavings = state.savingsTransferSource === 'savings';
  const direction = fromSavings ? 'withdraw' : 'save';

  const hintEl = document.getElementById('transfer-panel-hint');
  if (hintEl) {
    hintEl.textContent = fromSavings ? 'από αποταμιευσεις' : 'από κύριο υπόλοιπο';
  }

  const mainEl = document.getElementById('transfer-action-main');
  if (mainEl) {
    mainEl.textContent = fromSavings ? 'Ανάληψη' : 'Αποθήκευση';
  }

  const subEl = document.getElementById('transfer-action-sub');
  if (subEl) {
    subEl.textContent = fromSavings ? 'Αποταμιεύσεις → Κύριο' : 'Κύριο → Αποταμιεύσεις';
  }

  const btnEl = document.getElementById('transfer-action-btn');
  if (btnEl) {
    btnEl.classList.toggle('save', direction === 'save');
    btnEl.classList.toggle('withdraw', direction === 'withdraw');
  }

  const iconEl = document.getElementById('transfer-action-icon');
  if (iconEl) {
    iconEl.innerHTML = direction === 'save'
      ? '<path d="M5 12h14M15 8l4 4-4 4"/>'
      : '<path d="M19 12H5M9 8l-4 4 4 4"/>';
  }
}

function animateTransfer(direction) {
  const rightArrow = document.querySelector('.xfer-arrow.xfer-right');
  const leftArrow = document.querySelector('.xfer-arrow.xfer-left');
  const mainCard = document.getElementById('main-balance-card');
  const savCard = document.getElementById('savings-balance-card');

  const arrow = direction === 'save' ? rightArrow : leftArrow;
  const targetCard = direction === 'save' ? savCard : mainCard;

  if (arrow) {
    arrow.classList.remove('animating');
    void arrow.offsetWidth;
    arrow.classList.add('animating');
    arrow.addEventListener('animationend', () => arrow.classList.remove('animating'), { once: true });
  }
  if (targetCard) {
    targetCard.classList.remove('card-received');
    void targetCard.offsetWidth;
    targetCard.classList.add('card-received');
    targetCard.addEventListener('animationend', () => targetCard.classList.remove('card-received'), { once: true });
  }
}

function renderSavingsChart() {
  const canvas = document.getElementById('savings-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dw = canvas.offsetWidth;
  const dh = canvas.offsetHeight;
  canvas.width = dw * 2;
  canvas.height = dh * 2;
  ctx.scale(2, 2);
  ctx.clearRect(0, 0, dw, dh);

  // --- Build 5 weekly data points from real snapshot history ---
  const history = getSavingsHistory(); // [{date: ISO, savings: number}, ...]
  const now = new Date();

  // For each of the 5 columns (4w ago → now), find the latest snapshot at or before that moment.
  // Column 0 = 4 weeks ago, column 4 = now.
  const values = [];
  for (let w = 4; w >= 0; w--) {
    if (w === 0) {
      values.push(state.savings);
    } else {
      const cutoff = new Date(now);
      cutoff.setDate(now.getDate() - w * 7);
      // Latest snapshot at or before the cutoff
      const snap = [...history].filter(s => new Date(s.date) <= cutoff).pop();
      // If no snapshot that far back, use the earliest one we have
      values.push(snap ? snap.savings : (history.length > 0 ? history[0].savings : state.savings));
    }
  }

  // --- Layout ---
  const PL = 10, PR = 10, PT = 26, PB = 22;
  const chartW = dw - PL - PR;
  const chartH = dh - PT - PB;
  const n = values.length; // 5
  const maxV = Math.max(...values);
  const minVal = Math.min(...values) * 0.88;
  const range = (maxV - minVal) || 1;

  const xs = values.map((_, i) => PL + (i / (n - 1)) * chartW);
  const ys = values.map(val => PT + chartH - ((val - minVal) / range) * chartH);

  const deltas = values.slice(1).map((v, i) => v - values[i]);
  const maxChange = Math.max(...deltas.map(Math.abs), 1);
  const MAX_THICK = Math.min(chartH * 0.38, 32);
  const flatThick = 6; // minimum ribbon thickness for flat / no-change weeks

  // --- Draw Sankey ribbons ---
  for (let i = 0; i < n - 1; i++) {
    const delta = deltas[i];
    const thick = Math.max(flatThick, (Math.abs(delta) / maxChange) * MAX_THICK);
    const isUp = delta >= 0;
    const [r, g, b] = isUp ? [52, 199, 89] : [255, 59, 48];

    const x0 = xs[i], y0 = ys[i];
    const x1 = xs[i + 1], y1 = ys[i + 1];
    const cpx = (x0 + x1) / 2;

    ctx.beginPath();
    ctx.moveTo(x0, y0 - thick / 2);
    ctx.bezierCurveTo(cpx, y0 - thick / 2, cpx, y1 - thick / 2, x1, y1 - thick / 2);
    ctx.lineTo(x1, y1 + thick / 2);
    ctx.bezierCurveTo(cpx, y1 + thick / 2, cpx, y0 + thick / 2, x0, y0 + thick / 2);
    ctx.closePath();

    const grad = ctx.createLinearGradient(x0, 0, x1, 0);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.30)`);
    grad.addColorStop(0.5, `rgba(${r},${g},${b},0.58)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0.30)`);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x0, y0 - thick / 2);
    ctx.bezierCurveTo(cpx, y0 - thick / 2, cpx, y1 - thick / 2, x1, y1 - thick / 2);
    ctx.strokeStyle = `rgba(${r},${g},${b},0.85)`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // --- Node dots ---
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    ctx.beginPath();
    ctx.arc(xs[i], ys[i], isLast ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = isLast ? '#1D1D1F' : 'rgba(29,29,31,0.50)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // --- Week labels ---
  const labels = ['4w', '3w', '2w', '1w', 'Now'];
  ctx.fillStyle = 'rgba(60,60,67,0.5)';
  ctx.font = '9px Inter, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i++) ctx.fillText(labels[i], xs[i], dh - 5);

  // --- Start / end amount labels ---
  ctx.fillStyle = 'rgba(60,60,67,0.55)';
  ctx.font = '9px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${formatCurrency(values[0])}€`, xs[0], PT - 8);

  ctx.fillStyle = '#1D1D1F';
  ctx.font = 'bold 11px Inter, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${formatCurrency(state.savings)}€`, xs[n - 1], PT - 8);

  // --- Monthly trend label ---
  const totalDelta = values[n - 1] - values[0];
  const sign = totalDelta >= 0 ? '+' : '';
  const pct = values[0] > 0 ? ((totalDelta / values[0]) * 100).toFixed(1) : '0.0';
  const [tr, tg, tb] = totalDelta >= 0 ? [52, 199, 89] : [255, 59, 48];
  ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
  ctx.font = 'bold 10px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${sign}${pct}% τον Μήνα`, dw / 2, PT - 8);
}

function renderGoals() {
  const container = document.getElementById('goals-list');
  if (!container) return;

  if (state.savingsGoals.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${renderFaIcon('fa-solid fa-bullseye', 'fa-solid fa-bullseye')}</div>
        <p>Δεν υπάρχουν στόχοι</p>
      </div>
      <button class="add-goal-btn" onclick="openGoalSheet()">
        ${icons.plus}
        <span>Προσθήκη Στόχου</span>
      </button>`;
    return;
  }

  let html = state.savingsGoals.map(g => {
    const pct = Math.round((g.current / g.target) * 100);
    return `
      <div class="goal-card" data-id="${g.id}">
        <div class="goal-header">
          <div class="goal-emoji">${renderFaIcon(g.icon || g.emoji, 'fa-solid fa-bullseye')}</div>
          <div class="goal-percent">${pct}%</div>
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
  }).join('');

  html += `
    <button class="add-goal-btn" onclick="openGoalSheet()">
      ${icons.plus}
      <span>Προσθήκη Στόχου</span>
    </button>`;

  container.innerHTML = html;
}

// ---- UPCOMING PAYMENTS (embedded in Transactions view) ----
function renderUpcomingPayments() {
  const section = document.getElementById('upcoming-payments-section');
  if (!section) return;

  const pending = state.payments.filter(p => p.status === 'pending');
  if (pending.length === 0) {
    section.innerHTML = '';
    return;
  }

  // Sort: overdue first, then by due date ascending
  const sorted = [...pending].sort((a, b) => {
    const da = a.dueDate ? new Date(a.dueDate) : new Date(8640000000000000);
    const db = b.dueDate ? new Date(b.dueDate) : new Date(8640000000000000);
    return da - db;
  });

  const incomingTotal = sorted.filter(p => p.type === 'incoming').reduce((s, p) => s + p.amount, 0);
  const outgoingTotal = sorted.filter(p => p.type === 'outgoing').reduce((s, p) => s + p.amount, 0);

  section.innerHTML = `
    <div class="upcoming-payments-header" onclick="toggleUpcomingSection()">
      <div class="upcoming-payments-title">
        ${renderFaIcon('fa-solid fa-calendar-days', 'fa-solid fa-calendar-days')}
        <span>Προγραμματισμένες Πληρωμές</span>
        <span class="upcoming-count">${sorted.length}</span>
      </div>
      <div class="upcoming-payments-summary">
        ${incomingTotal > 0 ? `<span class="upcoming-sum incoming">+${formatCurrency(incomingTotal)}€</span>` : ''}
        ${outgoingTotal > 0 ? `<span class="upcoming-sum outgoing">-${formatCurrency(outgoingTotal)}€</span>` : ''}
        <svg class="upcoming-chevron" id="upcoming-chevron" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><polyline points="6 9 12 15 18 9" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
    </div>
    <div class="upcoming-payments-list" id="upcoming-payments-list">
      ${sorted.map(p => paymentCardHTML(p)).join('')}
    </div>`;
}

function toggleUpcomingSection() {
  const list = document.getElementById('upcoming-payments-list');
  const chevron = document.getElementById('upcoming-chevron');
  if (!list) return;
  const isOpen = list.classList.toggle('open');
  if (chevron) chevron.style.transform = isOpen ? 'rotate(180deg)' : '';
}

function paymentCardHTML(p) {
  const isIncoming = p.type === 'incoming';
  const isSettled = p.status === 'settled';
  const dueDateLabel = p.dueDate ? new Date(p.dueDate).toLocaleDateString('el-GR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const overdue = !isSettled && p.dueDate && new Date(p.dueDate) < new Date();

  return `
    <div class="payment-card ${isSettled ? 'settled' : ''} ${overdue ? 'overdue' : ''}" data-id="${p.id}">
      <div class="payment-card-icon">
        <div class="payment-direction-badge ${isIncoming ? 'incoming' : 'outgoing'}">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
            ${isIncoming
      ? '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'
      : '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>'}
          </svg>
        </div>
      </div>
      <div class="payment-card-info">
        <div class="name">${p.name}</div>
        <div class="payment-due ${overdue ? 'overdue-label' : ''}">
          ${overdue ? '<i class="fa-solid fa-circle-exclamation" style="font-size:11px;margin-right:3px"></i>' : ''}
          Λήξη: ${dueDateLabel}
        </div>
        ${p.note ? `<div class="payment-note">${p.note}</div>` : ''}
      </div>
      <div class="debt-card-right">
        <div class="debt-card-amount">
          <div class="amount ${isIncoming ? 'lent' : 'owe'}">${isIncoming ? '+' : '-'}${formatCurrency(p.amount)}€</div>
          <div class="date">${isSettled ? 'Εξοφλήθηκε' : 'Εκκρεμεί'}</div>
        </div>
        <div class="debt-card-actions">
          ${!isSettled ? `
          <button class="debt-action settle payment-settle-btn" onclick="settlePayment(${p.id}, event)" title="Εξόφληση">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </button>` : ''}
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
  const payment = state.payments.find(p => p.id === id);
  if (!payment) return;

  // Reuse the add-sheet in future-payment edit mode
  state.editingPaymentId = id;
  state.addType = payment.type === 'incoming' ? 'income' : 'expense';
  state.amountStr = String(payment.amount);
  state.selectedCategory = payment.category || null;
  state.isFuturePayment = true;
  state.futurePaymentDueDate = payment.dueDate ? payment.dueDate.slice(0, 10) : '';

  const overlay = document.getElementById('add-sheet-overlay');
  overlay.classList.add('visible');
  state.addSheetOpen = true;

  const titleEl = document.getElementById('transaction-title');
  if (titleEl) { titleEl.value = payment.name; }
  const counter = document.getElementById('tx-title-counter');
  if (counter) counter.textContent = `${payment.name.length} / 40`;

  const dateInput = document.getElementById('future-payment-date');
  if (dateInput) dateInput.value = state.futurePaymentDueDate;

  const headerEl = document.querySelector('#add-sheet-overlay .sheet-header h2');
  if (headerEl) headerEl.textContent = 'Επεξεργασία Πληρωμής';

  renderAddSheet();
  updateSaveButton();
}

async function deletePayment(id, event) {
  event.stopPropagation();
  const payment = state.payments.find(p => p.id === id);
  if (!payment) return;
  await apiDelete(`/payments/${id}`).catch(() => null);
  state.payments = state.payments.filter(p => p.id !== id);
  showToast('fa-solid fa-trash', `Διαγράφηκε: ${payment.name}`);
  renderUpcomingPayments();
}

async function settlePayment(id, event) {
  event.stopPropagation();
  const payment = state.payments.find(p => p.id === id);
  if (!payment) return;

  const data = await apiPost(`/payments/${id}/settle`, {}).catch(() => null);
  if (!data) return;

  const idx = state.payments.findIndex(p => p.id === id);
  if (idx !== -1) state.payments[idx] = data.payment;
  state.transactions.unshift(data.transaction);
  state.balance = data.balance;

  const icon = payment.type === 'incoming' ? 'fa-solid fa-circle-arrow-down' : 'fa-solid fa-circle-arrow-up';
  showToast(icon, `Εξοφλήθηκε: ${payment.name} — ${payment.type === 'incoming' ? '+' : '-'}${formatCurrency(payment.amount)}€`);
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
  const owed = state.debts.filter(d => d.type === 'owe').reduce((s, d) => s + d.amount, 0);
  const lent = state.debts.filter(d => d.type === 'lent').reduce((s, d) => s + d.amount, 0);

  const oweEl = document.getElementById('total-owed');
  const lentEl = document.getElementById('total-lent');
  if (oweEl) oweEl.textContent = `${formatCurrency(owed)}€`;
  if (lentEl) lentEl.textContent = `${formatCurrency(lent)}€`;
}

function renderDebtTabs() {
  document.querySelectorAll('.debt-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === state.debtViewTab);
  });
}

function renderDebtList() {
  const container = document.getElementById('debt-list');
  if (!container) return;

  const filtered = state.debts.filter(d => d.type === state.debtViewTab);

  if (filtered.length === 0) {
    const isOwe = state.debtViewTab === 'owe';
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${renderFaIcon(isOwe ? 'fa-solid fa-face-smile-beam' : 'fa-solid fa-money-bill-wave', 'fa-solid fa-circle-check')}</div>
        <p>${isOwe ? 'Δεν χρωστάς σε κανέναν' : 'Κανείς δεν σου χρωστάει'}</p>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(d => `
    <div class="debt-card" data-id="${d.id}">
      <div class="debt-avatar-wrap">
        <div class="avatar" style="background:${d.color}">${d.initial}</div>
        <div class="debt-type-badge ${d.type}">${d.type === 'owe' ? 'Χρωστάω' : 'Δάνεισα'}</div>
      </div>
      <div class="debt-card-info">
        <div class="name">${d.name}</div>
        <div class="reason">${d.reason}</div>
      </div>
      <div class="debt-card-right">
        <div class="debt-card-amount">
          <div class="amount ${d.type}">${d.type === 'owe' ? '-' : '+'}${formatCurrency(d.amount)}€</div>
          <div class="date">${formatDate(d.date)}</div>
        </div>
        <div class="debt-card-actions">
          <button class="debt-action edit" onclick="editDebt(${d.id}, event)" title="Edit">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="debt-action delete" onclick="deleteDebt(${d.id}, event)" title="Delete">
            <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

// ---- ADD TRANSACTION SHEET ----
function openAddSheet() {
  state.addSheetOpen = true;
  state.amountStr = '';
  state.selectedCategory = null;
  state.addType = 'expense';
  state.isFuturePayment = false;
  state.futurePaymentDueDate = '';

  const overlay = document.getElementById('add-sheet-overlay');
  overlay.classList.add('visible');

  // Reset title field
  const titleEl = document.getElementById('transaction-title');
  if (titleEl) { titleEl.value = ''; titleEl.blur(); }
  const counter = document.getElementById('tx-title-counter');
  if (counter) counter.textContent = '0 / 40';

  // Reset future-payment UI
  const dateInput = document.getElementById('future-payment-date');
  if (dateInput) dateInput.value = '';
  renderFuturePaymentToggle();

  renderAddSheet();
}

function closeAddSheet() {
  state.addSheetOpen = false;
  state.editingPaymentId = null;
  const overlay = document.getElementById('add-sheet-overlay');
  overlay.classList.remove('visible');
  // Restore sheet title in case it was changed for editing
  const headerEl = overlay.querySelector('.sheet-header h2');
  if (headerEl) headerEl.textContent = 'Νέα Συναλλαγή';
}

function renderAddSheet() {
  renderTypeToggle();
  renderAmountDisplay();
  renderCategoryPicker();
  renderFuturePaymentToggle();
  updateSaveButton();
}

function toggleFuturePayment() {
  state.isFuturePayment = !state.isFuturePayment;
  renderFuturePaymentToggle();
}

function renderFuturePaymentToggle() {
  const toggle = document.getElementById('future-payment-toggle');
  const sw = document.getElementById('future-payment-switch');
  const dateWrap = document.getElementById('future-payment-date-wrap');
  const saveBtn = document.getElementById('save-transaction-btn');

  if (toggle) toggle.classList.toggle('active', state.isFuturePayment);
  if (sw) sw.classList.toggle('on', state.isFuturePayment);
  if (dateWrap) dateWrap.classList.toggle('visible', state.isFuturePayment);

  // Update save button label
  if (saveBtn) {
    saveBtn.textContent = state.isFuturePayment ? 'Προγραμματισμός Πληρωμής' : 'Προσθήκη Συναλλαγής';
  }
}

function renderTypeToggle() {
  document.querySelectorAll('.type-toggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === state.addType);
  });
  // Stamp data attribute so CSS can color-code the active pill
  const toggle = document.querySelector('.type-toggle');
  if (toggle) toggle.dataset.activeType = state.addType;

  renderCategoryPicker();
  renderAmountDisplay(); // keep amount color in sync
}

function renderAmountDisplay() {
  const el = document.getElementById('amount-value');
  if (el) el.textContent = state.amountStr || '0';
  // Color-code the entire amount display by transaction type
  const display = document.querySelector('.amount-display');
  if (display) display.dataset.txType = state.addType;
}

function renderCategoryPicker() {
  const container = document.getElementById('category-grid');
  if (!container) return;

  const cats = categories[state.addType];
  container.innerHTML = cats.map(c => `
    <div class="category-item ${state.selectedCategory === c.id ? 'selected' : ''}" data-cat="${c.id}">
      <div class="cat-icon" style="background:${c.bg}">${renderFaIcon(c.icon, 'fa-solid fa-tag')}</div>
      <div class="cat-name">${c.name}</div>
    </div>
  `).join('');

  container.querySelectorAll('.category-item').forEach(el => {
    el.addEventListener('click', () => {
      state.selectedCategory = el.dataset.cat;
      document.getElementById("transaction-title").value = getCategoryInfo(state.selectedCategory).name; // Auto-fill title with category name
      document.getElementById("transaction-title").setAttribute("data-auto-filled", "true");
      renderCategoryPicker();
      updateSaveButton();
    });
  });
}

function handleNumpad(key) {
  if (key === 'delete') {
    state.amountStr = state.amountStr.slice(0, -1);
  } else if (key === '.') {
    if (!state.amountStr.includes('.')) {
      state.amountStr += state.amountStr ? '.' : '0.';
    }
  } else {
    // Limit decimal places to 2
    const parts = state.amountStr.split('.');
    if (parts[1] && parts[1].length >= 2) return;
    // Limit total length
    if (state.amountStr.replace('.', '').length >= 7) return;
    state.amountStr += key;
  }

  renderAmountDisplay();
  updateSaveButton();
}

function updateSaveButton() {
  const btn = document.getElementById('save-transaction-btn');
  if (!btn) return;
  const amount = parseFloat(state.amountStr);
  const title = (document.getElementById('transaction-title')?.value ?? '').trim();
  const ready = !!(amount > 0 && state.selectedCategory && title);
  const wasReady = !btn.disabled;

  btn.disabled = !ready;

  // Pulse the button the moment all three conditions are first satisfied
  if (ready && !wasReady) {
    btn.classList.remove('just-enabled');
    void btn.offsetWidth; // reflow
    btn.classList.add('just-enabled');
    btn.addEventListener('animationend', () => btn.classList.remove('just-enabled'), { once: true });
  }
}

async function saveTransaction() {
  const amount = parseFloat(state.amountStr);
  if (!amount || !state.selectedCategory) return;

  const cat = getCategoryInfo(state.selectedCategory);
  const title = (document.getElementById('transaction-title')?.value ?? '').trim();

  // ── Future payment path ──
  if (state.isFuturePayment) {
    const dueDateEl = document.getElementById('future-payment-date');
    const dueDate = dueDateEl ? dueDateEl.value : '';
    const paymentType = state.addType === 'income' ? 'incoming' : 'outgoing';

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
      const updated = await apiPut(`/payments/${state.editingPaymentId}`, payload).catch(() => null);
      if (!updated) return;
      const idx = state.payments.findIndex(p => p.id === state.editingPaymentId);
      if (idx !== -1) state.payments[idx] = updated;
      closeAddSheet();
      showToast('fa-solid fa-circle-check', `Ενημερώθηκε: ${updated.name}`);
    } else {
      const payment = await apiPost('/payments', payload).catch(() => null);
      if (!payment) return;
      state.payments.unshift(payment);
      closeAddSheet();
      const icon = paymentType === 'incoming' ? 'fa-solid fa-calendar-check' : 'fa-solid fa-calendar-xmark';
      showToast(icon, `Προγραμματίστηκε: ${payment.name} — ${paymentType === 'incoming' ? '+' : '-'}${formatCurrency(amount)}€`);
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

  const data = await apiPost('/transactions', payload).catch(() => null);
  if (!data) return;

  state.transactions.unshift(data.transaction);
  state.balance = data.balance;

  closeAddSheet();

  const sign = state.addType === 'expense' ? '-' : '+';
  const icon = state.addType === 'expense' ? 'fa-solid fa-money-bill-trend-up' : 'fa-solid fa-sack-dollar';
  showToast(icon, `${data.transaction.name} — ${sign}${formatCurrency(amount)}€`);

  renderView(state.currentView);
}

// ---- DEBT SHEET ----
function openDebtSheet(debt = null) {
  state.debtSheetOpen = true;
  state.editingDebtId = debt ? debt.id : null;
  state.debtType = debt ? debt.type : 'owe';

  const overlay = document.getElementById('debt-sheet-overlay');
  const header = overlay.querySelector('.sheet-header h2');
  const saveBtn = overlay.querySelector('.save-btn');
  if (header) header.textContent = debt ? 'Επεξεργασία Χρέους' : 'Προσθήκη Χρέους';
  if (saveBtn) saveBtn.textContent = debt ? 'Αποθήκευση' : 'Προσθήκη Χρέους';

  const nameEl = document.getElementById('debt-name');
  const amountEl = document.getElementById('debt-amount');
  const reasonEl = document.getElementById('debt-reason');
  if (nameEl) nameEl.value = debt ? debt.name : '';
  if (amountEl) amountEl.value = debt ? debt.amount : '';
  if (reasonEl) reasonEl.value = (debt && debt.reason !== 'Χωρίς αιτία') ? debt.reason : '';

  overlay.classList.add('visible');
  renderDebtTypeToggle();
}

function closeDebtSheet() {
  state.debtSheetOpen = false;
  state.editingDebtId = null;
  const overlay = document.getElementById('debt-sheet-overlay');
  overlay.classList.remove('visible');
}

function renderDebtTypeToggle() {
  document.querySelectorAll('.debt-type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === state.debtType);
  });
}

async function saveDebt() {
  const nameEl = document.getElementById('debt-name');
  const amountEl = document.getElementById('debt-amount');
  const reasonEl = document.getElementById('debt-reason');

  const name = nameEl ? nameEl.value.trim() : '';
  const amount = amountEl ? parseFloat(amountEl.value) : 0;
  const reason = reasonEl ? reasonEl.value.trim() : '';

  if (!name || !amount) {
    showToast('fa-solid fa-triangle-exclamation', 'Συμπλήρωσε όνομα και ποσό');
    return;
  }

  if (state.editingDebtId) {
    const updated = await apiPut(`/debts/${state.editingDebtId}`, {
      name,
      initial: name.charAt(0).toUpperCase(),
      type: state.debtType,
      amount,
      reason: reason || 'Χωρίς αιτία',
    }).catch(() => null);
    if (!updated) return;

    const idx = state.debts.findIndex(d => d.id === state.editingDebtId);
    if (idx !== -1) state.debts[idx] = updated;

    closeDebtSheet();
    showToast('fa-solid fa-circle-check', `Ενημερώθηκε ${name}`);
    renderDebts();
    renderPeopleRow();
    return;
  }

  const colors = ['#FF9500', '#AF52DE', '#5AC8FA', '#FF2D55', '#30D158', '#007AFF', '#FFCC00', '#5856D6'];

  const debt = await apiPost('/debts', {
    name,
    initial: name.charAt(0).toUpperCase(),
    type: state.debtType,
    amount,
    reason: reason || 'Χωρίς αιτία',
    date: new Date().toISOString(),
    color: colors[Math.floor(Math.random() * colors.length)],
  }).catch(() => null);
  if (!debt) return;

  state.debts.push(debt);
  closeDebtSheet();
  showToast('fa-solid fa-circle-check', `${state.debtType === 'owe' ? 'Χρέος' : 'Δάνειο'} προστέθηκε για ${name}`);
  renderDebts();
  renderPeopleRow();

  if (nameEl) nameEl.value = '';
  if (amountEl) amountEl.value = '';
  if (reasonEl) reasonEl.value = '';
}

function editDebt(id, event) {
  event.stopPropagation();
  const debt = state.debts.find(d => d.id === id);
  if (!debt) return;
  openDebtSheet(debt);
}

async function deleteDebt(id, event) {
  event.stopPropagation();
  const debt = state.debts.find(d => d.id === id);
  if (!debt) return;

  await apiDelete(`/debts/${id}`).catch(() => null);

  state.debts = state.debts.filter(d => d.id !== id);
  showToast('fa-solid fa-trash', `Διαγράφηκε ${debt.name}`);
  renderDebts();
  renderPeopleRow();
}

// ---- GOAL SHEET ----
function openGoalSheet() {
  state.goalSheetOpen = true;
  const overlay = document.getElementById('goal-sheet-overlay');
  const iconInput = document.getElementById('goal-icon-input');
  if (iconInput && !iconInput.value.trim()) {
    iconInput.value = 'fa-solid fa-bullseye';
  }
  updateGoalIconPreview();
  overlay.classList.add('visible');
}

function closeGoalSheet() {
  state.goalSheetOpen = false;
  const overlay = document.getElementById('goal-sheet-overlay');
  overlay.classList.remove('visible');
  closeFaIconPicker();
}

async function saveGoal() {
  const nameEl = document.getElementById('goal-name-input');
  const targetEl = document.getElementById('goal-target-input');
  const iconEl = document.getElementById('goal-icon-input');

  const name = nameEl ? nameEl.value.trim() : '';
  const target = targetEl ? parseFloat(targetEl.value) : 0;
  const icon = sanitizeFaClass(iconEl ? iconEl.value : '', 'fa-solid fa-bullseye');

  if (!name || !target) {
    showToast('fa-solid fa-triangle-exclamation', 'Συμπλήρωσε όνομα και στόχο');
    return;
  }

  const colors = ['green', 'blue', 'orange', 'purple'];

  const goal = await apiPost('/goals', {
    name,
    icon,
    target,
    current: 0,
    color: colors[state.savingsGoals.length % colors.length],
  }).catch(() => null);
  if (!goal) return;

  state.savingsGoals.push(goal);
  closeGoalSheet();
  showToast('fa-solid fa-bullseye', `Ο στόχος "${name}" δημιουργήθηκε`);
  renderGoals();

  if (nameEl) nameEl.value = '';
  if (targetEl) targetEl.value = '';
  if (iconEl) iconEl.value = 'fa-solid fa-bullseye';
  updateGoalIconPreview();
}

// ---- SAVINGS TRANSFER ----
async function handleTransfer() {
  const direction = state.savingsTransferSource === 'savings' ? 'withdraw' : 'save';
  return processSavingsTransfer(direction);
}

async function processSavingsTransfer(direction) {
  const inputEl = document.getElementById('transfer-amount');
  const amount = inputEl ? parseFloat(inputEl.value) : 0;
  if (!amount || amount <= 0) return;

  const fromSavings = direction === 'withdraw';
  const sourceBalance = fromSavings ? state.savings : state.balance;
  if (amount > sourceBalance) {
    showToast(
      'fa-solid fa-triangle-exclamation',
      fromSavings ? 'Ανεπαρκείς αποταμιεύσεις' : 'Ανεπαρκές υπόλοιπο',
    );
    return;
  }

  const data = await apiPost('/transfer', { amount, direction }).catch(() => null);
  if (!data) return;

  state.balance = data.balance;
  state.savings = data.savings;
  state.savingsGoals = data.goals || state.savingsGoals;

  recordSavingsSnapshot();
  animateTransfer(direction);
  showToast(
    'fa-solid fa-arrow-right-arrow-left',
    direction === 'save'
      ? `${formatCurrency(amount)}€ μεταφέρθηκαν στις αποταμιεύσεις`
      : `${formatCurrency(amount)}€ επιστράφηκαν στο κύριο`,
  );

  const slider = document.getElementById('transfer-slider');
  if (slider) slider.value = 0;
  if (inputEl) inputEl.value = '';
  renderSavings();
  renderBalanceCard();
}

// ---- TRANSACTION DETAIL ----
function showTransactionDetail(id) {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;

  const cat = getCategoryInfo(tx.category);
  const modal = document.getElementById('transaction-detail-modal');
  if (!modal) return;

  const isExpense = tx.type === 'expense';

  modal.querySelector('.glass-modal-content').innerHTML = `
    <div style="text-align:center;margin-bottom:20px">
      <div style="font-size:34px;margin-bottom:12px;line-height:1">${renderFaIcon(cat.icon, 'fa-solid fa-tag')}</div>
      <div style="font-size:24px;font-weight:700;margin-bottom:4px;color:${isExpense ? 'var(--text-primary)' : 'var(--green)'}">
        ${isExpense ? '-' : '+'}${formatCurrency(tx.amount)}€
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
      ${tx.note ? `<div style="display:flex;justify-content:space-between">
        <span style="color:var(--text-tertiary);font-size:13px">Σημείωση</span>
        <span style="font-weight:500;font-size:14px">${tx.note}</span>
      </div>` : ''}
    </div>
    <button class="save-btn" style="background:var(--red);margin-bottom:8px" onclick="deleteTransaction(${tx.id})">Διαγραφή Συναλλαγής</button>
    <button class="save-btn" style="background:var(--bg);color:var(--text-primary)" onclick="closeTransactionDetail()">Τέλος</button>
  `;

  modal.classList.add('visible');
}

function closeTransactionDetail() {
  const modal = document.getElementById('transaction-detail-modal');
  if (modal) modal.classList.remove('visible');
}

function isRunningAsPWA() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

async function deleteTransaction(id) {
  const data = await apiDelete(`/transactions/${id}`).catch(() => null);
  if (!data) return;

  state.transactions = state.transactions.filter(t => t.id !== id);
  state.balance = data.balance;

  closeTransactionDetail();
  showToast('fa-solid fa-trash', 'Η συναλλαγή διαγράφηκε');
  renderView(state.currentView);
}

// ---- TOAST ----
function showToast(iconClass, message) {
  const toast = document.getElementById('toast');
  if (!toast) return;

  const iconEl = toast.querySelector('.toast-icon');
  if (iconEl) iconEl.innerHTML = renderFaIcon(iconClass, 'fa-solid fa-circle-info');
  toast.querySelector('.toast-message').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

// ---- SEARCH ----
function handleSearch(query) {
  state.searchQuery = query;
  renderTransactionList();
}

// ---- INIT ----
async function init(allowGuest = false) {
  const acc = localStorage.getItem('evx-account');
  const inPWA = isRunningAsPWA();
  const nonPwaRoot = document.getElementById('root-non-pwa');
  const mainRoot = document.getElementById('root-main');

  if (!acc) {
    if (inPWA || allowGuest) {
      window.location.href = '/login/?login=tazro';
      return;
    }

    if (nonPwaRoot) nonPwaRoot.style.display = 'block';
    if (mainRoot) mainRoot.style.display = 'none';

    const ignoreBtn = document.getElementById('non-pwa-ignore-btn');
    if (ignoreBtn) {
      ignoreBtn.addEventListener('click', () => init(true), { once: true });
    }
    return;
  }

  if (nonPwaRoot) nonPwaRoot.style.display = 'none';
  if (mainRoot) mainRoot.style.display = 'block';

  if (acc) {
    const parsedAccount = JSON.parse(acc)
    document.getElementById("evx-pfp").src = parsedAccount.pfp || 'tazro.png';
    await loadData();
    initSSE();
  }

  // Always start on today's local date to avoid timezone-shifted persisted values.
  state.selectedDate = startOfDay(new Date());

  // Navigation
  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.tab;
      if (view) {
        switchView(view);
      }
    });
  });

  const addFab = document.getElementById('fab-add-btn');
  if (addFab) {
    addFab.addEventListener('click', openAddSheet);
  }

  // Type toggle
  document.querySelectorAll('.type-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      state.addType = btn.dataset.type;
      state.selectedCategory = null;
      renderTypeToggle();
      renderAmountDisplay();
      updateSaveButton();
    });
  });

  // Numpad
  document.querySelectorAll('.numpad button').forEach(btn => {
    btn.addEventListener('click', () => {
      handleNumpad(btn.dataset.key);
    });
  });

  // Sheet overlays close
  document.getElementById('add-sheet-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeAddSheet();
  });
  document.getElementById('debt-sheet-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeDebtSheet();
  });
  document.getElementById('goal-sheet-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeGoalSheet();
  });
  document.getElementById('transaction-detail-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeTransactionDetail();
  });
  document.getElementById('fa-icon-picker-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeFaIconPicker();
  });

  const faPickerCloseBtn = document.getElementById('fa-picker-close-btn');
  if (faPickerCloseBtn) {
    faPickerCloseBtn.addEventListener('click', closeFaIconPicker);
  }

  const faPickerSearch = document.getElementById('fa-icon-search');
  if (faPickerSearch) {
    faPickerSearch.addEventListener('input', (e) => applyFaIconFilter(e.target.value));
  }

  const faPickerLoadMore = document.getElementById('fa-picker-load-more');
  if (faPickerLoadMore) {
    faPickerLoadMore.addEventListener('click', () => {
      state.faIconPage += 1;
      renderFaIconGrid();
    });
  }

  const goalIconInput = document.getElementById('goal-icon-input');
  if (goalIconInput) {
    document.getElementById("goal-icon-preview").addEventListener('click', openFaIconPicker);
    goalIconInput.addEventListener('focus', openFaIconPicker);
    goalIconInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openFaIconPicker();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.faIconPickerOpen) {
      closeFaIconPicker();
    }
  });

  // Debt tabs
  document.querySelectorAll('.debt-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      state.debtViewTab = tab.dataset.tab;
      renderDebtTabs();
      renderDebtList();
    });
  });

  // Debt type toggle
  document.querySelectorAll('.debt-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.debtType = btn.dataset.type;
      renderDebtTypeToggle();
    });
  });

  // Transaction title field — gates save button + drives character counter
  const titleInput = document.getElementById('transaction-title');
  if (titleInput) {
    titleInput.addEventListener('input', () => {
      updateSaveButton();
      const counter = document.getElementById('tx-title-counter');
      if (counter) counter.textContent = `${titleInput.value.length} / 40`;
    });
    // Prevent numpad key events from leaking into the text field
    titleInput.addEventListener('keydown', e => e.stopPropagation());
  }

  // Future payment date
  const futureDateInput = document.getElementById('future-payment-date');
  if (futureDateInput) {
    futureDateInput.addEventListener('change', (e) => {
      state.futurePaymentDueDate = e.target.value;
    });
    futureDateInput.addEventListener('keydown', e => e.stopPropagation());
  }

  // Search
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => handleSearch(e.target.value));
  }

  // Transfer slider sync (0–100% of main balance)
  const slider = document.getElementById('transfer-slider');
  const transferInput = document.getElementById('transfer-amount');
  if (slider && transferInput) {
    slider.addEventListener('input', () => {
      const pct = slider.value / 100;
      const sourceBalance = state.savingsTransferSource === 'savings' ? state.savings : state.balance;
      const amount = Math.round(sourceBalance * pct * 100) / 100;
      transferInput.value = amount > 0 ? amount.toFixed(2) : '';
    });
  }
  // Keep the slider max label in sync when input is typed manually
  if (transferInput) {
    transferInput.addEventListener('input', () => {
      const sourceBalance = state.savingsTransferSource === 'savings' ? state.savings : state.balance;
      const maxLabel = document.getElementById('slider-max');
      if (maxLabel) maxLabel.textContent = `${formatCurrency(sourceBalance)}€`;
    });
  }

  // Savings transfer source toggle
  document.querySelectorAll('.savings-account-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.savingsTransferSource = btn.dataset.account === 'savings' ? 'savings' : 'main';
      renderSavingsTransferUI();
      updateTransferSlider();
    });
  });

  // Quick actions
  document.querySelectorAll('.action-item').forEach(item => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      if (action === 'send' || action === 'pay') {
        state.addType = 'expense';
        openAddSheet();
      } else if (action === 'request') {
        state.addType = 'income';
        openAddSheet();
      } else if (action === 'more') {
        switchView('transactions');
      }
    });
  });

  // Update time every minute
  updateTime();
  setInterval(updateTime, 60000);

  // Chat sheet
  const chatSheetOverlay = document.getElementById('chat-sheet-overlay');
  if (chatSheetOverlay) {
    chatSheetOverlay.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeChatSheet();
    });
  }
  document.querySelectorAll('.chat-tab').forEach(tab => {
    tab.addEventListener('click', () => switchChatTab(tab.dataset.chatTab));
  });
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChatMessage();
      e.stopPropagation();
    });
    chatInput.addEventListener('keyup', e => e.stopPropagation());
  }
  const friendsSearchInput = document.getElementById('friends-search');
  if (friendsSearchInput) {
    friendsSearchInput.addEventListener('input', (e) => {
      clearTimeout(_friendSearchTimeout);
      _friendSearchTimeout = setTimeout(() => searchFriends(e.target.value.trim()), 420);
    });
    friendsSearchInput.addEventListener('keydown', e => e.stopPropagation());
  }
  const sendFriendModal = document.getElementById('send-friend-modal');
  if (sendFriendModal) {
    sendFriendModal.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeSendFriendModal();
    });
  }
  document.querySelectorAll('#send-numpad [data-send-key]').forEach(btn => {
    btn.addEventListener('click', () => handleSendNumpad(btn.dataset.sendKey));
  });
  const sendFriendNoteInput = document.getElementById('send-friend-note');
  if (sendFriendNoteInput) sendFriendNoteInput.addEventListener('keydown', e => e.stopPropagation());

  // Initial render
  renderHome();
  updateGoalIconPreview();

  // Animate in
  setupAnimateIn(document.getElementById('home'));
}

function setupAnimateIn(container) {
  const elements = Array.from((container || document).querySelectorAll('.animate-in'));
  elements.forEach(el => {
    el.classList.remove('visible');
    el.style.animationDelay = '';
  });

  const observer = new IntersectionObserver((entries) => {
    const entering = entries.filter(e => e.isIntersecting);
    entering.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    entering.forEach((entry, i) => {
      entry.target.style.animationDelay = `${i * 60}ms`;
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.1 });

  elements.forEach(el => observer.observe(el));
}

// ---- CHAT ----
const chatState = {
  messages: [],
  activeTab: 'ai',
  isTyping: false,
  selectedFriend: null,
  sendAmountStr: '',
};

function openChatSheet() {
  const overlay = document.getElementById('chat-sheet-overlay');
  if (!overlay) return;
  overlay.classList.add('visible');
  if (chatState.messages.length === 0) {
    const firstName = (state.user.name || 'φίλε').split(' ')[0];
    chatState.messages.push({
      role: 'ai',
      text: `Γεια σου, ${firstName}! 👋 Είμαι ο <strong>Tazro AI</strong>. Μπορώ να σε βοηθήσω με ερωτήσεις για το υπόλοιπό σου, τα χρέη σου, τους στόχους αποταμίευσης και τα μηνιαία έξοδα. Τι θέλεις να μάθεις;`,
    });
  }
  renderChatMessages();
  setTimeout(() => {
    const input = document.getElementById('chat-input');
    if (input) input.focus();
  }, 420);
}

function closeChatSheet() {
  const overlay = document.getElementById('chat-sheet-overlay');
  if (overlay) overlay.classList.remove('visible');
}

function switchChatTab(tab) {
  chatState.activeTab = tab;
  document.querySelectorAll('.chat-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.chatTab === tab);
  });
  const aiTab = document.getElementById('chat-ai-tab');
  const friendsTab = document.getElementById('chat-friends-tab');
  if (aiTab) aiTab.classList.toggle('active', tab === 'ai');
  if (friendsTab) friendsTab.classList.toggle('active', tab === 'friends');
}

function renderChatMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  container.innerHTML = chatState.messages.map(msg => {
    if (msg.role === 'ai') {
      return `
        <div class="chat-bubble-wrap ai">
          <div class="chat-ai-avatar">
            <i class="fa-solid fa-robot" style="font-size:13px"></i>
          </div>
          <div class="chat-bubble ai">${msg.text.replaceAll(/\*\*/g, '')}</div>
        </div>`;
    }
    return `
      <div class="chat-bubble-wrap user">
        <div class="chat-bubble user">${escapeHtml(msg.text)}</div>
      </div>`;
  }).join('');

  if (chatState.isTyping) {
    container.innerHTML += `
      <div class="chat-bubble-wrap ai">
        <div class="chat-ai-avatar">
          <i class="fa-solid fa-robot" style="font-size:13px"></i>
        </div>
        <div class="chat-bubble ai typing">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>`;
  }

  container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text || chatState.isTyping) return;

  input.value = '';
  chatState.messages.push({ role: 'user', text });
  chatState.isTyping = true;
  renderChatMessages();

  await streamChatResponse(text);
}

async function streamChatResponse(userMessage) {
  let msgIndex = -1;

  try {
    const response = await fetch(API + '/chat', {
      method: 'POST',
      headers: withAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message: userMessage }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // hold incomplete line for next chunk

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break;

        const parsed = JSON.parse(payload);
        if (parsed.error) throw new Error(parsed.error);

        if (parsed.delta) {
          if (msgIndex === -1) {
            // First token — swap typing indicator for a real bubble
            chatState.isTyping = false;
            chatState.messages.push({ role: 'ai', text: '' });
            msgIndex = chatState.messages.length - 1;
          }
          chatState.messages[msgIndex].text += parsed.delta;
          renderChatMessages();
        }
      }
    }

    // Stream ended with no tokens (e.g. empty response)
    if (msgIndex === -1) throw new Error('empty');

  } catch (_) {
    chatState.isTyping = false;
    if (msgIndex === -1) {
      // Server unreachable — fall back to local AI
      const { income, expenses } = getMonthTotals();
      const ctx = {
        balance: state.balance, savings: state.savings,
        debts: state.debts.map(d => ({ name: d.name, amount: d.amount, type: d.type })),
        goals: state.savingsGoals.map(g => ({ name: g.name, target: g.target, current: g.current || 0 })),
        monthIncome: income, monthExpenses: expenses,
      };
      chatState.messages.push({ role: 'ai', text: generateLocalAIResponse(userMessage, ctx) });
    }
    renderChatMessages();
  }
}

function generateLocalAIResponse(message, ctx) {
  const msg = message.toLowerCase();

  if (msg.includes('υπόλοιπο') || msg.includes('balance') || msg.includes('πόσα λεφτ') || msg.includes('πόσα χρήματ') || msg.includes('έχω;')) {
    return `Το τρέχον υπόλοιπό σου είναι <strong>${formatCurrency(ctx.balance)}€</strong> και η αποταμίευσή σου <strong>${formatCurrency(ctx.savings)}€</strong>. Σύνολο: <strong>${formatCurrency(ctx.balance + ctx.savings)}€</strong>.`;
  }

  if (msg.includes('χρωστ') || msg.includes('χρέ') || msg.includes('debt')) {
    const owe = ctx.debts.filter(d => d.type === 'owe');
    const lent = ctx.debts.filter(d => d.type === 'lent');
    if (ctx.debts.length === 0) return 'Δεν έχεις καταγεγραμμένα χρέη αυτή τη στιγμή. 🎉';
    const totalOwe = owe.reduce((s, d) => s + d.amount, 0);
    const totalLent = lent.reduce((s, d) => s + d.amount, 0);
    let r = `Χρωστάς συνολικά <strong>${formatCurrency(totalOwe)}€</strong> και σου χρωστούν <strong>${formatCurrency(totalLent)}€</strong>.`;
    if (owe.length) r += `<br><br>Χρωστάς σε: ${owe.map(d => `${escapeHtml(d.name)} (${formatCurrency(d.amount)}€)`).join(', ')}.`;
    if (lent.length) r += `<br>Σου χρωστούν: ${lent.map(d => `${escapeHtml(d.name)} (${formatCurrency(d.amount)}€)`).join(', ')}.`;
    return r;
  }

  if (msg.includes('στόχ') || msg.includes('goal') || msg.includes('αποταμ')) {
    if (ctx.goals.length === 0) return 'Δεν έχεις ορίσει στόχους αποταμίευσης ακόμα. Μπορείς να προσθέσεις από την καρτέλα <strong>Αποταμίευση</strong>!';
    const lines = ctx.goals.map(g => {
      const pct = g.target > 0 ? Math.round((g.current / g.target) * 100) : 0;
      return `<strong>${escapeHtml(g.name)}</strong>: ${formatCurrency(g.current)}€ / ${formatCurrency(g.target)}€ (${pct}%)`;
    }).join('<br>');
    return `Οι στόχοι σου:<br>${lines}`;
  }

  if (msg.includes('έξοδ') || msg.includes('δαπάν') || msg.includes('ξόδεψ') || msg.includes('expense') || msg.includes('spending')) {
    const net = ctx.monthIncome - ctx.monthExpenses;
    const sign = net >= 0 ? '+' : '';
    return `Αυτόν τον μήνα έχεις ξοδέψει <strong>${formatCurrency(ctx.monthExpenses)}€</strong> και έχεις λάβει <strong>${formatCurrency(ctx.monthIncome)}€</strong> εισοδήματος. Καθαρό αποτέλεσμα: <strong>${sign}${formatCurrency(net)}€</strong>.`;
  }

  if (msg.includes('εισόδ') || msg.includes('income') || msg.includes('μισθ') || msg.includes('βγάζ')) {
    return `Αυτόν τον μήνα το συνολικό σου εισόδημα είναι <strong>${formatCurrency(ctx.monthIncome)}€</strong>.`;
  }

  if (msg.includes('αποταμίευ') || msg.includes('saving')) {
    return `Η αποταμίευσή σου βρίσκεται στα <strong>${formatCurrency(ctx.savings)}€</strong>. ${ctx.monthIncome > 0 ? `Αποταμιεύεις περίπου ${Math.max(0, Math.round(((ctx.monthIncome - ctx.monthExpenses) / ctx.monthIncome) * 100))}% του εισοδήματός σου αυτόν τον μήνα.` : ''}`;
  }

  if (msg.includes('συμβουλ') || msg.includes('tip') || msg.includes('πώς') || msg.includes('βοήθ')) {
    const rate = ctx.monthIncome > 0 ? ((ctx.monthIncome - ctx.monthExpenses) / ctx.monthIncome) * 100 : 0;
    if (rate < 10) return `💡 Αποταμιεύεις μόνο ${Math.max(0, rate.toFixed(0))}% του εισοδήματός σου αυτόν τον μήνα. Ο συνιστώμενος στόχος είναι <strong>20%</strong>. Δες πού μπορείς να μειώσεις τα έξοδα!`;
    if (ctx.debts.filter(d => d.type === 'owe').length > 0) return `💡 Έχεις ενεργά χρέη. Σκέψου να εξοφλήσεις πρώτα αυτά με το υψηλότερο ποσό για να ελαφρύνεις τον προϋπολογισμό σου.`;
    return `💡 Αποταμιεύεις ${rate.toFixed(0)}% του εισοδήματός σου — καλή δουλειά! Σκέψου να θέσεις έναν στόχο για να αξιοποιήσεις καλύτερα την αποταμίευσή σου.`;
  }

  if (msg.includes('γεια') || msg === 'hello' || msg === 'hi' || msg.startsWith('hi ')) {
    return `Γεια σου! 😊 Πώς μπορώ να σε βοηθήσω; Μπορώ να σου πω για το <strong>υπόλοιπό</strong> σου, τα <strong>χρέη</strong> σου, τους <strong>στόχους</strong> ή τα έξοδα του μήνα.`;
  }

  const fallbacks = [
    `Μπορώ να σε βοηθήσω με ερωτήσεις για το <strong>υπόλοιπό</strong> σου, τα <strong>χρέη</strong>, τους <strong>στόχους</strong> αποταμίευσης ή τα <strong>μηνιαία έξοδα</strong>. Τι θέλεις να μάθεις;`,
    `Δεν κατάλαβα την ερώτηση. Δοκίμασε να ρωτήσεις για το <em>υπόλοιπό</em> σου, τα <em>χρέη</em> ή τις <em>αποταμιεύσεις</em> σου.`,
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

// ---- FRIENDS / SEND MONEY ----
let _friendSearchTimeout = null;

function getRecentPeers() {
  const seen = new Set();
  const peers = [];
  for (const tx of state.transactions) {
    if (!tx.peerPfp) continue;
    const key = tx.peerPfp;
    if (seen.has(key)) continue;
    seen.add(key);
    // Name may include ': note' suffix — strip it to get the display name
    const rawName = tx.name || '';
    const name = rawName.includes(': ') ? rawName.split(': ')[0] : rawName;
    peers.push({
      id: tx.peerId || null,
      username: tx.peerUsername || name,
      name,
      pfp: tx.peerPfp,
    });
    if (peers.length >= 8) break;
  }
  return peers;
}

async function searchFriends(query) {
  const list = document.getElementById('friends-list');
  if (!list) return;
  if (!query || query.length < 2) {
    const recent = getRecentPeers();
    if (recent.length > 0) {
      const header = `<div class="friends-section-label">Πρόσφατοι</div>`;
      renderFriendResults(recent, header);
    } else {
      list.innerHTML = `
        <div class="friends-empty">
          <i class="fa-solid fa-user-plus" style="font-size:28px;color:var(--text-tertiary)"></i>
          <p>Αναζήτησε χρήστες από το Evox Ecosystem για να στείλεις χρήματα.</p>
        </div>`;
    }
    return;
  }

  list.innerHTML = `<div class="friends-empty"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px;color:var(--text-tertiary)"></i></div>`;

  try {
    const results = await apiGet(`/users/search?q=${encodeURIComponent(query)}`);
    renderFriendResults(Array.isArray(results) ? results : (results.users || []));
  } catch (_) {
    list.innerHTML = `<div class="friends-empty"><i class="fa-solid fa-triangle-exclamation" style="color:var(--text-tertiary)"></i><p>Σφάλμα αναζήτησης. Δοκίμασε ξανά.</p></div>`;
  }
}

function renderFriendResults(users, headerHTML = '') {
  const list = document.getElementById('friends-list');
  if (!list) return;
  if (!users || users.length === 0) {
    list.innerHTML = `<div class="friends-empty"><i class="fa-solid fa-user-slash" style="font-size:28px;color:var(--text-tertiary)"></i><p>Δεν βρέθηκαν χρήστες.</p></div>`;
    return;
  }

  list.innerHTML = headerHTML + users.map(u => {
    const safeData = encodeURIComponent(JSON.stringify(u));
    return `
      <div class="friend-item">
        <div class="friend-avatar">
          ${u.pfp ? `<img src="${escapeHtml(u.pfp)}" alt="" onerror="this.remove()">` : escapeHtml((u.name || u.username || '?')[0].toUpperCase())}
        </div>
        <div class="friend-info">
          <div class="friend-name">${escapeHtml(u.name || u.username || 'Χρήστης')}</div>
          <div class="friend-username">@${escapeHtml(u.username || '')}</div>
        </div>
        <button class="friend-send-btn" data-user="${safeData}">Αποστολή</button>
      </div>`;
  }).join('');

  list.querySelectorAll('.friend-send-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const user = JSON.parse(decodeURIComponent(btn.dataset.user));
      openSendFriendModal(user);
    });
  });
}

function handleSendNumpad(key) {
  if (key === 'delete') {
    chatState.sendAmountStr = chatState.sendAmountStr.slice(0, -1);
  } else if (key === '.') {
    if (!chatState.sendAmountStr.includes('.')) {
      chatState.sendAmountStr += chatState.sendAmountStr ? '.' : '0.';
    }
  } else {
    const parts = chatState.sendAmountStr.split('.');
    if (parts[1] && parts[1].length >= 2) return;
    if (chatState.sendAmountStr.replace('.', '').length >= 7) return;
    chatState.sendAmountStr += key;
  }
  const el = document.getElementById('send-amount-value');
  if (el) el.textContent = chatState.sendAmountStr || '0';
  const btn = document.getElementById('send-friend-btn');
  if (btn) btn.disabled = !(parseFloat(chatState.sendAmountStr) > 0);
}

function openSendFriendModal(user) {
  chatState.selectedFriend = user;
  chatState.sendAmountStr = '';

  const avatarEl = document.getElementById('send-friend-avatar');
  if (avatarEl) {
    avatarEl.innerHTML = user.pfp
      ? `<img src="${escapeHtml(user.pfp)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : escapeHtml((user.name || user.username || '?')[0].toUpperCase());
  }
  const nameEl = document.getElementById('send-friend-name');
  if (nameEl) nameEl.textContent = user.name || user.username || 'Χρήστης';

  const amountEl = document.getElementById('send-amount-value');
  if (amountEl) amountEl.textContent = '0';
  const noteEl = document.getElementById('send-friend-note');
  if (noteEl) noteEl.value = '';
  const btn = document.getElementById('send-friend-btn');
  if (btn) btn.disabled = true;

  document.getElementById('send-friend-modal').classList.add('visible');
}

function closeSendFriendModal() {
  document.getElementById('send-friend-modal').classList.remove('visible');
  chatState.selectedFriend = null;
  chatState.sendAmountStr = '';
}

async function confirmSendToFriend() {
  const friend = chatState.selectedFriend;
  if (!friend) return;

  const amount = parseFloat(chatState.sendAmountStr);
  const note = (document.getElementById('send-friend-note').value || '').trim();

  if (!amount || amount <= 0) {
    showToast('fa-solid fa-triangle-exclamation', 'Συμπλήρωσε έγκυρο ποσό');
    return;
  }
  if (amount > state.balance) {
    showToast('fa-solid fa-triangle-exclamation', 'Ανεπαρκές υπόλοιπο');
    return;
  }

  try {
    const data = await apiPost('/send', {
      recipientId: friend.id,
      amount,
      note: note,
    });
    if (data && data.balance !== undefined) state.balance = data.balance;
    else state.balance -= amount;
    renderBalanceCard();
    closeSendFriendModal();
    showToast('fa-solid fa-circle-check', `Εστάλησαν ${formatCurrency(amount)}€ στον/ην ${escapeHtml(friend.name || friend.username || '')}`);
  } catch (_) { /* apiFetch already shows toast */ }
}

// Start
document.addEventListener('DOMContentLoaded', () => init());


document.getElementById("transaction-title").addEventListener("focus", function () {
  if (this.getAttribute("data-auto-filled") === "true") {
    this.value = "";
    this.setAttribute("data-auto-filled", "false");
  }
})