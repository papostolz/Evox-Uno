const CACHE = 'tazro-v16';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // cache:'reload' bypasses the HTTP cache so the new version is really fetched
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const isUpgrade = keys.some(k => k !== CACHE && k.startsWith('tazro-'));
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    // Upgrade from an older version: reload the open Tazro windows so they switch
    // to the new files right away (no logout / app restart needed).
    if (isUpgrade) {
      const wins = await self.clients.matchAll({ type: 'window' });
      wins.forEach(c => { try { c.navigate(c.url); } catch (_) {} });
    }
  })());
});

// The page asks which version is running (drives the "app updated" screen)
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'get-version' && e.ports && e.ports[0]) {
    e.ports[0].postMessage({ version: CACHE });
  }
});

// App files (HTML/CSS/JS/manifest): network first, cache only as offline fallback,
// so a new deploy is picked up on the next load instead of one launch later.
const SHELL = new Set(
  ASSETS.filter(u => !u.startsWith('http')).map(u => new URL(u, self.registration.scope).href)
);

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return res;
  } catch (err) {
    const cached =
      (await caches.match(req, { ignoreSearch: true })) ||
      (req.mode === 'navigate' ? await caches.match('./index.html') : null);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (e.request.mode === 'navigate' || SHELL.has(url.origin + url.pathname)) {
    e.respondWith(networkFirst(e.request));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// ---- Push notifications ----
// Optional: path of your app icon (e.g. './icon-192.png') to show in notifications
const NOTIF_ICON = '';

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch (_) { d = { title: 'Tazro', body: e.data ? e.data.text() : '' }; }
  const opts = {
    body: d.body || '',
    lang: 'el',
    data: { url: d.url || './', kind: d.kind || '' },
  };
  if (d.tag) opts.tag = d.tag;
  if (NOTIF_ICON) { opts.icon = NOTIF_ICON; opts.badge = NOTIF_ICON; }
  e.waitUntil(self.registration.showNotification(d.title || 'Tazro', opts));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {};
  const target = new URL(data.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(c => c.url.startsWith(self.registration.scope)) || wins[0];
    if (win) {
      try { await win.focus(); } catch (_) {}
      win.postMessage({ type: 'ntf-open', kind: data.kind || '' });
      return;
    }
    await clients.openWindow(target);
  })());
});