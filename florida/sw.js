const CACHE = 'florida-v1';
const ASSETS = ['./', './index.html', './css/styles.css', './app.js', './manifest.json'];
const ICON = '../uno-transparent-square-white.png';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Network first for the app shell, cache as offline fallback
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const cached = (await caches.match(req, { ignoreSearch: true })) ||
        (req.mode === 'navigate' ? await caches.match('./index.html') : null);
      if (cached) return cached;
      throw err;
    }
  })());
});

// ---- Push: payload { title, body, url, tag, app, icon } ----
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; }
  catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  const opts = {
    body: d.body || '',
    icon: d.icon || ICON,
    badge: ICON,
    data: { url: d.url || './', app: d.app || '' },
  };
  if (d.tag) opts.tag = d.tag;
  e.waitUntil(
    self.registration.showNotification(d.title || 'Florida', opts).then(async () => {
      const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      wins.forEach(w => w.postMessage({ type: 'florida-push' }));
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {};
  const target = new URL(data.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Open the target app's URL; reuse a Florida window only when the target is Florida itself
    if (target.startsWith(self.registration.scope)) {
      const win = wins.find(c => c.url.startsWith(self.registration.scope));
      if (win) { try { await win.focus(); } catch (_) {} return; }
    }
    await clients.openWindow(target);
  })());
});