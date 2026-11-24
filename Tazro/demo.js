/* ============================================
   Tazro — Demo mode (for the landing-page iframe)
   ============================================
   Loaded BEFORE app.js. When demo mode is off it does nothing at all.
   When it is on, the real app runs unchanged, but:
     - localStorage is replaced by an in-memory store (nothing leaks into the real app's data)
     - a fake account is "logged in" (no login redirect / "install the app" gate)
     - every call to the Tazro API is answered by a tiny in-memory fake backend
       (so adding transactions, goals, debts, transfers... really works, until reload)
     - live updates, push notifications, update/recap/received animations are switched off

   HOW TO TURN IT ON
     1) URL:            /app/?demo=1
     2) sessionStorage: sessionStorage.setItem("tazroDemo", JSON.stringify({...}))
                        (same-origin parent page; only honoured while the app is inside an iframe,
                         so a leftover key can never turn the real app into a demo)
     ?demo=0 forces it off.

   HOW TO PASS DUMMY DATA (everything is optional, URL wins over sessionStorage)
     URL params:   ?demo=1&name=Maria&username=maria&balance=2450.5&savings=900&view=savings
                   &data=<JSON or base64(JSON)>      (any of the keys below, as one object)
                   &transactions=<JSON>&goals=<JSON>&debts=<JSON>&payments=<JSON>
                   &recurring=<JSON>&users=<JSON>&aiTips=<JSON>      (same, one key per param)
     sessionStorage "tazroDemo": the same object, e.g.
        { "name":"Maria", "balance":2450.5, "view":"transactions",
          "transactions":[ {"name":"Freddo","category":"coffee","amount":2.8,"daysAgo":0,"time":"09:05"} ] }

   A key that is given REPLACES the built-in sample for that key ("transactions":[] = empty state).
   Keys that are not given fall back to a built-in Greek sample dataset (dates are relative to today).

   ITEM SHAPES
     transaction {name, category, amount, type?("expense"|"income", inferred from category),
                  daysAgo?|date?(ISO), time?("HH:MM"), note?, peer?("Maria" | {name,username})}
     goal        {name, icon?("fa-solid fa-plane"), target, current, color?(green|blue|orange|purple)}
     debt        {name, type("owe"|"lent"), amount, reason?, daysAgo?|date?, color?}
     payment     {name, type("incoming"|"outgoing"), amount, category?, note?, inDays?|dueDate?(ISO)}
                 (inDays < 0 = overdue)
     recurring   {name, type("expense"|"income"), amount, category?, unit("day"|"week"|"month"|"year"),
                  interval?, startDaysAgo?|startDate?("YYYY-MM-DD"), endDate?, active?}
     user        {name, username, hasTazro?}              (people shown under Δίκτυο)
     aiTips      raw response of POST /aiTips (omit to use the app's built-in local forecast/tips)
     view        "home" | "transactions" | "savings" | "debts"  (screen to open first)
     insetTop / insetBottom   px of free space at the top / bottom (for a phone mock-up's notch / home bar)
   ============================================ */
