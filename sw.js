// Service Worker — Disci Reminderbot
const CACHE_NAME = 'disci-v3';
const ASSETS = ['/', '/index.html', '/app.js', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// Push notification received
self.addEventListener('push', e => {
  if (!e.data) return;
  const data = e.data.json();
  const { title, body, priority, reminderId } = data;
  const icon = priority >= 8 ? '🔴' : priority >= 6 ? '🟠' : priority >= 4 ? '🟡' : '🟢';

  e.waitUntil(
    self.registration.showNotification(`${icon} ${title}`, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: reminderId,
      renotify: true,
      requireInteraction: priority >= 7,
      data: { reminderId, url: '/' },
      actions: [
        { action: 'done', title: '✓ Done' },
        { action: 'stop', title: '🔕 Stop reminding' }
      ]
    })
  );
});

// Notification clicked
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'done') {
    fetch('/api/mark-done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reminderId: e.notification.data.reminderId })
    });
    return;
  }
  if (e.action === 'stop') {
    fetch('/api/stop-reminder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reminderId: e.notification.data.reminderId })
    });
    return;
  }
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      if (clientList.length > 0) return clientList[0].focus();
      return clients.openWindow('/');
    })
  );
});
