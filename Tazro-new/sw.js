const CACHE = 'tazro-v14';
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
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// The page asks which version is running (drives the "app updated" screen)
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'get-version' && e.ports && e.ports[0]) {
    e.ports[0].postMessage({ version: CACHE });
  }
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
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