(function () {
  "use strict";

  // ------------------------------------------------------------------ activation
  var TOP_KEYS = [
    "transactions", "goals", "debts", "payments", "recurring", "users", "aiTips",
  ];
  var VIEWS = ["home", "transactions", "savings", "debts"];
  var SS_KEY = "tazroDemo";
  var API_RE = /^https?:\/\/uno\.evox\.uno\/tazro(?=[/?#]|$)/i; // keep in sync with `API` in app.js

  function b64ToText(s) {
    s = String(s).trim().replace(/-/g, "+").replace(/_/g, "/").replace(/ /g, "+");
    while (s.length % 4) s += "=";
    var bin = atob(s);
    try {
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    } catch (_) {
      return bin;
    }
  }

  // JSON text, or base64(JSON) -> value (undefined when it is neither)
  function parseLoose(raw) {
    if (raw === null || raw === undefined || raw === "") return undefined;
    try {
      return JSON.parse(raw);
    } catch (_) {}
    try {
      return JSON.parse(b64ToText(raw));
    } catch (_) {}
    return undefined;
  }

  function isObj(v) {
    return v && typeof v === "object" && !Array.isArray(v);
  }

  var params;
  try {
    params = new URLSearchParams(location.search);
  } catch (_) {
    params = new URLSearchParams("");
  }

  var demoParam = params.get("demo");
  var urlOff = demoParam !== null && /^(0|false|off|no)$/i.test(demoParam);
  var urlOn = demoParam !== null && !urlOff;

  var framed = false;
  try {
    framed = window.self !== window.top;
  } catch (_) {
    framed = true; // cross-origin parent throws -> definitely framed
  }

  var ssRaw = null;
  try {
    ssRaw = sessionStorage.getItem(SS_KEY);
  } catch (_) {}

  if (urlOff || !(urlOn || (framed && ssRaw !== null))) {
    window.__TAZRO_DEMO__ = false;
    return;
  }

  // ------------------------------------------------------------------ config
  var cfg = {};
  var fromSS = parseLoose(ssRaw);
  if (isObj(fromSS)) Object.keys(fromSS).forEach(function (k) { cfg[k] = fromSS[k]; });

  var fromUrlData = parseLoose(params.get("data"));
  if (isObj(fromUrlData)) Object.keys(fromUrlData).forEach(function (k) { cfg[k] = fromUrlData[k]; });

  ["name", "username", "balance", "savings", "view", "insetTop", "insetBottom"].forEach(function (k) {
    if (params.has(k)) cfg[k] = params.get(k);
  });
  TOP_KEYS.forEach(function (k) {
    var v = parseLoose(params.get(k));
    if (v !== undefined) cfg[k] = v;
  });

  function has(k) {
    return Object.prototype.hasOwnProperty.call(cfg, k) && cfg[k] !== null && cfg[k] !== undefined;
  }
  function num(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : fallback;
  }
  function list(k) {
    return has(k) && Array.isArray(cfg[k]) ? cfg[k] : null;
  }

  // ------------------------------------------------------------------ date helpers (local time)
  var NOW = new Date();
  function pad2(n) { return String(n).padStart(2, "0"); }
  function dayKey(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function fromKey(k) {
    var p = String(k).split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function validKey(k) {
    return typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k) && dayKey(fromKey(k)) === k;
  }
  function offsetDay(days, time, idx) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    var h, m;
    if (typeof time === "string" && /^\d{1,2}:\d{2}$/.test(time)) {
      h = +time.split(":")[0];
      m = +time.split(":")[1];
    } else {
      var i = idx || 0; // stable, "human" looking times
      h = 9 + ((i * 5) % 12);
      m = (i * 17) % 60;
    }
    d.setHours(h, m, 0, 0);
    if (d > NOW) d = new Date(NOW.getTime() - (3 + (idx || 0)) * 60000);
    return d;
  }
  // k-th occurrence of a recurring rule (month/year steps keep the original day, clamped)
  function occurrence(startKey, unit, interval, k) {
    var s = fromKey(startKey);
    if (unit === "day") return dayKey(new Date(s.getFullYear(), s.getMonth(), s.getDate() + interval * k));
    if (unit === "week") return dayKey(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7 * interval * k));
    var months = (unit === "year" ? 12 : 1) * interval * k;
    var y = s.getFullYear();
    var mo = s.getMonth() + months;
    var last = new Date(y, mo + 1, 0).getDate();
    return dayKey(new Date(y, mo, Math.min(s.getDate(), last)));
  }

  // ------------------------------------------------------------------ avatars (no network needed)
  var AV_COLORS = ["#FF9500", "#AF52DE", "#5AC8FA", "#FF2D55", "#30D158", "#007AFF", "#FFCC00", "#5856D6"];
  function hash(s) {
    var h = 0;
    s = String(s);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }
  function avatar(name) {
    var ch = (String(name || "?").trim()[0] || "?").toUpperCase();
    var col = AV_COLORS[hash(name) % AV_COLORS.length];
    var svg =
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'><rect width='80' height='80' fill='" +
      col +
      "'/><text x='40' y='54' font-family='Inter,Arial,sans-serif' font-size='38' font-weight='600' fill='#fff' text-anchor='middle'>" +
      ch.replace(/[<>&']/g, "") +
      "</text></svg>";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  function slug(name) {
    var s = String(name || "user").toLowerCase().replace(/[^a-z0-9]+/g, "");
    return s || "user" + (hash(name) % 1000);
  }

  // ------------------------------------------------------------------ built-in sample data
  var INCOME_CATS = {
    job: 1, scholarship: 1, family: 1, freelance: 1, aid: 1, gift: 1, refund: 1, other_income: 1,
  };

  var SAMPLE_TX = [
    { name: "Freddo espresso", category: "coffee", amount: 2.8, daysAgo: 0, time: "09:05" },
    { name: "Super Market", category: "food", amount: 23.45, daysAgo: 0, time: "13:20" },
    { name: "Κάρτα μετρό", category: "transport", amount: 9, daysAgo: 1 },
    { name: "Netflix", category: "subscriptions", amount: 11.99, daysAgo: 1 },
    { name: "Φαρμακείο", category: "health", amount: 14.2, daysAgo: 2 },
    { name: "Μαρία: Βραδινό", category: "other_income", type: "income", amount: 20, daysAgo: 3, peer: { name: "Μαρία", username: "maria" } },
    { name: "Σινεμά", category: "entertainment", amount: 18, daysAgo: 3 },
    { name: "Καφές", category: "coffee", amount: 3.2, daysAgo: 4 },
    { name: "Βιβλιοπωλείο", category: "books", amount: 22.9, daysAgo: 5 },
    { name: "Νίκος: Βενζίνη", category: "other_expense", type: "expense", amount: 15, daysAgo: 5, peer: { name: "Νίκος", username: "nikos" } },
    { name: "Ρούχα", category: "shopping", amount: 49.9, daysAgo: 6 },
    { name: "Δείπνο", category: "food", amount: 32, daysAgo: 7 },
    { name: "Spotify", category: "subscriptions", amount: 9.99, daysAgo: 8 },
    { name: "Μισθός", category: "job", amount: 1350, daysAgo: 9, time: "08:00" },
    { name: "Λογαριασμός ρεύματος", category: "utilities", amount: 58.3, daysAgo: 10 },
    { name: "Freelance project", category: "freelance", amount: 280, daysAgo: 11 },
    { name: "Καφές", category: "coffee", amount: 2.8, daysAgo: 12 },
    { name: "Ταξί", category: "transport", amount: 8.4, daysAgo: 13 },
    { name: "Ενοίκιο", category: "rent", amount: 420, daysAgo: 14, time: "10:00" },
    { name: "Super Market", category: "food", amount: 41.1, daysAgo: 15 },
    { name: "Γυμναστήριο", category: "health", amount: 25, daysAgo: 17 },
    { name: "Γιώργος: Επιστροφή", category: "refund", type: "income", amount: 35, daysAgo: 19, peer: { name: "Γιώργος", username: "giorgos" } },
    { name: "Delivery", category: "food", amount: 17.5, daysAgo: 21 },
    { name: "Δώρο γενεθλίων", category: "gift", amount: 50, daysAgo: 24 },
    { name: "Ψώνια", category: "shopping", amount: 64, daysAgo: 26 },
    { name: "Καφές", category: "coffee", amount: 3.5, daysAgo: 28 },
    { name: "Super Market", category: "food", amount: 52, daysAgo: 33 },
    { name: "Λογαριασμός νερού", category: "utilities", amount: 22.4, daysAgo: 35 },
    { name: "Μισθός", category: "job", amount: 1350, daysAgo: 39, time: "08:00" },
    { name: "Ενοίκιο", category: "rent", amount: 420, daysAgo: 44, time: "10:00" },
    { name: "Διασκέδαση", category: "entertainment", amount: 36, daysAgo: 47 },
    { name: "Φαγητό", category: "food", amount: 27.8, daysAgo: 52 },
  ];
  var SAMPLE_GOALS = [
    { name: "Ταξίδι στη Ρώμη", icon: "fa-solid fa-plane", target: 800, current: 520, color: "blue" },
    { name: "Νέο laptop", icon: "fa-solid fa-laptop", target: 1200, current: 430, color: "orange" },
    { name: "Αποθεματικό", icon: "fa-solid fa-shield-heart", target: 1500, current: 842.5, color: "green" },
  ];
  var SAMPLE_DEBTS = [
    { name: "Νίκος", type: "owe", amount: 25, reason: "Βραδινό", daysAgo: 4 },
    { name: "Μαρία", type: "lent", amount: 40, reason: "Εισιτήρια συναυλίας", daysAgo: 9 },
    { name: "Αλέξης", type: "lent", amount: 15, reason: "Καφέδες", daysAgo: 16 },
  ];
  var SAMPLE_PAYMENTS = [
    { name: "ΔΕΗ", category: "utilities", type: "outgoing", amount: 64.2, inDays: 5, note: "Λογαριασμός ρεύματος" },
    { name: "Επιστροφή από Γιώργο", category: "refund", type: "incoming", amount: 30, inDays: 3, note: "" },
  ];
  var SAMPLE_RECURRING = [
    { name: "Μισθός", category: "job", type: "income", amount: 1350, unit: "month", interval: 1, startDaysAgo: 9 },
    { name: "Ενοίκιο", category: "rent", type: "expense", amount: 420, unit: "month", interval: 1, startDaysAgo: 14 },
    { name: "Netflix", category: "subscriptions", type: "expense", amount: 11.99, unit: "month", interval: 1, startDaysAgo: 1 },
  ];
  var SAMPLE_USERS = [
    { name: "Μαρία", username: "maria", hasTazro: true },
    { name: "Νίκος", username: "nikos", hasTazro: true },
    { name: "Γιώργος", username: "giorgos", hasTazro: true },
    { name: "Ελένη", username: "eleni", hasTazro: true },
    { name: "Αλέξης", username: "alexis", hasTazro: true },
    { name: "Κατερίνα", username: "katerina", hasTazro: false },
    { name: "Δημήτρης", username: "dimitris", hasTazro: true },
    { name: "Σοφία", username: "sofia", hasTazro: false },
  ];

  // ------------------------------------------------------------------ build the fake database
  var idSeq = 1000;
  function nextId() { return ++idSeq; }

  function normTx(t, i) {
    t = isObj(t) ? t : {};
    var category = t.category || (t.type === "income" ? "other_income" : "other_expense");
    var type = t.type === "income" || t.type === "expense" ? t.type : INCOME_CATS[category] ? "income" : "expense";
    var date = t.date ? new Date(t.date) : offsetDay(-Math.abs(num(t.daysAgo, 0)), t.time, i);
    if (isNaN(date.getTime())) date = offsetDay(0, null, i);
    var tx = {
      id: num(t.id, null) !== null ? +t.id : nextId(),
      name: String(t.name || (type === "income" ? "Έσοδο" : "Έξοδο")),
      category: category,
      type: type,
      amount: Math.abs(num(t.amount, 0)),
      date: date.toISOString(),
      note: t.note ? String(t.note) : "",
    };
    if (t.peer) {
      var pn = isObj(t.peer) ? t.peer.name : String(t.peer);
      var pu = isObj(t.peer) && t.peer.username ? t.peer.username : slug(pn);
      tx.peerUsername = pu;
      tx.peerPfp = avatar(pn);
      if (!t.name) tx.name = pn;
    }
    return tx;
  }

  function normGoal(g, i) {
    g = isObj(g) ? g : {};
    var colors = ["green", "blue", "orange", "purple"];
    return {
      id: num(g.id, null) !== null ? +g.id : nextId(),
      name: String(g.name || "Στόχος"),
      icon: g.icon || "fa-solid fa-bullseye",
      target: Math.abs(num(g.target, 100)),
      current: Math.abs(num(g.current, 0)),
      color: colors.indexOf(g.color) >= 0 ? g.color : colors[i % colors.length],
    };
  }

  function normDebt(d, i) {
    d = isObj(d) ? d : {};
    var name = String(d.name || "Άγνωστος");
    var date = d.date ? new Date(d.date) : offsetDay(-Math.abs(num(d.daysAgo, 0)), null, i);
    if (isNaN(date.getTime())) date = new Date();
    return {
      id: num(d.id, null) !== null ? +d.id : nextId(),
      name: name,
      initial: name.charAt(0).toUpperCase(),
      type: d.type === "lent" ? "lent" : "owe",
      amount: Math.abs(num(d.amount, 0)),
      reason: d.reason ? String(d.reason) : "Χωρίς αιτία",
      date: date.toISOString(),
      color: d.color || AV_COLORS[hash(name) % AV_COLORS.length],
    };
  }

  function normPayment(p) {
    p = isObj(p) ? p : {};
    var due = null;
    if (p.dueDate) {
      var dd = new Date(p.dueDate);
      if (!isNaN(dd.getTime())) due = dd;
    } else if (p.inDays !== undefined && p.inDays !== null) {
      due = new Date();
      due.setDate(due.getDate() + Math.round(num(p.inDays, 0)));
      due.setHours(12, 0, 0, 0);
    }
    return {
      id: num(p.id, null) !== null ? +p.id : nextId(),
      name: String(p.name || "Πληρωμή"),
      category: p.category || (p.type === "incoming" ? "other_income" : "other_expense"),
      type: p.type === "incoming" ? "incoming" : "outgoing",
      amount: Math.abs(num(p.amount, 0)),
      dueDate: due ? due.toISOString() : null,
      note: p.note ? String(p.note) : "",
      status: p.status === "settled" ? "settled" : "pending",
      date: new Date().toISOString(),
    };
  }

  // first occurrence strictly after `todayKey` (what a server reports as "next")
  function computeNext(startKey, unit, interval, todayKey) {
    for (var k = 0; k < 5000; k++) {
      var key = occurrence(startKey, unit, interval, k);
      if (key > todayKey) return key;
    }
    return startKey;
  }

  function normRecurring(r) {
    r = isObj(r) ? r : {};
    var unit = ["day", "week", "month", "year"].indexOf(r.unit) >= 0 ? r.unit : "month";
    var interval = Math.max(1, Math.round(num(r.interval, 1)));
    var startDate = validKey(r.startDate)
      ? r.startDate
      : dayKey(offsetDay(-Math.abs(num(r.startDaysAgo, 0)), "12:00", 0));
    var endDate = validKey(r.endDate) ? r.endDate : null;
    var today = dayKey(NOW);
    var next = startDate > today ? startDate : computeNext(startDate, unit, interval, today);
    var finished = !!endDate && next > endDate;
    var type = r.type === "income" ? "income" : "expense";
    return {
      id: num(r.id, null) !== null ? +r.id : nextId(),
      name: String(r.name || "Επανάληψη"),
      category: r.category || (type === "income" ? "other_income" : "other_expense"),
      type: type,
      amount: Math.abs(num(r.amount, 0)),
      note: r.note ? String(r.note) : "",
      unit: unit,
      interval: interval,
      startDate: startDate,
      endDate: endDate,
      nextDate: finished ? null : next,
      active: r.active === false ? false : true,
      finished: finished,
    };
  }

  function normUser(u, i) {
    u = isObj(u) ? u : { name: String(u) };
    var name = String(u.name || u.username || "Χρήστης");
    return {
      id: num(u.id, null) !== null ? +u.id : 500 + i,
      name: name,
      username: String(u.username || slug(name)),
      pfp: u.pfp || avatar(name),
      hasTazro: u.hasTazro === false ? false : true,
    };
  }

  var db = {
    balance: num(cfg.balance, 1957.43),
    savings: num(cfg.savings, 842.5),
    transactions: (list("transactions") || SAMPLE_TX).map(normTx),
    goals: (list("goals") || SAMPLE_GOALS).map(normGoal),
    debts: (list("debts") || SAMPLE_DEBTS).map(normDebt),
    payments: (list("payments") || SAMPLE_PAYMENTS).map(normPayment),
    recurring: (list("recurring") || SAMPLE_RECURRING).map(normRecurring),
    users: (list("users") || SAMPLE_USERS).map(normUser),
    aiTips: list("aiTips") || [],
  };
  db.transactions.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });

  var userName = String(has("name") ? cfg.name : "Gladys").trim() || "Gladys";
  var userHandle = String(has("username") ? cfg.username : slug(userName)).trim() || slug(userName);
  var startView = has("view") && VIEWS.indexOf(String(cfg.view)) >= 0 ? String(cfg.view) : "";

  // ------------------------------------------------------------------ in-memory localStorage
  function makeStore(seed) {
    var m = new Map();
    Object.keys(seed).forEach(function (k) { m.set(k, String(seed[k])); });
    return {
      getItem: function (k) { k = String(k); return m.has(k) ? m.get(k) : null; },
      setItem: function (k, v) { m.set(String(k), String(v)); },
      removeItem: function (k) { m.delete(String(k)); },
      clear: function () { m.clear(); },
      key: function (i) { var a = Array.from(m.keys()); return i >= 0 && i < a.length ? a[i] : null; },
      get length() { return m.size; },
    };
  }

  // gentle savings history so the "savings change" figures on the Αποταμίευση tab have a baseline
  var history = [];
  for (var h = 0; h <= 8; h++) {
    var back = 60 - h * 7;
    var dt = new Date();
    dt.setDate(dt.getDate() - back);
    history.push({
      date: dt.toISOString(),
      savings: Math.round(db.savings * (0.55 + 0.45 * (h / 8)) * 100) / 100,
    });
  }

  var seed = {
    "evx-account": JSON.stringify({
      name: userName,
      username: userHandle,
      pfp: "",
      evxToken: "demo-token",
    }),
    tazroState: JSON.stringify({ user: { name: userName, initial: userName.charAt(0).toUpperCase() } }),
    tazroSavingsHistory: JSON.stringify(history),
    tazroNtfPromptDone: String(Date.now()),
  };

  var store = makeStore(seed);
  var shimmed = false;
  try {
    Object.defineProperty(window, "localStorage", { configurable: true, value: store });
    shimmed = window.localStorage === store;
  } catch (_) {}
  if (!shimmed) {
    // Last resort (browser refuses to replace localStorage): seed the real one and put back
    // whatever was there when the page is closed.
    try {
      var real = window.localStorage;
      var keys = Object.keys(seed);
      var backup = {};
      keys.forEach(function (k) { backup[k] = real.getItem(k); });
      keys.forEach(function (k) { real.setItem(k, seed[k]); });
      window.addEventListener("pagehide", function () {
        keys.forEach(function (k) {
          if (backup[k] === null) real.removeItem(k);
          else real.setItem(k, backup[k]);
        });
      });
    } catch (_) {}
  }

  // ------------------------------------------------------------------ fake backend
  function findById(arr, id) {
    for (var i = 0; i < arr.length; i++) if (String(arr[i].id) === String(id)) return arr[i];
    return null;
  }
  function money(n) { return Math.round(n * 100) / 100; }
  function applyBalance(type, amount) {
    db.balance = money(db.balance + (type === "income" || type === "incoming" ? amount : -amount));
  }

  function makeRecurringTx(rule, key) {
    var d = fromKey(key);
    d.setHours(9, 0, 0, 0);
    return normTx({
      name: rule.name, category: rule.category, type: rule.type, amount: rule.amount,
      note: rule.note, date: d.toISOString(),
    }, 0);
  }

  // create the rule and every occurrence that is already due (like the real server does)
  function createRecurring(payload) {
    var rule = normRecurring(payload);
    var today = dayKey(NOW);
    var created = [];
    rule.nextDate = rule.startDate;
    for (var k = 0; k < 60; k++) {
      var key = occurrence(rule.startDate, rule.unit, rule.interval, k);
      if (key > today || (rule.endDate && key > rule.endDate)) { rule.nextDate = key; break; }
      var tx = makeRecurringTx(rule, key);
      created.push(tx);
      db.transactions.unshift(tx);
      applyBalance(tx.type, tx.amount);
      rule.nextDate = occurrence(rule.startDate, rule.unit, rule.interval, k + 1);
    }
    if (rule.endDate && rule.nextDate > rule.endDate) { rule.finished = true; rule.nextDate = null; }
    db.recurring.unshift(rule);
    return { rule: rule, created: created, balance: db.balance };
  }

  function route(method, path, query, body) {
    var m;

    if (method === "GET" && path === "/data") {
      return {
        balance: db.balance, savings: db.savings, transactions: db.transactions,
        goals: db.goals, debts: db.debts, payments: db.payments, recurring: db.recurring,
      };
    }
    if (path === "/aiTips") return db.aiTips;

    // transactions
    if (method === "POST" && path === "/transactions") {
      var tx = normTx(Object.assign({}, body, { date: body.date || new Date().toISOString() }), 0);
      db.transactions.unshift(tx);
      applyBalance(tx.type, tx.amount);
      return { transaction: tx, balance: db.balance };
    }
    if ((m = path.match(/^\/transactions\/([^/]+)$/)) && method === "DELETE") {
      var t = findById(db.transactions, m[1]);
      if (t) {
        applyBalance(t.type === "income" ? "expense" : "income", t.amount); // undo it
        db.transactions = db.transactions.filter(function (x) { return x !== t; });
      }
      return { balance: db.balance };
    }

    // scheduled payments
    if (method === "POST" && path === "/payments") {
      var p = normPayment(body);
      db.payments.unshift(p);
      return p;
    }
    if ((m = path.match(/^\/payments\/([^/]+)\/settle$/)) && method === "POST") {
      var sp = findById(db.payments, m[1]);
      if (!sp) return { error: "Δεν βρέθηκε" , __status: 404 };
      sp.status = "settled";
      var stx = normTx({
        name: sp.name, category: sp.category, type: sp.type === "incoming" ? "income" : "expense",
        amount: sp.amount, note: sp.note, date: new Date().toISOString(),
      }, 0);
      db.transactions.unshift(stx);
      applyBalance(stx.type, stx.amount);
      return { payment: sp, transaction: stx, balance: db.balance };
    }
    if ((m = path.match(/^\/payments\/([^/]+)$/))) {
      var cp = findById(db.payments, m[1]);
      if (method === "PUT" && cp) {
        var np = normPayment(Object.assign({}, cp, body, { id: cp.id, status: cp.status }));
        db.payments[db.payments.indexOf(cp)] = np;
        return np;
      }
      if (method === "DELETE") {
        db.payments = db.payments.filter(function (x) { return x !== cp; });
        return {};
      }
    }

    // recurring rules
    if (method === "POST" && path === "/recurring") return createRecurring(body);
    if ((m = path.match(/^\/recurring\/([^/]+)$/))) {
      var rule = findById(db.recurring, m[1]);
      if (method === "PUT" && rule) {
        var merged = Object.assign({}, rule, body, { id: rule.id });
        var nr = normRecurring(merged);
        if (!("startDate" in body) && !("unit" in body) && !("interval" in body)) nr.nextDate = rule.nextDate;
        nr.active = "active" in body ? !!body.active : rule.active;
        db.recurring[db.recurring.indexOf(rule)] = nr;
        return { rule: nr, balance: db.balance };
      }
      if (method === "DELETE") {
        db.recurring = db.recurring.filter(function (x) { return x !== rule; });
        return { balance: db.balance };
      }
    }

    // debts
    if (method === "POST" && path === "/debts") {
      var d = normDebt(body, db.debts.length);
      db.debts.push(d);
      return d;
    }
    if ((m = path.match(/^\/debts\/([^/]+)$/))) {
      var cd = findById(db.debts, m[1]);
      if (method === "PUT" && cd) {
        var nd = normDebt(Object.assign({}, cd, body, { id: cd.id, date: cd.date }), 0);
        db.debts[db.debts.indexOf(cd)] = nd;
        return nd;
      }
      if (method === "DELETE") {
        db.debts = db.debts.filter(function (x) { return x !== cd; });
        return {};
      }
    }

    // goals + savings transfer
    if (method === "POST" && path === "/goals") {
      var g = normGoal(body, db.goals.length);
      db.goals.push(g);
      return g;
    }
    if (method === "POST" && path === "/transfer") {
      var amt = Math.abs(num(body.amount, 0));
      if (body.direction === "withdraw") {
        db.savings = money(db.savings - amt);
        db.balance = money(db.balance + amt);
      } else {
        db.balance = money(db.balance - amt);
        db.savings = money(db.savings + amt);
      }
      return { balance: db.balance, savings: db.savings, goals: db.goals };
    }

    // people
    if (method === "GET" && path === "/users/all") return db.users;
    if (method === "GET" && path === "/users/search") {
      var q = String(query.get("q") || "").toLowerCase();
      return db.users.filter(function (u) {
        return u.name.toLowerCase().indexOf(q) >= 0 || u.username.toLowerCase().indexOf(q) >= 0;
      });
    }
    if (method === "POST" && path === "/send") {
      var to = null;
      for (var i = 0; i < db.users.length; i++) {
        if (db.users[i].username === body.recipientUsername || String(db.users[i].id) === String(body.recipientId)) to = db.users[i];
      }
      var sname = to ? to.name : String(body.recipientUsername || "Χρήστης");
      var note = String(body.note || "").trim();
      var out = normTx({
        name: note ? sname + ": " + note : sname, category: "other_expense", type: "expense",
        amount: num(body.amount, 0), date: new Date().toISOString(),
        peer: { name: sname, username: to ? to.username : slug(sname) },
      }, 0);
      out.name = note ? sname + ": " + note : sname;
      db.transactions.unshift(out);
      applyBalance("expense", out.amount);
      return { balance: db.balance, transaction: out };
    }

    // push notifications: always "not available" in the demo
    if (path === "/push/prefs") return { enabled: false, publicKey: "", prefs: {}, subscribed: false };
    if (path.indexOf("/push/") === 0) return { ok: true, delivered: false };

    return { error: "Δεν είναι διαθέσιμο στη λειτουργία επίδειξης", __status: 404 };
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
    if (!API_RE.test(url)) {
      return origFetch ? origFetch(input, init) : Promise.reject(new TypeError("fetch unavailable"));
    }
    init = init || {};
    var method = String(init.method || (input && input.method) || "GET").toUpperCase();
    var body = {};
    try {
      if (typeof init.body === "string" && init.body) body = JSON.parse(init.body) || {};
    } catch (_) {}
    var u = new URL(url);
    var path = u.pathname.replace(/^\/tazro/i, "") || "/";

    return new Promise(function (resolve) {
      setTimeout(function () {
        var data, status = 200;
        try {
          data = clone(route(method, path, u.searchParams, body));
        } catch (e) {
          data = { error: "Σφάλμα επίδειξης" };
          status = 500;
        }
        if (data && data.__status) { status = data.__status; delete data.__status; }
        resolve(new Response(JSON.stringify(data), {
          status: status,
          headers: { "Content-Type": "application/json" },
        }));
      }, 60 + Math.random() * 80);
    });
  };

  // ------------------------------------------------------------------ switch off what makes no sense in a demo
  window.__TAZRO_DEMO__ = { active: true, config: cfg };
  document.documentElement.setAttribute("data-demo", "1");

  // room for a phone mock-up's island / home bar (the iframe has no real safe-area insets)
  var insetTop = num(cfg.insetTop, 0);
  var insetBottom = num(cfg.insetBottom, 0);
  if (insetTop > 0 || insetBottom > 0) {
    var st = document.createElement("style");
    st.textContent =
      (insetTop > 0 ? "html[data-demo] .view{padding-top:" + insetTop + "px !important}" : "") +
      (insetBottom > 0 ? "html[data-demo] .tab-nav-shell{padding-bottom:" + (insetBottom + 10) + "px !important}" : "");
    document.head.appendChild(st);
  }

  // app.js declares these as plain functions; it runs after this file, so we replace them
  // once the whole page is parsed — still before app.js' own DOMContentLoaded -> init().
  document.addEventListener("DOMContentLoaded", function () {
    var noop = function () {};
    window.initSSE = noop; // live updates
    window.checkReceivedPayments = noop; // "you received money" animation
    window.checkScheduledPayments = noop; // recurring / due payment animation
    window.checkWeeklyRecap = noop; // weekly recap animation
    window.ntfInitMessages = noop;
    window.ntfQuietResync = noop;
    window.ntfMaybePrompt = noop; // "turn on notifications" popup
    window.ntfHandleOpenParam = noop; // would strip ?demo=... from the URL
    window.ntfGetSub = function () { return Promise.resolve(null); }; // no service worker in demo
    window.profileLogout = function () {
      if (typeof showToast === "function") {
        showToast("fa-solid fa-circle-info", "Λειτουργία επίδειξης");
      }
    };
    // init() calls this as its very last step: perfect moment to open the requested screen
    window.updMaybeShow = function () {
      if (startView && typeof switchView === "function") {
        try { switchView(startView); } catch (_) {}
      }
      return Promise.resolve();
    };
  });
})();