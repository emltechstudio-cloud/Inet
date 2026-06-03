/* render.js — DOM rendering only, no logic */
import { State } from '../core/state.js';
import { Store } from '../core/storage.js';
import { avatarEl, initials, avatarColor, formatTime, formatDuration, contactName } from './components.js';

export function renderChats(filter = '') {
  const list = document.getElementById('chats-list');
  const entries = Object.entries(State.chats);
  const filtered = filter ? entries.filter(([pin]) => {
    const name = contactName(pin).toLowerCase();
    return name.includes(filter) || pin.includes(filter);
  }) : entries;
  filtered.sort((a, b) => (b[1].messages.at(-1)?.ts || 0) - (a[1].messages.at(-1)?.ts || 0));

  list.innerHTML = '';
  const empty = document.getElementById('chats-empty');
  if (!filtered.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  filtered.forEach(([pin, chat]) => {
    const last = chat.messages.at(-1);
    const name = contactName(pin);
    const online = State.onlineStatus[pin]?.online;
    const unread = chat.unread || 0;
    let preview = '';
    if (last) {
      if (last.type === 'text' || last.type === 'api') preview = last.content;
      else if (last.type === 'image') preview = '📷 Photo';
      else if (last.type === 'video') preview = '🎥 Video';
      else if (last.type === 'voice') preview = '🎤 Voice';
      else if (last.type === 'sticker') preview = 'Sticker';
    }
    const el = document.createElement('div');
    el.className = 'chat-item';
    el.innerHTML = `
      <div class="avatar" style="background:${avatarColor(pin)}">${initials(name)}${online ? '<div class="online-dot"></div>' : ''}</div>
      <div class="info">
        <div class="row"><span class="name">${name}</span><span class="time">${last ? formatTime(last.ts) : ''}</span></div>
        <div class="row"><span class="preview">${preview || 'Say hello'}</span>${unread ? `<span class="unread">${unread}</span>` : ''}</div>
      </div>
    `;
    el.addEventListener('click', () => {
      import('../app.js').then(m => m.openChat(pin));
    });
    list.appendChild(el);
  });
}

export function renderContacts(filter = '') {
  const list = document.getElementById('contacts-list');
  list.innerHTML = '';
  if (!State.sim) return;
  const contacts = filter
    ? State.sim.contacts.filter(c => c.name.toLowerCase().includes(filter.toLowerCase()) || c.pin.includes(filter))
    : State.sim.contacts;
  const empty = document.getElementById('contacts-empty');
  if (!contacts.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  contacts.forEach(c => {
    const online = State.onlineStatus[c.pin]?.online;
    const el = document.createElement('div');
    el.className = 'contact-item';
    el.innerHTML = `
      <div class="avatar" style="background:${avatarColor(c.pin)}">${initials(c.name)}</div>
      <div class="info">
        <div class="name">${c.name}</div>
        <div class="pin">${c.pin} ${online ? '● online' : ''}</div>
      </div>
      <div class="actions">
        <button class="call-btn" data-audio="${c.pin}">&#128222;</button>
        <button class="call-btn" data-video="${c.pin}">&#127909;</button>
      </div>
    `;
    el.querySelector('[data-audio]').addEventListener('click', (e) => {
      e.stopPropagation();
      import('../features/calls.js').then(m => m.startCall(c.pin, 'audio'));
    });
    el.querySelector('[data-video]').addEventListener('click', (e) => {
      e.stopPropagation();
      import('../features/calls.js').then(m => m.startCall(c.pin, 'video'));
    });
    el.addEventListener('click', () => {
      import('../app.js').then(m => m.openChat(c.pin));
    });
    list.appendChild(el);
  });
}

export function renderCalls() {
  const list = document.getElementById('calls-list');
  list.innerHTML = '';
  const logs = State.callLog;
  const empty = document.getElementById('calls-empty');
  if (!logs.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  [...logs].reverse().forEach(log => {
    const name = contactName(log.pin);
    const icon = log.missed ? '&#128683;' : log.direction === 'outgoing' ? '&#10142;' : '&#128222;';
    const color = log.missed ? 'var(--danger)' : 'var(--text-2)';
    const el = document.createElement('div');
    el.className = 'chat-item';
    el.innerHTML = `
      <div class="avatar" style="background:${avatarColor(log.pin)}">${initials(name)}</div>
      <div class="info">
        <div class="row"><span class="name">${name}</span><span class="time">${formatTime(log.ts)}</span></div>
        <div class="preview" style="color:${color}">${icon} ${formatDuration(log.duration)} · ${log.type}</div>
      </div>
    `;
    el.addEventListener('click', () => {
      import('../features/calls.js').then(m => m.startCall(log.pin, log.type));
    });
    list.appendChild(el);
  });
}

export function renderMessages() {
  const area = document.getElementById('msg-area');
  area.innerHTML = '';
  const chat = State.chats[State.activeChatPin];
  if (!chat) return;

  let lastDay = '';
  chat.messages.forEach((msg, i) => {
    const day = new Date(msg.ts).toDateString();
    if (day !== lastDay) {
      lastDay = day;
      const div = document.createElement('div');
      div.className = 'msg-day';
      div.textContent = dayLabel(msg.ts);
      area.appendChild(div);
    }
    appendMessageBubble(msg, area);
  });
  area.scrollTop = area.scrollHeight;
}

function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday:'long', month:'short', day:'numeric' });
}

