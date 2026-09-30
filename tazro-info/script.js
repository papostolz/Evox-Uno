/* ─────────── Config ───────────
   Change this one line to point every "Open Tazro" button at the real app. */
const TAZRO_APP_URL = '../tazro/';

document.querySelectorAll('#installBtn, [data-app-link]').forEach((el) => {
    el.setAttribute('href', TAZRO_APP_URL);
});

/* ─────────── Phone demo tabs ─────────── */
const demoTabs = Array.from(document.querySelectorAll('.demo-tabs [role="tab"]'));
const screens = Array.from(document.querySelectorAll('.screen'));
const phoneNavButtons = Array.from(document.querySelectorAll('.phone-nav button'));

function showScreen(name) {
    screens.forEach((screen) => {
        screen.classList.toggle('active', screen.id === `screen-${name}`);
    });

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

    phoneNavButtons.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.go === name);
    });

    // Lets a screen replay its intro animation when it is opened
    document.dispatchEvent(new CustomEvent('tazro:screenchange', { detail: { name } }));
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

// The mock bottom bar inside the phone is clickable for mouse/touch users
phoneNavButtons.forEach((btn) => {
    btn.addEventListener('click', () => showScreen(btn.dataset.go));
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
