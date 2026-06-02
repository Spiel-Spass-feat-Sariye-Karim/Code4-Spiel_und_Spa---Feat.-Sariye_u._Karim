// ArcadeBox Service Worker v2
const CACHE_NAME = 'arcadebox-v2';
// Use inline SVG data URI as icon fallback
const ICON = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect width=%22100%22 height=%22100%22 rx=%2218%22 fill=%22%23ff5733%22/%3E%3Ctext y=%22.85em%22 font-size=%2272%22 text-anchor=%22middle%22 x=%2250%22%3E%F0%9F%8E%AE%3C/text%3E%3C/svg%3E';

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
});

// Handle incoming push notifications
self.addEventListener('push', function(event) {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch(e) { data = { title: 'ArcadeBox', body: event.data.text() }; }

  const options = {
    body: data.body || '',
    icon: ICON,
    badge: ICON,
    vibrate: [120, 60, 120],
    data: { url: data.url || '/', type: data.type || '' },
    tag: data.tag || ('arcadebox-' + Date.now()),
    requireInteraction: false
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'ArcadeBox', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].url === url && 'focus' in clientList[i]) {
          return clientList[i].focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
