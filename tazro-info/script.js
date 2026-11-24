/* ─────────── Config ───────────
   Change this one line to point every "Open Tazro" button at the real app. */
const TAZRO_APP_URL = '../tazro/';

document.querySelectorAll('#installBtn, [data-app-link]').forEach((el) => {
    el.setAttribute('href', TAZRO_APP_URL);
});

/* ─────────── Live app demo (iframe) ───────────
   The phone shows the real Tazro app in demo mode (?demo=1 → fake data, nothing is saved).
   Demo data can be changed here, or passed as ?data=<JSON> / sessionStorage "tazroDemo"
   (see tazro/js/demo.js for every supported key). */
const DEMO_SETTINGS = {
    name: 'Νίκο',
    username: 'nikos',
    balance: 2480.5,
    savings: 930,
};

// The app is laid out as if the screen were this many CSS px wide, then scaled down to fit the
// phone. Bigger number = smaller app inside the phone (390 ≈ a real iPhone, 430 ≈ slightly smaller, 520 ≈ much smaller).
const DEMO_VIRTUAL_WIDTH = 350;
const DEMO_INSET_TOP = 35;    // real px kept free at the top (status bar + island)
const DEMO_INSET_BOTTOM = 6;  // real px at the bottom

// Landing tab → screen inside the app
const DEMO_VIEWS = { overview: 'home', spending: 'transactions', debts: 'debts', savings: 'savings' };

const demoTabs = Array.from(document.querySelectorAll('.demo-tabs [role="tab"]'));
const appFrame = document.getElementById('appFrame');
let currentScreen = 'overview';

const demoPhone = appFrame ? appFrame.closest('.phone') : null;
let demoScale = 1;

// Lay the iframe out at DEMO_VIRTUAL_WIDTH and scale it down to exactly fill the phone
function layoutDemoFrame() {
    if (!appFrame || !demoPhone) {
        return;
    }
    const w = demoPhone.clientWidth;
    const h = demoPhone.clientHeight;
    if (!w || !h) {
        return;
    }
    demoScale = w / DEMO_VIRTUAL_WIDTH;
    Object.assign(appFrame.style, {
        inset: 'auto',
        top: '0',
        left: '0',
        width: DEMO_VIRTUAL_WIDTH + 'px',
        height: Math.ceil(h / demoScale) + 'px',
        transform: `scale(${demoScale})`,
        transformOrigin: 'top left',
        borderRadius: '0',
    });
}

function demoConfig(view) {
    return {
        ...DEMO_SETTINGS,
        view,
        // insets are in the app's own (unscaled) pixels
        insetTop: Math.round(DEMO_INSET_TOP / demoScale),
        insetBottom: Math.round(DEMO_INSET_BOTTOM / demoScale),
    };
}

// The demo config is handed over on three independent channels, so a redirect that drops the
// query string (or a blocked storage) can never leave the iframe showing the real account:
// the iframe name, sessionStorage (same-origin) and the URL itself.
function loadDemo(view) {
    const cfg = demoConfig(view);
    appFrame.name = 'tazroDemo:' + JSON.stringify(cfg);
    try {
        sessionStorage.setItem('tazroDemo', JSON.stringify(cfg));
    } catch (err) { /* storage blocked: the other channels still work */ }
    appFrame.src = TAZRO_APP_URL + '?' + new URLSearchParams({ demo: '1', ...cfg }).toString();
}

if (appFrame) {
    layoutDemoFrame();
    loadDemo(DEMO_VIEWS[currentScreen]);
    appFrame.addEventListener('load', () => {
        try {
            if (!appFrame.contentWindow.__TAZRO_DEMO__) {
                console.warn('[tazro] the app inside the iframe is NOT in demo mode: is tazro/js/demo.js deployed (and loaded before app.js)?');
            }
        } catch (err) { /* cross-origin: cannot check */ }
    });
    if (demoPhone && 'ResizeObserver' in window) {
        new ResizeObserver(layoutDemoFrame).observe(demoPhone);
    } else {
        window.addEventListener('resize', layoutDemoFrame);
    }
}

function showScreen(name) {
    currentScreen = name;
    const view = DEMO_VIEWS[name] || 'home';

    if (appFrame) {
        let switched = false;
        try {
            // Same origin: switch screen inside the running app, no reload
            const app = appFrame.contentWindow;
            if (app && typeof app.switchView === 'function' && app.document.getElementById(view)) {
                app.switchView(view);
                switched = true;
            }
        } catch (err) {
            // cross-origin or not loaded yet → fall back to reloading with the right screen
        }
        if (!switched) {
            loadDemo(view);
        }
    }

    demoTabs.forEach((tab) => {
        const selected = tab.dataset.go === name;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;

        // On narrow screens the tab pill scrolls sideways: keep the active tab visible
        if (selected) {
            const bar = tab.parentElement;
            const left = tab.offsetLeft - (bar.clientWidth - tab.offsetWidth) / 2;
            if (bar.scrollWidth > bar.clientWidth) {
                bar.scrollTo({ left, behavior: 'smooth' });
            }
        }
    });
}

demoTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => showScreen(tab.dataset.go));

    // Arrow-key navigation for the tablist
    tab.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
            return;
        }
        event.preventDefault();
        const step = event.key === 'ArrowRight' ? 1 : -1;
        const next = demoTabs[(index + step + demoTabs.length) % demoTabs.length];
        next.focus();
        showScreen(next.dataset.go);
    });
});

/* ─────────── Finance score ring ─────────── */
const ringFg = document.getElementById('ringFg');
const ringNum = document.getElementById('ringNum');
const scoreRing = document.getElementById('scoreRing');

function animateScore() {
    if (!ringFg || !ringNum) {
        return;
    }

    const target = Number(ringFg.dataset.score) || 0;
    const circumference = 578; // 2 * PI * r (r = 92)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    ringFg.style.strokeDashoffset = String(circumference * (1 - target / 100));

    if (reduceMotion) {
        ringNum.textContent = String(target);
        return;
    }

    const duration = 1600;
    const start = performance.now();

    function tick(now) {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        ringNum.textContent = String(Math.round(target * eased));
        if (progress < 1) {
            requestAnimationFrame(tick);
        }
    }

    requestAnimationFrame(tick);
}

if (scoreRing && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
            animateScore();
            observer.disconnect();
        }
    }, { threshold: 0.4 });

    observer.observe(scoreRing);
} else {
    animateScore();
}

/* ─────────── Highlight install steps for the visitor's device ─────────── */
(function highlightPlatform() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    const platform = isIOS ? 'ios' : isAndroid ? 'android' : null;

    if (!platform) {
        return;
    }

    const card = document.querySelector(`.install-card[data-platform="${platform}"]`);
    if (card) {
        card.classList.add('is-current');
    }
})();

/* ─────────── Evox account menu (same behaviour as Evox Uno) ─────────── */
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

try {
    const stored = localStorage.getItem('evx-account');
    if (stored) {
        const account = JSON.parse(stored);
        document.getElementById('pfp').src = account.pfp;
        document.getElementById('username').innerText = account.name !== 'Unknown' ? account.name : account.username;
        document.getElementById('login').style.display = 'none';
        document.getElementById('userMenu').style.display = 'flex';
    }
} catch (err) {
    console.error(err);
}

function logout() {
    localStorage.removeItem('evx-account');
    window.location.reload();
}