// Flink Service Worker
const CACHE_NAME = 'flink-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/app.html',
  '/manifest.json',
  '/apple-touch-icon.png',
  '/icon.svg',
  'js/app.js',
  'js/api.js',
  'js/auth.js',
  'js/calls.js',
  'js/chat.js',
  'js/contacts.js',
  'js/groups.js',
  'js/media.js',
  'js/storage.js',
  'js/ui.js',
  'js/utils.js',
  'js/linkcalls.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => response || fetch(event.request))
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Push Notification Handling
self.addEventListener('push', (event) => {
  const data = event.data?.json();
  const title = data?.title || 'Flink';
  const options = {
    body: data?.body || 'New message or call',
    icon: '/apple-touch-icon.png',
    badge: '/apple-touch-icon.png',
    data: data?.url || '/app.html',
  };
  
  if (data?.type === 'flink_request') {
    options.body = `Flink request: ${data.mode} from ${data.from}`;
    options.data = `/app.html?flink_request=${data.session_id}`;
  } else if (data?.type === 'flink_group_request') {
    options.body = `Group ${data.mode} request from ${data.from}`;
    options.data = `/app.html?group_request=${data.session_id}`;
  }
  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data || '/app.html';
  event.waitUntil(
    clients.openWindow(url)
  );
});
