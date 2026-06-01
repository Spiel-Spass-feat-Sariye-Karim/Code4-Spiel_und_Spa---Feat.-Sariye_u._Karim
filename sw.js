// ArcadeBox Service Worker
const CACHE_NAME = 'arcadebox-v1';

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
    icon: data.icon || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ctext y=%22.9em%22 font-size=%2290%22%3E%F0%9F%8E%AE%3C/text%3E%3C/svg%3E',
    badge: data.icon || 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ctext y=%22.9em%22 font-size=%2290%22%3E%F0%9F%8E%AE%3C/text%3E%3C/svg%3E',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/', type: data.type || '' },
    tag: data.tag || 'arcadebox-notif',
    renotify: true
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
