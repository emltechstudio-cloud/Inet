'use strict';

const CACHE = 'inet-v2-v1';
const ASSETS = ['/app.html', '/app.js', '/manifest.json', '/icon.svg', '/apple-touch-icon.png'];

/* ── INSTALL ─────────────────────────────────────── */
self.addEventListener('install', ev => {
  ev.waitUntil(
    caches.open(CACHE).then(c => {
      return Promise.allSettled(ASSETS.map(a => c.add(a).catch(() => {})));
    })
  );
  self.skipWaiting();
});

/* ── ACTIVATE ────────────────────────────────────── */
self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH (cache-first for assets, network for API) */
self.addEventListener('fetch', ev => {
  const url = new URL(ev.request.url);

  // Always network for API and WS
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
      }).catch(() => caches.match('/app.html'));
    })
  );
});

/* ── PUSH NOTIFICATIONS ──────────────────────────── */
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
    tag = 'inet-call';
    vibrate = [300, 100, 300, 100, 300];
    actions = [
      { action: 'accept', title: 'Accept' },
      { action: 'decline', title: 'Decline' },
    ];
  } else if (type === 'incoming_group_call') {
    notifTitle = `Group call — ${room || ''}`;
    notifBody = `${from || 'Someone'} invited you to a group call`;
    tag = 'inet-group-call';
    vibrate = [200, 100, 200];
    actions = [{ action: 'join', title: 'Join' }];
  } else if (type === 'new_message') {
    notifTitle = from || 'iNet';
    notifBody = body || 'New message';
    tag = `inet-msg-${pin || 'unknown'}`;
    vibrate = [100, 50, 100];
    actions = [{ action: 'reply', title: 'Reply' }];
  } else if (type === 'otp') {
    notifTitle = 'iNet — OTP Code';
    notifBody = `Your code: ${data.code}`;
    tag = 'inet-otp';
    vibrate = [200];
  }

  ev.waitUntil(
    self.registration.showNotification(notifTitle, {
      body: notifBody,
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag,
      data,
      vibrate,
      actions,
      requireInteraction: type === 'incoming_call',
      silent: false,
    })
  );
});

/* ── NOTIFICATION CLICK ──────────────────────────── */
self.addEventListener('notificationclick', ev => {
  ev.notification.close();
  const data = ev.notification.data || {};
  const action = ev.action;

  // Relay to open clients
  ev.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const msg = { type: 'push_action', action, data };

      if (clientList.length > 0) {
        const client = clientList[0];
        client.focus();
        client.postMessage(msg);
        return;
      }

      // No open window — open app
      const url = data.type === 'incoming_group_call' && data.room
        ? `/app.html?gc=${data.room}`
        : '/app.html';
      return clients.openWindow(url).then(win => {
        if (win) win.postMessage(msg);
      });
    })
  );
});

/* ── NOTIFICATION CLOSE ──────────────────────────── */
self.addEventListener('notificationclose', ev => {
  const data = ev.notification.data || {};
  // If call notification dismissed — relay decline
  if (data.type === 'incoming_call') {
    clients.matchAll({ type: 'window' }).then(clientList => {
      clientList.forEach(c => c.postMessage({ type: 'push_action', action: 'decline', data }));
    });
  }
});
