const CACHE_NAME = 'inet-v2-cache-v1';
const urlsToCache = [
  './',
  './app.html',
  './js/utils.js',
  './js/storage.js',
  './js/api.js',
  './js/auth.js',
  './js/contacts.js',
  './js/groups.js',
  './js/chat.js',
  './js/media.js',
  './js/calls.js',
  './js/linkcalls.js',
  './js/ui.js',
  './js/app.js',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)));
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(response => response || fetch(e.request)));
});

self.addEventListener('push', e => {
  const data = e.data.json();
  e.waitUntil(self.registration.showNotification(data.title || 'iNet', {
    body: data.body || 'New notification',
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: data
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('./'));
});
