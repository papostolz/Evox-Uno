/* ─────────────────────────────────────────────────────────────
   Αποταμίευση screen — phone demo

   The functions in the "FROM THE APP" block are copied verbatim from
   Tazro-new/js/app.js (formatCurrency, computeFinanceScore, renderGoals,
   the transfer panel, …). Only the data underneath is fake:
   no API, no localStorage, and a frozen clock so the score reads the
   same on every visit.
   ───────────────────────────────────────────────────────────── */
(() => {
  'use strict';

  const screenEl = document.getElementById('screen-savings');
  if (!screenEl || !document.getElementById('score-hero')) return;
  const scrollEl = screenEl.querySelector('.sv-scroll');

  /* ═════════════ DEMO DATA ═════════════ */

  // Frozen "today": the 27th of the current month, at noon.
  const RealDate = window.Date;
  const _t = new RealDate();
  const DEMO_NOW = new RealDate(_t.getFullYear(), _t.getMonth(), 27, 12, 0, 0).getTime();
  class DemoDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(DEMO_NOW);
      else super(...args);
    }
    static now() { return DEMO_NOW; }
  }
  const Date = DemoDate; // the app code below reads "now" from this

  // [day of month, amount, category]
  const THIS_MONTH = [
    [1, 420, 'rent'], [2, 38.4, 'food'], [3, 61.2, 'groceries'], [4, 22, 'transport'], [6, 47.9, 'groceries'],
    [7, 18.5, 'food'], [8, 35, 'transport'], [9, 96, 'entertainment'], [11, 58.3, 'groceries'], [12, 27.8, 'food'],
    [15, 10.99, 'subscriptions'], [16, 32.4, 'groceries'], [18, 31, 'transport'],
    [19, 34.6, 'food'], [21, 42.3, 'groceries'], [22, 24, 'transport'], [24, 28.5, 'food'], [25, 29.6, 'shopping'],
    [26, 37.5, 'other'], [27, 32.1, 'groceries'],
  ];
  const LAST_MONTH = [
    [1, 420, 'rent'], [3, 72.4, 'groceries'], [4, 28, 'transport'], [6, 64.1, 'food'], [8, 55.9, 'groceries'],
    [10, 60, 'entertainment'], [12, 39.5, 'transport'], [13, 48.2, 'shopping'], [15, 10.99, 'subscriptions'],
    [17, 61.8, 'groceries'], [19, 47.2, 'food'], [21, 58.6, 'groceries'], [23, 36, 'transport'],
    [25, 71.3, 'food'], [27, 52.7, 'groceries'], [29, 30.9, 'other'], [30, 28.4, 'food'],
  ];

  function buildTransactions() {
    const now = new Date();
    const out = [];
    let id = 1;
    const push = (monthOffset, day, type, amount, category) => {
      const d = new Date(now.getFullYear(), now.getMonth() + monthOffset, day, 12, 0, 0);
      out.push({ id: id++, date: d.toISOString(), type, amount, category, name: category });
    };
    push(0, 1, 'income', 1450, 'salary');
    push(-1, 1, 'income', 1450, 'salary');
    THIS_MONTH.forEach(([day, amount, cat]) => push(0, day, 'expense', amount, cat));
    LAST_MONTH.forEach(([day, amount, cat]) => push(-1, day, 'expense', amount, cat));
    return out;
  }

  const state = {
    balance: 2480.5,
    savings: 3150,
    savingsTransferSource: 'main',
    savingsGoals: [
      { id: 1, name: 'Ταξίδι στη Νάξο', icon: 'fa-solid fa-plane', target: 1500, current: 930, color: 'blue' },
      { id: 2, name: 'Νέο laptop', icon: 'fa-solid fa-laptop', target: 1200, current: 420, color: 'purple' },
      { id: 3, name: 'Αποθεματικό', icon: 'fa-solid fa-shield-heart', target: 2250, current: 1800, color: 'green' },
    ],
    debts: [
      { id: 1, type: 'owe', amount: 18, name: 'Γιώργος' },
      { id: 2, type: 'lent', amount: 45, name: 'Ελένη' },
      { id: 3, type: 'lent', amount: 18, name: 'Μάρκος' },
    ],
    transactions: buildTransactions(),
  };

  // The app keeps a local snapshot of the savings balance; here: a month ago it was lower.
  function getSavingsHistory() {
    return [{ date: new Date(DEMO_NOW - 31 * 86400000).toISOString(), savings: 2960 }];
  }

  /* ═════════════ FROM THE APP (js/app.js) ═════════════ */

  const icons = {
  plus: '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  };

  const SCORE_RING_R = 34;
const SCORE_RING_C = 2 * Math.PI * SCORE_RING_R;
const SCORE_KEYS = ["spend", "goals", "debts", "save"];
  let _savingsReplay = true;
  let _scoreTimer = 0;

function formatCurrency(n) {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

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
      <button class="add-goal-btn">
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
    <button class="add-goal-btn">
      ${icons.plus}
      <span>Προσθήκη Στόχου</span>
    </button>`;

  container.innerHTML = html;
}

function renderSavings() {
  renderSavingsScore();
  renderSavingsBalances();
  renderGoals();
  renderSavingsTransferUI();
  updateTransferSlider();
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

  /* ═════════════ DEMO WIRING ═════════════ */

  // Local stand-in for processSavingsTransfer(): same checks, no API.
  function handleTransfer() {
    const direction = state.savingsTransferSource === 'savings' ? 'withdraw' : 'save';
    const inputEl = document.getElementById('transfer-amount');
    const amount = inputEl ? parseFloat(inputEl.value) : 0;
    if (!amount || amount <= 0) return;

    const fromSavings = direction === 'withdraw';
    const sourceBalance = fromSavings ? state.savings : state.balance;
    if (amount > sourceBalance) return;

    const cents = (n) => Math.round(n * 100) / 100;
    state.balance = cents(state.balance + (fromSavings ? amount : -amount));
    state.savings = cents(state.savings + (fromSavings ? -amount : amount));

    animateTransfer(direction);

    const slider = document.getElementById('transfer-slider');
    if (slider) slider.value = 0;
    if (inputEl) inputEl.value = '';
    renderSavings();
  }

  // Listeners: same behaviour as the app's setup code
  const slider = document.getElementById('transfer-slider');
  const transferInput = document.getElementById('transfer-amount');
  if (slider && transferInput) {
    slider.addEventListener('input', () => {
      const pct = slider.value / 100;
      const amount = Math.round(getTransferSourceBalance() * pct * 100) / 100;
      transferInput.value = amount > 0 ? amount.toFixed(2) : '';
      setTransferSliderFill(Number(slider.value));
    });
  }
  if (transferInput) {
    transferInput.addEventListener('input', () => {
      const sourceBalance = getTransferSourceBalance();
      const maxLabel = document.getElementById('slider-max');
      if (maxLabel) maxLabel.textContent = `${formatCurrency(sourceBalance)}€`;
      const val = parseFloat(transferInput.value) || 0;
      const pct = sourceBalance > 0 ? Math.min(100, (val / sourceBalance) * 100) : 0;
      if (slider) slider.value = pct;
      setTransferSliderFill(pct);
    });
  }
  screenEl.querySelectorAll('.transfer-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const pct = Number(chip.dataset.pct);
      const amount = Math.round(getTransferSourceBalance() * (pct / 100) * 100) / 100;
      if (transferInput) transferInput.value = amount > 0 ? amount.toFixed(2) : '';
      if (slider) slider.value = pct;
      setTransferSliderFill(pct);
    });
  });
  screenEl.querySelectorAll('.savings-account-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.savingsTransferSource = btn.dataset.account === 'savings' ? 'savings' : 'main';
      renderSavingsTransferUI();
      updateTransferSlider();
    });
  });
  const actionBtn = document.getElementById('transfer-action-btn');
  if (actionBtn) actionBtn.addEventListener('click', handleTransfer);

  // Plays the tab's intro each time the visitor opens it (app: switchView('savings'))
  function activate() {
    _savingsReplay = true;
    if (scrollEl) scrollEl.scrollTop = 0;
    setupAnimateIn(screenEl);
    renderSavings();
  }

  document.addEventListener('tazro:screenchange', (event) => {
    if (event.detail && event.detail.name === 'savings') activate();
  });

  // Initial paint while the tab is still hidden
  renderSavings();
})();
