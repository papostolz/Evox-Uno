(() => {
  const root = document.documentElement;
  const themeButton = document.querySelector('.theme-toggle');
  const menuButton = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.primary-nav');
  const year = document.querySelector('#current-year');
  const themeStorageKey = 'athena-site-theme';

  const getStoredTheme = () => {
    try {
      const saved = window.localStorage.getItem(themeStorageKey);
      return saved === 'light' || saved === 'dark' ? saved : null;
    } catch {
      return null;
    }
  };

  const getActiveTheme = () => {
    const explicit = root.dataset.theme;
    if (explicit === 'light' || explicit === 'dark') return explicit;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  const updateThemeAssets = (theme) => {
    document.querySelectorAll('[data-theme-image]').forEach((image) => {
      const nextSource = theme === 'dark' ? image.dataset.darkSrc : image.dataset.lightSrc;
      if (nextSource && image.getAttribute('src') !== nextSource) image.setAttribute('src', nextSource);
    });
  };

  const updateThemeButton = (theme) => {
    if (!themeButton) return;
    const nextAction = theme === 'dark' ? 'Ενεργοποίηση φωτεινής εμφάνισης' : 'Ενεργοποίηση σκοτεινής εμφάνισης';
    themeButton.setAttribute('aria-label', nextAction);
    themeButton.setAttribute('title', nextAction);
    themeButton.innerHTML = theme === 'dark'
      ? '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>'
      : '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.7 8.7 0 1 0 20.5 14.2Z"/></svg>';
  };

  const applyTheme = (theme, persist = false) => {
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
    else root.removeAttribute('data-theme');
    const activeTheme = theme || getActiveTheme();
    updateThemeAssets(activeTheme);
    updateThemeButton(activeTheme);

    const themeColor = activeTheme === 'dark' ? '#121212' : '#fbf7f3';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);

    if (persist) {
      try {
        window.localStorage.setItem(themeStorageKey, activeTheme);
      } catch {
        // The visual theme still works when storage is unavailable.
      }
    }
  };

  applyTheme(getStoredTheme());

  themeButton?.addEventListener('click', () => {
    applyTheme(getActiveTheme() === 'dark' ? 'light' : 'dark', true);
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (!getStoredTheme()) applyTheme(null);
  });

  const closeMenu = () => {
    if (!menuButton || !nav) return;
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Άνοιγμα μενού');
    nav.classList.remove('is-open');
  };

  menuButton?.addEventListener('click', () => {
    const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!isOpen));
    menuButton.setAttribute('aria-label', isOpen ? 'Άνοιγμα μενού' : 'Κλείσιμο μενού');
    nav?.classList.toggle('is-open', !isOpen);
  });

  nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 680) closeMenu();
  });

  if (year) year.textContent = String(new Date().getFullYear());

  const revealItems = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          currentObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -35px 0px' });

    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  }
})();