function appendMessageBubble(msg, area) {
  const isMe = msg.from === 'me';
  const wrap = document.createElement('div');
  wrap.className = `bubble-wrap ${isMe ? 'me' : 'them'}`;
  const time = new Date(msg.ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });

  let inner = '';
  if (msg.type === 'text' || msg.type === 'api') {
    const badge = msg.type === 'api' ? `<span style="font-size:11px;opacity:0.7;">via API</span><br>` : '';
    inner = `<div class="bubble ${isMe ? 'me' : 'them'}">${badge}${escapeHtml(msg.content)}<span class="time">${time}</span></div>`;
  } else if (msg.type === 'image') {
    inner = `<div class="bubble ${isMe ? 'me' : 'them'}"><img src="${msg.media}" loading="lazy" onclick="window.previewMedia('image','${msg.media}')">${msg.caption ? `<div class="caption">${escapeHtml(msg.caption)}</div>` : ''}<span class="time">${time}</span></div>`;
  } else if (msg.type === 'video') {
    inner = `<div class="bubble ${isMe ? 'me' : 'them'}"><video src="${msg.media}" controls preload="metadata" style="max-height:240px;"></video>${msg.caption ? `<div class="caption">${escapeHtml(msg.caption)}</div>` : ''}<span class="time">${time}</span></div>`;
  } else if (msg.type === 'voice') {
    const bars = Array.from({length:28},()=>Math.floor(Math.random()*20+8));
    const barHtml = bars.map(h=>`<span style="height:${h}px"></span>`).join('');
    inner = `<div class="bubble ${isMe ? 'me' : 'them'}"><div class="voice-bar"><button class="play-btn" onclick="window.playVoice(this,'${msg.media}')">&#9654;</button><div class="wave">${barHtml}</div><span>${msg.content}</span></div><span class="time">${time}</span></div>`;
  } else if (msg.type === 'sticker') {
    inner = `<div class="bubble ${isMe ? 'me' : 'them'}" style="background:transparent;padding:4px;font-size:48px;">${msg.content}</div>`;
  }

  wrap.innerHTML = inner;
  area.appendChild(wrap);
}

function escapeHtml(text) {
  const div = document.createElement('div'); div.textContent = text; return div.innerHTML;
}

export function updateBadges() {
  const totalUnread = Object.values(State.chats).reduce((a, c) => a + (c.unread || 0), 0);
  const chatBadge = document.getElementById('badge-chats');
  if (chatBadge) {
    chatBadge.textContent = totalUnread > 99 ? '99+' : totalUnread;
    chatBadge.style.display = totalUnread > 0 ? 'flex' : 'none';
  }
}

export function renderNewChatContacts() {
  const el = document.getElementById('new-chat-contacts');
  if (!el || !State.sim) return;
  el.innerHTML = '';
  State.sim.contacts.forEach(c => {
    const div = document.createElement('div');
    div.className = 'contact-item';
    div.innerHTML = `<div class="avatar" style="background:${avatarColor(c.pin)}">${initials(c.name)}</div><div class="info"><div class="name">${c.name}</div><div class="pin">${c.pin}</div></div>`;
    div.addEventListener('click', () => {
      import('../app.js').then(m => { m.closeSheet('new-chat-sheet'); m.openChat(c.pin); });
    });
    el.appendChild(div);
  });
}
