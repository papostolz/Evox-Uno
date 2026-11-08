// OASA Push Notification Service Worker
self.addEventListener('push', function (event) {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { data = { title: 'OASA', body: event.data.text() }; }

  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/favicon.png',
    data: data.data || {},
    tag: data.data && data.data.stopCode ? 'oasa-stop-' + data.data.stopCode : 'oasa-notif',
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'OASA', options)
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if ('focus' in client) { client.focus(); return; }
      }
      if (clients.openWindow) clients.openWindow('/');
    })
  );
});
