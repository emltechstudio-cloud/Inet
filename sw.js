'use strict';

const CACHE = 'inet-v3-v1';
const ASSETS = ['/index.html', '/js/app.js', '/js/core/state.js', '/js/core/storage.js', '/js/core/crypto.js', '/js/core/api.js', '/js/core/ws.js', '/js/ui/components.js', '/js/ui/render.js', '/js/features/auth.js', '/js/features/chat.js', '/js/features/calls.js', '/js/features/media.js', '/manifest.json', '/icon.svg', '/apple-touch-icon.png'];

self.addEventListener('install', ev => {
  ev.waitUntil(
    caches.open(CACHE).then(c => Promise.allSettled(ASSETS.map(a => c.add(a).catch(() => {}))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ev => {
  const url = new URL(ev.request.url);
  if (url.hostname.includes('hf.space')) return;
  if (ev.request.method !== 'GET') return;
  ev.respondWith(
    caches.match(ev.request).then(cached => {
      if (cached) return cached;
      return fetch(ev.request).then(res => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(ev.request, clone));
        }
        return res;
      }).catch(() => caches.match('/index.html'));
    })
  );
});

self.addEventListener('push', ev => {
  if (!ev.data) return;
  let data = {};
  try { data = ev.data.json(); } catch { data = { body: ev.data.text() }; }

  const { type, title, body, from, pin, room } = data;
  let notifTitle = title || 'iNet';
  let notifBody = body || 'New notification';
  let actions = [];
  let tag = 'inet-general';
  let vibrate = [150, 80, 150];

  if (type === 'incoming_call') {
    notifTitle = `${from || 'Someone'} is calling`;
    notifBody = data.call_type === 'video' ? 'Incoming video call' : 'Incoming audio call';
    tag = 'inet-call'; vibrate = [300, 100, 300, 100, 300];
    actions = [{ action: 'accept', title: 'Accept' }, { action: 'decline', title: 'Decline' }];
  } else if (type === 'incoming_group_call') {
    notifTitle = `Group call — ${room || ''}`;
    notifBody = `${from || 'Someone'} invited you`;
    tag = 'inet-group-call'; vibrate = [200, 100, 200];
    actions = [{ action: 'join', title: 'Join' }];
  } else if (type === 'new_message') {
    notifTitle = from || 'iNet';
    notifBody = body || 'New message';
    tag = `inet-msg-${pin || 'unknown'}`; vibrate = [100, 50, 100];
    actions = [{ action: 'reply', title: 'Reply' }];
  } else if (type === 'otp') {
    notifTitle = 'iNet — OTP Code';
    notifBody = `Your code: ${data.code}`;
    tag = 'inet-otp'; vibrate = [200];
  }

  ev.waitUntil(
    self.registration.showNotification(notifTitle, {
      body: notifBody, icon: '/icon.svg', badge: '/icon.svg', tag, data, vibrate, actions,
      requireInteraction: type === 'incoming_call', silent: false,
    })
  );
});

self.addEventListener('notificationclick', ev => {
  ev.notification.close();
  const data = ev.notification.data || {};
  const action = ev.action;
  ev.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const msg = { type: 'push_action', action, data };
      if (clientList.length > 0) {
        const client = clientList[0];
        client.focus();
        client.postMessage(msg);
        return;
      }
      const url = data.type === 'incoming_group_call' && data.room ? `/index.html?gc=${data.room}` : '/index.html';
      return clients.openWindow(url).then(win => { if (win) win.postMessage(msg); });
    })
  );
});

self.addEventListener('notificationclose', ev => {
  const data = ev.notification.data || {};
  if (data.type === 'incoming_call') {
    clients.matchAll({ type: 'window' }).then(list => {
      list.forEach(c => c.postMessage({ type: 'push_action', action: 'decline', data }));
    });
  }
});
