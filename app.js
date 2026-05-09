'use strict';

/* ══════════════════════════════════════════════════
   iNet v2 · app.js
   EML Tech Studio
══════════════════════════════════════════════════ */

// Prevent "App is not defined" errors before script finishes loading
if (typeof window.App === 'undefined') {
  window.App = {};
}

const API = 'https://emltechstudio-inet-v2.hf.space';
const WS_URL = 'wss://emltechstudio-inet-v2.hf.space/ws';

/* ── AVATAR COLORS ─────────────────────────────── */
const AVATAR_COLORS = [
  '#7B1535','#1E3A5F','#1A5E20','#4A148C',
  '#BF360C','#006064','#33691E','#4E342E',
  '#1A237E','#880E4F','#3E2723','#0D47A1'
];

/* ── STICKERS ───────────────────────────────────── */
const STICKER_PACKS = {
  '😊': ['😊','😂','🥹','😍','🤩','😎','🥳','😭','😤','🥺','😏','🤔','😴','🤯','🫡'],
  '🎉': ['🎉','🎊','🎈','🔥','💯','✨','⚡','🌟','💫','🎯','🏆','👑','🚀','💪','🎁'],
  '❤️': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💖','💝','💔','❣️','💌','🫶','🤝'],
  '🔥': ['👍','👎','👋','🤜','🤛','👏','🙌','🤦','🤷','💁','🙅','🙆','🫠','🫢','🫣']
};

/* ══════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════ */
const State = {
  sim: null,           // { net_number, created_at, contacts[] }
  simPassword: null,   // in-memory only
  deviceId: null,      // per-session device id
  vapidKey: null,

  ws: null,
  wsReady: false,
  wsReconnectTimer: null,
  wsReconnectDelay: 2000,

  activeTab: 'chats',
  activeChatPin: null,
  chats: {},           // { [pin]: { messages:[], unread:0 } }
  callLog: [],         // stored in localStorage

  onlineStatus: {},    // { [pin]: { online, last_seen, in_call } }

  // Call state
  currentCall: null,   // { pin, type, direction, state, startTime }
  peerConn: null,
  localStream: null,
  remoteStream: null,
  callTimer: null,
  isMuted: false,
  isSpeaker: false,
  isCameraOff: false,
  pendingOffer: null,  // stored offer for incoming call

  // Group call state
  groupCall: null,     // { roomId, members:{}, peerConns:{} }

  // Recording state
  mediaRecorder: null,
  recChunks: [],
  recTimer: null,
  recSeconds: 0,
  recLimit: 600, // 10 min

  // Media preview
  pendingMedia: null,  // { type, data, mimeType }

  // Edit target
  editingContactPin: null,
};

/* ══════════════════════════════════════════════════
   CRYPTO HELPERS (SIM encryption)
══════════════════════════════════════════════════ */
const Crypto = {
  async deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false, ['encrypt', 'decrypt']
    );
  },

  async encrypt(password, data) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(password, salt);
    const enc = new TextEncoder();
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
    // pack: salt(16) + iv(12) + ciphertext
    const buf = new Uint8Array(16 + 12 + ct.byteLength);
    buf.set(salt, 0);
    buf.set(iv, 16);
    buf.set(new Uint8Array(ct), 28);
    return btoa(String.fromCharCode(...buf));
  },

  async decrypt(password, b64) {
    const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const salt = buf.slice(0, 16);
    const iv = buf.slice(16, 28);
    const ct = buf.slice(28);
    const key = await this.deriveKey(password, salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(plain));
  },

  randomDeviceId() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  }
};

/* ══════════════════════════════════════════════════
   STORAGE HELPERS
══════════════════════════════════════════════════ */
const Store = {
  get(k, def = null) {
    try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : def; } catch { return def; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { localStorage.removeItem(k); },

  getChats() { return Store.get('inet_chats', {}); },
  saveChats() { Store.set('inet_chats', State.chats); },

  getCallLog() { return Store.get('inet_calllog', []); },
  saveCallLog() { Store.set('inet_calllog', State.callLog); },
};

/* ══════════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════════ */
const Utils = {
  initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  },

  avatarColor(pin) {
    const idx = parseInt(pin || '0') % AVATAR_COLORS.length;
    return AVATAR_COLORS[idx];
  },

  formatTime(date) {
    const d = new Date(date);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'now';
    if (diff < 3600000) return `${Math.floor(diff/60000)}m`;
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    if (diff < 86400000 * 7) return d.toLocaleDateString([],{weekday:'short'});
    return d.toLocaleDateString([],{month:'short',day:'numeric'});
  },

  formatDuration(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${s.toString().padStart(2,'0')}`;
  },

  formatDate(iso) {
    return new Date(iso).toLocaleDateString([], { year:'numeric', month:'long', day:'numeric' });
  },

  contactName(pin) {
    if (!State.sim) return pin;
    const c = State.sim.contacts.find(c => c.pin === pin);
    return c ? c.name : pin;
  },

  isValidPin(pin) { return /^\d{6}$/.test(pin); },

  b64toBlob(b64, mime) {
    const bin = atob(b64.split(',').pop());
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  },

  async blobToB64(blob) {
    return new Promise(res => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(blob);
    });
  },

  async compressImage(file, maxKb = 500) {
    return new Promise(res => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        const max = 1280;
        if (width > max || height > max) {
          if (width > height) { height = height * max / width; width = max; }
          else { width = width * max / height; height = max; }
        }
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        let q = 0.85;
        const tryQ = () => {
          canvas.toBlob(blob => {
            if (blob.size <= maxKb * 1024 || q < 0.3) res(blob);
            else { q -= 0.1; tryQ(); }
          }, 'image/jpeg', q);
        };
        tryQ();
      };
      img.src = url;
    });
  },

  waveformBars(count = 30) {
    return Array.from({ length: count }, () => Math.floor(Math.random() * 20 + 8));
  },

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); },
};

/* ══════════════════════════════════════════════════
   UI HELPERS
══════════════════════════════════════════════════ */
const UI = {
  $(id) { return document.getElementById(id); },

  show(id) { const el = this.$(id); if (el) { el.classList.remove('hidden'); el.style.display = ''; } },
  hide(id) { const el = this.$(id); if (el) el.classList.add('hidden'); },

  showOverlay(id) { this.$(id).classList.add('show'); },
  hideOverlay(id) { this.$(id).classList.remove('show'); },

  toast(title, msg, duration = 3500) {
    const el = this.$('toast-notif');
    this.$('toast-notif-title').textContent = title;
    this.$('toast-notif-msg').textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), duration);
  },

  avatarEl(name, pin, size = '') {
    const color = Utils.avatarColor(pin);
    return `<div class="avatar${size ? ' '+size : ''}" style="background:${color}">${Utils.initials(name)}</div>`;
  },

  setAvatar(elId, name, pin) {
    const el = this.$(elId);
    if (!el) return;
    el.textContent = Utils.initials(name);
    el.style.background = Utils.avatarColor(pin);
  },

  spinner(size = 20) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;
  },

  setLoading(btnId, loading, text = '') {
    const btn = this.$(btnId);
    if (!btn) return;
    btn.disabled = loading;
    if (loading) btn.innerHTML = `${this.spinner(18)} ${text || 'Please wait...'}`;
  },
};

/* ══════════════════════════════════════════════════
   SIM MANAGEMENT
══════════════════════════════════════════════════ */
const SIM = {
  async create(password) {
    // Call backend
    const res = await fetch(`${API}/sim/new`, { method: 'POST' });
    if (!res.ok) throw new Error('Backend error creating SIM');
    const { net_number, device_id, vapid_public_key } = await res.json();

    State.sim = {
      net_number,
      created_at: new Date().toISOString(),
      contacts: [],
    };
    State.simPassword = password;
    State.deviceId = device_id;
    State.vapidKey = vapid_public_key;

    // Persist device_id (not in SIM file, just local)
    Store.set('inet_device_id', device_id);
    Store.set('inet_vapid', vapid_public_key);

    return { net_number };
  },

  async activate(simData, password) {
    // Validate existing SIM on this device
    const device_id = Crypto.randomDeviceId();
    const res = await fetch(`${API}/sim/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ net_number: simData.net_number, device_id })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Activation failed');
    }
    const { vapid_public_key } = await res.json();

    State.sim = simData;
    State.simPassword = password;
    State.deviceId = device_id;
    State.vapidKey = vapid_public_key;

    Store.set('inet_device_id', device_id);
    Store.set('inet_vapid', vapid_public_key);
  },

  async validateExisting() {
    const deviceId = Store.get('inet_device_id');
    const encSim = Store.get('inet_enc_sim');
    if (!deviceId || !encSim) return false;

    // We have an encrypted SIM — need password to use whoami
    // Store the enc sim for later unlock, return partial info
    State._encSim = encSim;
    return 'locked'; // signal: has sim but needs unlock
  },

  async whoami(net_number, device_id) {
    const res = await fetch(`${API}/sim/whoami?net_number=${net_number}&device_id=${device_id}`);
    if (!res.ok) return null;
    return res.json();
  },

  async save() {
    if (!State.sim || !State.simPassword) return;
    const enc = await Crypto.encrypt(State.simPassword, State.sim);
    Store.set('inet_enc_sim', enc);
  },

  async exportFile() {
    if (!State.sim || !State.simPassword) return;
    const enc = await Crypto.encrypt(State.simPassword, State.sim);
    const blob = new Blob([enc], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inet-${State.sim.net_number}.sim.inet`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async importFile(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.trim());
      r.onerror = () => rej(new Error('Failed to read file'));
      r.readAsText(file);
    });
  },

  async decryptFile(encData, password) {
    return Crypto.decrypt(password, encData);
  },

  addContact(name, pin) {
    if (!State.sim) return;
    const exists = State.sim.contacts.find(c => c.pin === pin);
    if (exists) { exists.name = name; }
    else { State.sim.contacts.push({ name, pin }); }
    State.sim.contacts.sort((a, b) => a.name.localeCompare(b.name));
    SIM.save();
  },

  updateContact(oldPin, name, pin) {
    if (!State.sim) return;
    const c = State.sim.contacts.find(c => c.pin === oldPin);
    if (c) { c.name = name; c.pin = pin; }
    State.sim.contacts.sort((a, b) => a.name.localeCompare(b.name));
    SIM.save();
  },

  deleteContact(pin) {
    if (!State.sim) return;
    State.sim.contacts = State.sim.contacts.filter(c => c.pin !== pin);
    SIM.save();
  },

  eject() {
    State.sim = null;
    State.simPassword = null;
    State.deviceId = null;
    Store.del('inet_enc_sim');
    Store.del('inet_device_id');
    Store.del('inet_vapid');
    sessionStorage.removeItem('inet_sim');
    sessionStorage.removeItem('inet_device');
    sessionStorage.removeItem('inet_vapid_s');
    sessionStorage.removeItem('inet_pass');
    if (State.ws) { State.ws.close(); State.ws = null; }
  },
};

/* ══════════════════════════════════════════════════
   WEBSOCKET
══════════════════════════════════════════════════ */
const WS = {
  connect() {
    if (State.ws && State.ws.readyState < 2) return;
    const { net_number } = State.sim;
    const url = `${WS_URL}?net_number=${net_number}&device_id=${State.deviceId}`;
    const ws = new WebSocket(url);
    State.ws = ws;
    State.wsReady = false;

    ws.onopen = () => {
      console.log('[WS] connected');
      State.wsReady = true;
      State.wsReconnectDelay = 2000;
      clearTimeout(State.wsReconnectTimer);
      WS.startPing();
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      WS.handle(msg);
    };

    ws.onclose = () => {
      console.log('[WS] disconnected — reconnecting in', State.wsReconnectDelay, 'ms');
      State.wsReady = false;
      clearInterval(State._pingInterval);
      State.wsReconnectTimer = setTimeout(() => WS.connect(), State.wsReconnectDelay);
      State.wsReconnectDelay = Math.min(State.wsReconnectDelay * 1.5, 30000);
    };

    ws.onerror = (e) => console.error('[WS] error', e);
  },

  send(obj) {
    if (State.ws && State.wsReady) {
      State.ws.send(JSON.stringify(obj));
    } else {
      console.warn('[WS] not ready, dropping message', obj.type);
    }
  },

  startPing() {
    clearInterval(State._pingInterval);
    State._pingInterval = setInterval(() => {
      WS.send({ type: 'ping' });
    }, 25000);
  },

  handle(msg) {
    const { type } = msg;
    console.log('[WS]', type, msg);

    switch (type) {
      case 'pong': break;

      case 'offline_messages':
        if (Array.isArray(msg.messages)) {
          msg.messages.forEach(m => WS.handle(m));
        }
        break;

      case 'status_change':
        Status.update(msg.pin, { online: msg.online, last_seen: msg.last_seen });
        break;

      case 'chat':
        Chat.receive(msg);
        break;

      case 'call_offer':
        Call.handleOffer(msg);
        break;

      case 'call_answer':
        Call.handleAnswer(msg);
        break;

      case 'call_end':
        Call.handleEnd(msg);
        break;

      case 'call_busy':
        Call.handleBusy(msg);
        break;

      case 'ice_candidate':
        Call.handleIce(msg);
        break;

      case 'gc_join':
        GroupCall.handleJoin(msg);
        break;

      case 'gc_leave':
        GroupCall.handleLeave(msg);
        break;

      case 'gc_invite':
        GroupCall.handleInvite(msg);
        break;

      case 'otp':
        UI.$('toast-otp-code').textContent = msg.code;
        UI.$('toast-otp-from').textContent = `From: ${msg.from || 'Service'}`;
        UI.$('otp-toast').classList.add('show');
        setTimeout(() => UI.$('otp-toast').classList.remove('show'), 15000);
        break;

      case 'api_message':
        Chat.receiveApiMessage(msg);
        break;

      default:
        console.log('[WS] unhandled type:', type);
    }
  },
};

/* ══════════════════════════════════════════════════
   STATUS
══════════════════════════════════════════════════ */
const Status = {
  update(pin, data) {
    State.onlineStatus[pin] = { ...State.onlineStatus[pin], ...data };

    // Update chat header if open
    if (State.activeChatPin === pin) {
      const dot = UI.$('chat-status-dot');
      const txt = UI.$('chat-status-text');
      if (dot && txt) {
        dot.className = 'status-dot' + (data.online ? ' online' : '');
        txt.textContent = data.online ? 'Online' : Utils.formatTime(data.last_seen) + ' ago';
      }
    }

    // Refresh chat list item
    Render.chatList();
  },

  async fetchBatch(pins) {
    if (!pins.length) return;
    try {
      const res = await fetch(`${API}/status/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pins })
      });
      if (!res.ok) return;
      const data = await res.json();
      Object.entries(data).forEach(([pin, info]) => {
        State.onlineStatus[pin] = info;
      });
      Render.chatList();
      Render.contactList();
    } catch (e) {
      console.error('Status batch failed', e);
    }
  },

  isOnline(pin) { return !!(State.onlineStatus[pin]?.online); },
};

/* ══════════════════════════════════════════════════
   PUSH NOTIFICATIONS
══════════════════════════════════════════════════ */
const Push = {
  async subscribe() {
    if (!('serviceWorker' in navigator) || !State.vapidKey) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlB64ToUint8Array(State.vapidKey)
      });
      await fetch(`${API}/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          net_number: State.sim.net_number,
          device_id: State.deviceId,
          subscription: sub.toJSON()
        })
      });
      return true;
    } catch (e) {
      console.error('Push subscribe failed', e);
      return false;
    }
  },

  urlB64ToUint8Array(b64) {
    const padding = '='.repeat((4 - b64.length % 4) % 4);
    const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  }
};

/* ══════════════════════════════════════════════════
   CHAT
══════════════════════════════════════════════════ */
const Chat = {
  ensure(pin) {
    if (!State.chats[pin]) {
      State.chats[pin] = { messages: [], unread: 0 };
    }
    return State.chats[pin];
  },

  receive(msg) {
    const from = msg.from || msg.payload?.from;
    const pin = from || msg.pin;
    if (!pin) return;
    const chat = Chat.ensure(pin);

    const message = {
      id: msg.id || Date.now() + Math.random(),
      from: pin,
      type: msg.payload?.type || 'text',
      content: msg.payload?.content || msg.payload?.text || '',
      media: msg.payload?.media || null,
      caption: msg.payload?.caption || '',
      ts: msg.payload?.ts || Date.now(),
    };

    chat.messages.push(message);

    if (State.activeChatPin === pin) {
      Render.appendMessage(message, false);
    } else {
      chat.unread++;
      // In-app notification
      const name = Utils.contactName(pin);
      let preview = message.content;
      if (message.type === 'image') preview = 'Sent a photo';
      else if (message.type === 'video') preview = 'Sent a video';
      else if (message.type === 'voice') preview = 'Voice note';
      else if (message.type === 'sticker') preview = 'Sticker';
      UI.toast(name, preview || 'New message');
      Render.chatList();
    }

    Store.saveChats();
    Render.tabBadges();
  },

  receiveApiMessage(msg) {
    const fakeMsg = {
      from: msg.from || 'api',
      payload: {
        type: 'api',
        content: msg.content || msg.message || '',
        label: msg.label || msg.from || 'API',
        ts: Date.now(),
      }
    };
    Chat.receive(fakeMsg);
  },

  send(content, type = 'text', media = null, caption = '') {
    const pin = State.activeChatPin;
    if (!pin) return;
    const chat = Chat.ensure(pin);

    const message = {
      id: Date.now() + Math.random(),
      from: 'me',
      type,
      content,
      media,
      caption,
      ts: Date.now(),
    };

    // Send via WS
    WS.send({
      type: 'chat',
      target: pin,
      payload: { type, content, media, caption, ts: message.ts }
    });

    chat.messages.push(message);
    Render.appendMessage(message, true);
    Store.saveChats();
    Render.chatList();
  },

  open(pin) {
    State.activeChatPin = pin;
    const chat = Chat.ensure(pin);
    chat.unread = 0;
    Store.saveChats();
    Render.tabBadges();

    const name = Utils.contactName(pin);
    UI.setAvatar('chat-hdr-avatar', name, pin);
    UI.$('chat-hdr-name').textContent = name;

    const online = Status.isOnline(pin);
    UI.$('chat-status-dot').className = 'status-dot' + (online ? ' online' : '');
    UI.$('chat-status-text').textContent = online ? 'Online' : 'Offline';

    // Render messages
    const area = UI.$('msg-area');
    area.innerHTML = '';
    chat.messages.forEach((m, i) => {
      const prev = chat.messages[i - 1];
      // Day divider
      if (!prev || !sameDay(prev.ts, m.ts)) {
        const div = document.createElement('div');
        div.className = 'msg-day';
        div.textContent = dayLabel(m.ts);
        area.appendChild(div);
      }
      Render.appendMessage(m, m.from === 'me');
    });

    area.scrollTop = area.scrollHeight;
    Status.fetchBatch([pin]);
  },
};

function sameDay(a, b) {
  const da = new Date(a), db = new Date(b);
  return da.toDateString() === db.toDateString();
}
function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday:'long', month:'short', day:'numeric' });
}

/* ══════════════════════════════════════════════════
   RENDER
══════════════════════════════════════════════════ */
const Render = {
  chatList(filter = '') {
    const list = UI.$('chats-list');
    const entries = Object.entries(State.chats);
    const filtered = filter
      ? entries.filter(([pin]) => {
          const name = Utils.contactName(pin).toLowerCase();
          return name.includes(filter) || pin.includes(filter);
        })
      : entries;

    // Sort by last message time
    filtered.sort((a, b) => {
      const la = a[1].messages.at(-1)?.ts || 0;
      const lb = b[1].messages.at(-1)?.ts || 0;
      return lb - la;
    });

    // Clear existing items, keep empty state
    Array.from(list.querySelectorAll('.chat-item')).forEach(el => el.remove());

    const empty = UI.$('chats-empty');
    if (!filtered.length) {
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';

    filtered.forEach(([pin, chat]) => {
      const last = chat.messages.at(-1);
      const name = Utils.contactName(pin);
      const online = Status.isOnline(pin);
      const color = Utils.avatarColor(pin);
      const initials = Utils.initials(name);
      const unread = chat.unread || 0;
      const time = last ? Utils.formatTime(last.ts) : '';
      let preview = '';
      if (last) {
        if (last.type === 'text' || last.type === 'api') preview = last.content;
        else if (last.type === 'image') preview = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/><polyline points="21 15 16 10 5 21"/></svg> Photo';
        else if (last.type === 'video') preview = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg> Video';
        else if (last.type === 'voice') preview = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/></svg> Voice note';
        else if (last.type === 'sticker') preview = 'Sticker';
      }

      const el = document.createElement('div');
      el.className = 'chat-item';
      el.onclick = () => App.openChat(pin);
      el.innerHTML = `
        <div class="avatar" style="background:${color}">
          ${initials}
          ${online ? '<span class="online-dot"></span>' : ''}
        </div>
        <div class="chat-info">
          <div class="chat-name">${name}</div>
          <div class="chat-preview">${preview || '<span style="color:var(--text-3)">Say hello</span>'}</div>
        </div>
        <div class="chat-meta">
          <div class="chat-time ${unread ? 'unread' : ''}">${time}</div>
          ${unread ? `<div class="unread-badge">${unread > 99 ? '99+' : unread}</div>` : ''}
        </div>
      `;
      list.appendChild(el);
    });
  },

  contactList(filter = '') {
    const list = UI.$('contacts-list');
    Array.from(list.querySelectorAll('.contact-item, .alpha-divider')).forEach(el => el.remove());

    if (!State.sim) return;
    const contacts = filter
      ? State.sim.contacts.filter(c =>
          c.name.toLowerCase().includes(filter.toLowerCase()) || c.pin.includes(filter)
        )
      : State.sim.contacts;

    const empty = UI.$('contacts-empty');
    if (!contacts.length) { empty.style.display = 'flex'; return; }
    empty.style.display = 'none';

    let lastLetter = '';
    contacts.forEach(c => {
      const letter = c.name[0].toUpperCase();
      if (letter !== lastLetter) {
        lastLetter = letter;
        const div = document.createElement('div');
        div.className = 'alpha-divider';
        div.textContent = letter;
        list.appendChild(div);
      }

      const online = Status.isOnline(c.pin);
      const el = document.createElement('div');
      el.className = 'contact-item';
      el.onclick = () => App.openContactDetail(c.pin);
      el.innerHTML = `
        <div class="avatar sm" style="background:${Utils.avatarColor(c.pin)}">
          ${Utils.initials(c.name)}
          ${online ? '<span class="online-dot" style="width:10px;height:10px"></span>' : ''}
        </div>
        <div class="contact-info">
          <div class="contact-name">${c.name}</div>
          <div class="contact-pin">${c.pin}</div>
        </div>
        <div class="contact-actions">
          <button class="contact-act-btn" onclick="event.stopPropagation();App.callContact('${c.pin}','audio')" title="Call">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07"/><path d="M2 1l21 21"/></svg>
          </button>
          <button class="contact-act-btn" onclick="event.stopPropagation();App.openChat('${c.pin}')" title="Message">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          </button>
        </div>
      `;
      list.appendChild(el);
    });
  },

  appendMessage(msg, isMe) {
    const area = UI.$('msg-area');
    if (!area) return;

    const wrap = document.createElement('div');
    wrap.className = `bubble-wrap ${isMe ? 'me' : 'them'}`;

    const time = new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const tick = isMe ? `<span class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:rgba(255,255,255,.7)"><polyline points="20 6 9 17 4 12"/></svg></span>` : '';

    let bubbleHtml = '';

    if (msg.type === 'text' || msg.type === 'api') {
      const badge = msg.type === 'api' ? `<div class="api-msg-badge">via API</div>` : '';
      bubbleHtml = `
        <div class="bubble ${isMe ? 'me' : 'them'}">
          ${badge}${msg.content}
        </div>
        <div class="bubble-time ${isMe ? 'me' : ''}">${time}${tick}</div>
      `;
    } else if (msg.type === 'image') {
      bubbleHtml = `
        <div class="bubble bubble-img ${isMe ? 'me' : 'them'}" onclick="App.previewMedia('image','${msg.media}')">
          <img src="${msg.media}" loading="lazy" alt=""/>
          ${msg.caption ? `<div style="padding:6px 8px 2px;font-size:13px;${isMe?'color:#fff':''}">${msg.caption}</div>` : ''}
        </div>
        <div class="bubble-time ${isMe ? 'me' : ''}">${time}${tick}</div>
      `;
    } else if (msg.type === 'video') {
      bubbleHtml = `
        <div class="bubble bubble-video ${isMe ? 'me' : 'them'}" onclick="App.previewMedia('video','${msg.media}')">
          <video src="${msg.media}" preload="metadata"></video>
          <div class="play-overlay"><div class="play-btn-circle"><svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><polygon points="5 3 19 12 5 21 5 3"/></svg></div></div>
          ${msg.caption ? `<div style="padding:6px 8px 2px;font-size:13px">${msg.caption}</div>` : ''}
        </div>
        <div class="bubble-time ${isMe ? 'me' : ''}">${time}${tick}</div>
      `;
    } else if (msg.type === 'voice') {
      const bars = Utils.waveformBars(28);
      const barHtml = bars.map(h => `<div class="vn-bar" style="height:${h}px"></div>`).join('');
      bubbleHtml = `
        <div class="bubble ${isMe ? 'me' : 'them'} voice-bubble">
          <button class="vn-play-btn" onclick="App.playVoiceNote(this,'${msg.media}')">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </button>
          <div class="vn-waveform">${barHtml}</div>
          <span class="vn-duration">${msg.content || '0:00'}</span>
        </div>
        <div class="bubble-time ${isMe ? 'me' : ''}">${time}${tick}</div>
      `;
    } else if (msg.type === 'sticker') {
      bubbleHtml = `
        <div class="bubble sticker-bubble">
          <div style="font-size:64px;line-height:1">${msg.content}</div>
        </div>
      `;
    }

    wrap.innerHTML = bubbleHtml;
    area.appendChild(wrap);
    area.scrollTop = area.scrollHeight;
  },

  callLog(filter = 'all') {
    const list = UI.$('calllog-list');
    Array.from(list.querySelectorAll('.call-log-item')).forEach(el => el.remove());

    const logs = filter === 'all' ? State.callLog : State.callLog.filter(l => l.direction === filter || (filter === 'missed' && l.missed));
    const empty = UI.$('calllog-empty');
    if (!logs.length) { empty.style.display = 'flex'; return; }
    empty.style.display = 'none';

    logs.slice().reverse().forEach(log => {
      const name = Utils.contactName(log.pin);
      const typeClass = log.missed ? 'missed' : log.direction;
      const typeIcon = log.missed
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`
        : log.direction === 'outgoing'
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="17" y1="7" x2="7" y2="17"/><polyline points="7 7 7 17 17 17"/></svg>`;

      const el = document.createElement('div');
      el.className = 'call-log-item';
      el.innerHTML = `
        <div class="avatar sm" style="background:${Utils.avatarColor(log.pin)}">${Utils.initials(name)}</div>
        <div class="call-log-info">
          <div class="call-log-name ${log.missed ? 'text-wine' : ''}">${name}</div>
          <div class="call-log-meta">
            <span class="call-type-icon ${typeClass}">${typeIcon}</span>
            ${log.type === 'video' ? '<svg viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="2" width="12" height="12"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>' : ''}
            <span>${Utils.formatTime(log.ts)}</span>
            ${log.duration ? `<span>· ${Utils.formatDuration(log.duration)}</span>` : ''}
          </div>
        </div>
        <button class="call-back-btn" onclick="App.callFromLog('${log.pin}','${log.type}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 8.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/></svg>
        </button>
      `;
      list.appendChild(el);
    });
  },

  dialpadRecents() {
    const el = UI.$('dialpad-recents');
    if (!el) return;
    el.innerHTML = '';
    const recents = State.callLog.slice(-5).reverse();
    recents.forEach(log => {
      const name = Utils.contactName(log.pin);
      const item = document.createElement('div');
      item.className = 'call-log-item';
      item.style.cursor = 'pointer';
      item.onclick = () => App.dialFromRecent(log.pin);
      item.innerHTML = `
        <div class="avatar sm" style="background:${Utils.avatarColor(log.pin)}">${Utils.initials(name)}</div>
        <div class="call-log-info">
          <div class="call-log-name">${name}</div>
          <div class="call-log-meta"><span>${log.pin}</span><span>· ${Utils.formatTime(log.ts)}</span></div>
        </div>
        <button class="call-back-btn" onclick="event.stopPropagation();App.callFromLog('${log.pin}','${log.type}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 8.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/></svg>
        </button>
      `;
      el.appendChild(item);
    });
  },

  roomsList() {
    const list = UI.$('rooms-list');
    if (!list) return;
    const rooms = Store.get('inet_rooms', []);
    list.innerHTML = '';
    if (!rooms.length) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="36" height="36"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></div>
          <div class="empty-title">No rooms yet</div>
          <div class="empty-sub">Create a room and share the link to start a group call</div>
        </div>`;
      return;
    }
    rooms.forEach(room => {
      const when = room.scheduledTime
        ? new Date(room.scheduledTime).toLocaleString([], { weekday:'short', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
        : 'Ready to join';
      const el = document.createElement('div');
      el.className = 'room-card';
      el.innerHTML = `
        <div class="room-card-top">
          <div class="room-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
          </div>
          <div class="room-info">
            <div class="room-name">${room.name}</div>
            <div class="room-when">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              ${when}
            </div>
            <div class="room-id-text">ID: ${room.id}</div>
          </div>
        </div>
        <div class="room-actions">
          <button class="room-btn room-join" onclick="App.joinRoom('${room.id}','${room.name.replace(/'/g,"\\'")}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
            Join
          </button>
          <button class="room-btn room-share" onclick="App.shareRoom('${room.id}','${room.name.replace(/'/g,"\\'")}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            Share
          </button>
          <button class="room-btn room-delete" onclick="App.deleteRoom('${room.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>
        </div>
      `;
      list.appendChild(el);
    });
  },

  tabBadges() {
    const totalUnread = Object.values(State.chats).reduce((acc, c) => acc + (c.unread || 0), 0);
    const chatBadge = UI.$('badge-chats');
    if (totalUnread > 0) {
      chatBadge.textContent = totalUnread > 99 ? '99+' : totalUnread;
      chatBadge.classList.add('show');
    } else {
      chatBadge.classList.remove('show');
    }

    const missedCalls = State.callLog.filter(l => l.missed && !l.seen).length;
    const callBadge = UI.$('badge-calls');
    if (missedCalls > 0) {
      callBadge.textContent = missedCalls;
      callBadge.classList.add('show');
    } else {
      callBadge.classList.remove('show');
    }
  },

  newChatContacts() {
    const el = UI.$('new-chat-contacts');
    if (!el || !State.sim) return;
    el.innerHTML = '';
    State.sim.contacts.forEach(c => {
      const div = document.createElement('div');
      div.className = 'contact-item';
      div.style.padding = '10px 0';
      div.onclick = () => { App.hideNewChat(); App.openChat(c.pin); };
      div.innerHTML = `
        <div class="avatar sm" style="background:${Utils.avatarColor(c.pin)}">${Utils.initials(c.name)}</div>
        <div class="contact-info">
          <div class="contact-name">${c.name}</div>
          <div class="contact-pin">${c.pin}</div>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="2" width="18" height="18"><polyline points="9 18 15 12 9 6"/></svg>
      `;
      el.appendChild(div);
    });
  },

  gcInviteList() {
    const el = UI.$('gc-invite-list');
    if (!el || !State.sim) return;
    el.innerHTML = '';
    State.sim.contacts.forEach(c => {
      const alreadyIn = State.groupCall?.members?.[c.pin];
      if (alreadyIn) return;
      const div = document.createElement('div');
      div.className = 'invite-contact-item';
      div.innerHTML = `
        <div class="invite-check" onclick="this.classList.toggle('checked');this.querySelector('svg').style.display=this.classList.contains('checked')?'block':'none'" data-pin="${c.pin}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:none"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
        <div class="invite-contact-info">
          <div class="invite-contact-name">${c.name}</div>
          <div class="invite-contact-pin">${c.pin}</div>
        </div>
      `;
      el.appendChild(div);
    });
  },

  gcParticipants() {
    const el = UI.$('gc-participants');
    if (!el || !State.groupCall) return;
    el.innerHTML = '';

    const memberCount = Object.keys(State.groupCall.members).length + 1; // +1 for self
    const gridClass = memberCount <= 1 ? 'gc-grid-1' : memberCount === 2 ? 'gc-grid-2' : memberCount <= 4 ? 'gc-grid-2' : 'gc-grid-3';
    el.className = `gc-participants ${gridClass}`;

    // Self tile
    const selfDiv = document.createElement('div');
    selfDiv.className = 'gc-participant';
    selfDiv.id = 'gc-self';
    selfDiv.innerHTML = `
      <video id="gc-local-video" autoplay muted playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
      <div class="gc-p-info">
        <div class="gc-p-avatar" style="background:var(--wine)">${Utils.initials(State.sim.net_number)}</div>
        <div class="gc-p-name">You</div>
      </div>
      <div style="position:absolute;top:8px;left:8px;background:rgba(0,0,0,.5);border-radius:6px;padding:3px 8px;font-size:11px;font-weight:600;color:#fff">You</div>
    `;
    el.appendChild(selfDiv);

    Object.entries(State.groupCall.members).forEach(([pin, member]) => {
      const name = Utils.contactName(pin);
      const div = document.createElement('div');
      div.className = 'gc-participant';
      div.id = `gc-p-${pin}`;
      div.innerHTML = `
        <video id="gc-video-${pin}" autoplay playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>
        <div class="gc-p-info">
          <div class="gc-p-avatar" style="background:${Utils.avatarColor(pin)}">${Utils.initials(name)}</div>
          <div class="gc-p-name">${name}</div>
        </div>
        <div style="position:absolute;top:8px;left:8px;background:rgba(0,0,0,.5);border-radius:6px;padding:3px 8px;font-size:11px;font-weight:600;color:#fff">${name}</div>
        ${member.muted ? `<div class="gc-p-muted"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 005.12 2.12"/></svg></div>` : ''}
      `;
      el.appendChild(div);
    });
  },
};

/* ══════════════════════════════════════════════════
   WEBRTC CALLS
══════════════════════════════════════════════════ */
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

const Call = {
  async start(pin, type = 'audio') {
    if (State.currentCall) { UI.toast('Busy', 'Already in a call'); return; }

    State.currentCall = { pin, type, direction: 'outgoing', state: 'calling', startTime: null };

    try {
      State.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === 'video'
      });
    } catch (e) {
      UI.toast('Permission denied', 'Microphone/camera access required');
      State.currentCall = null;
      return;
    }

    // Show call UI
    this.showCallScreen(pin, type, 'calling');

    // Create peer connection
    State.peerConn = new RTCPeerConnection(ICE_CONFIG);
    State.localStream.getTracks().forEach(t => State.peerConn.addTrack(t, State.localStream));

    State.peerConn.onicecandidate = ({ candidate }) => {
      if (candidate) WS.send({ type: 'ice_candidate', target: pin, candidate });
    };

    State.peerConn.ontrack = (ev) => {
      State.remoteStream = ev.streams[0];
      const vid = UI.$('remote-video');
      if (vid) vid.srcObject = State.remoteStream;
    };

    State.peerConn.onconnectionstatechange = () => {
      const s = State.peerConn?.connectionState;
      if (s === 'connected') {
        State.currentCall.state = 'active';
        State.currentCall.startTime = Date.now();
        UI.$('call-status').textContent = 'Connected';
        this.startTimer();
      } else if (s === 'failed' || s === 'disconnected') {
        this.endCall(true);
      }
    };

    const offer = await State.peerConn.createOffer();
    await State.peerConn.setLocalDescription(offer);

    WS.send({
      type: 'call_offer',
      target: pin,
      call_type: type,
      sdp: offer.sdp
    });
  },

  async handleOffer(msg) {
    if (State.currentCall) {
      WS.send({ type: 'call_busy', target: msg.from }); return;
    }

    State.pendingOffer = msg;
    const name = Utils.contactName(msg.from);

    // Show incoming call
    UI.setAvatar('inc-avatar', name, msg.from);
    UI.$('inc-name').textContent = name;
    UI.$('inc-pin').textContent = msg.from;
    UI.$('inc-type-label').textContent = `Incoming ${msg.call_type === 'video' ? 'Video' : 'Audio'} Call`;
    UI.$('inc-badge').innerHTML = msg.call_type === 'video'
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg> Video Call`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 16.92v3a2 2 0 01-2.18 2"/></svg> Audio Call`;

    UI.showOverlay('overlay-incoming');
  },

  async acceptCall() {
    const msg = State.pendingOffer;
    if (!msg) return;
    UI.hideOverlay('overlay-incoming');
    State.pendingOffer = null;

    State.currentCall = { pin: msg.from, type: msg.call_type, direction: 'incoming', state: 'connecting', startTime: null };

    try {
      State.localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: msg.call_type === 'video'
      });
    } catch (e) {
      UI.toast('Error', 'Media access failed');
      State.currentCall = null;
      return;
    }

    this.showCallScreen(msg.from, msg.call_type, 'connecting');

    State.peerConn = new RTCPeerConnection(ICE_CONFIG);
    State.localStream.getTracks().forEach(t => State.peerConn.addTrack(t, State.localStream));

    State.peerConn.onicecandidate = ({ candidate }) => {
      if (candidate) WS.send({ type: 'ice_candidate', target: msg.from, candidate });
    };

    State.peerConn.ontrack = (ev) => {
      State.remoteStream = ev.streams[0];
      const vid = UI.$('remote-video');
      if (vid) vid.srcObject = State.remoteStream;
    };

    State.peerConn.onconnectionstatechange = () => {
      const s = State.peerConn?.connectionState;
      if (s === 'connected') {
        State.currentCall.state = 'active';
        State.currentCall.startTime = Date.now();
        UI.$('call-status').textContent = 'Connected';
        this.startTimer();
      } else if (s === 'failed' || s === 'disconnected') {
        this.endCall(true);
      }
    };

    await State.peerConn.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
    const answer = await State.peerConn.createAnswer();
    await State.peerConn.setLocalDescription(answer);

    WS.send({ type: 'call_answer', target: msg.from, sdp: answer.sdp });
  },

  async handleAnswer(msg) {
    if (!State.peerConn) return;
    await State.peerConn.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
  },

  async handleIce(msg) {
    if (!State.peerConn) return;
    try { await State.peerConn.addIceCandidate(msg.candidate); } catch {}
  },

  handleEnd(msg) {
    if (State.currentCall?.pin === msg.from || !State.currentCall) {
      this.endCall(false, true);
    }
  },

  handleBusy(msg) {
    UI.toast('Line Busy', `${Utils.contactName(msg.from)} is on another call`);
    this.cleanupCall();
    this.logCall(State.currentCall?.pin, State.currentCall?.type, 'outgoing', 0, false);
    UI.hideOverlay('overlay-call');
    State.currentCall = null;
  },

  declineCall() {
    if (State.pendingOffer) {
      WS.send({ type: 'call_end', target: State.pendingOffer.from });
      this.logCall(State.pendingOffer.from, State.pendingOffer.call_type, 'incoming', 0, true);
      State.pendingOffer = null;
    }
    UI.hideOverlay('overlay-incoming');
  },

  endCall(fromError = false, remote = false) {
    if (!State.currentCall) return;
    if (!remote) {
      WS.send({ type: 'call_end', target: State.currentCall.pin });
    }
    const duration = State.currentCall.startTime
      ? Math.floor((Date.now() - State.currentCall.startTime) / 1000) : 0;
    this.logCall(
      State.currentCall.pin,
      State.currentCall.type,
      State.currentCall.direction,
      duration,
      duration === 0 && State.currentCall.direction === 'incoming'
    );
    this.cleanupCall();
    UI.hideOverlay('overlay-call');
    State.currentCall = null;
  },

  cleanupCall() {
    clearInterval(State.callTimer);
    if (State.localStream) { State.localStream.getTracks().forEach(t => t.stop()); State.localStream = null; }
    if (State.peerConn) { State.peerConn.close(); State.peerConn = null; }
    State.isMuted = false;
    State.isSpeaker = false;
    State.isCameraOff = false;
  },

  showCallScreen(pin, type, status) {
    const name = Utils.contactName(pin);
    UI.setAvatar('call-avatar', name, pin);
    UI.$('call-name').textContent = name;
    UI.$('call-timer').textContent = '';
    UI.$('call-timer').style.display = 'none';
    UI.$('call-status').textContent = status === 'calling' ? 'Calling...' : 'Connecting...';

    const localVid = UI.$('local-video');
    const remoteVid = UI.$('remote-video');
    if (type === 'video') {
      localVid.style.display = 'block';
      if (State.localStream) localVid.srcObject = State.localStream;
    } else {
      localVid.style.display = 'none';
      remoteVid.style.display = 'none';
    }

    UI.showOverlay('overlay-call');
  },

  startTimer() {
    let s = 0;
    UI.$('call-timer').style.display = '';
    UI.$('call-status').textContent = '';
    State.callTimer = setInterval(() => {
      s++;
      UI.$('call-timer').textContent = Utils.formatDuration(s);
    }, 1000);
  },

  toggleMute(btn) {
    State.isMuted = !State.isMuted;
    if (State.localStream) {
      State.localStream.getAudioTracks().forEach(t => t.enabled = !State.isMuted);
    }
    btn.classList.toggle('active', State.isMuted);
  },

  toggleSpeaker(btn) {
    State.isSpeaker = !State.isSpeaker;
    btn.classList.toggle('active', State.isSpeaker);
  },

  toggleCamera(btn) {
    State.isCameraOff = !State.isCameraOff;
    if (State.localStream) {
      State.localStream.getVideoTracks().forEach(t => t.enabled = !State.isCameraOff);
    }
    btn.classList.toggle('active', State.isCameraOff);
  },

  async flipCamera() {
    if (!State.localStream) return;
    const track = State.localStream.getVideoTracks()[0];
    if (!track) return;
    const settings = track.getSettings();
    const newFacing = settings.facingMode === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: newFacing }, audio: false });
      const newTrack = newStream.getVideoTracks()[0];
      const sender = State.peerConn?.getSenders().find(s => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(newTrack);
      track.stop();
      UI.$('local-video').srcObject = new MediaStream([newTrack, ...State.localStream.getAudioTracks()]);
    } catch {}
  },

  logCall(pin, type, direction, duration, missed) {
    if (!pin) return;
    State.callLog.push({ pin, type: type || 'audio', direction, duration, missed: !!missed, ts: Date.now(), seen: !missed });
    if (State.callLog.length > 200) State.callLog = State.callLog.slice(-200);
    Store.saveCallLog();
    Render.tabBadges();
    Render.dialpadRecents();
  },
};

/* ══════════════════════════════════════════════════
   GROUP CALLS
══════════════════════════════════════════════════ */
const GroupCall = {
  async start(roomId, roomName = 'Group Call') {
    if (State.groupCall) { UI.toast('Error', 'Already in a group call'); return; }

    State.groupCall = { roomId, roomName, members: {}, peerConns: {} };

    try {
      State.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch {
      State.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }).catch(() => null);
    }

    WS.send({ type: 'gc_join', room: roomId });
    UI.$('gc-title').textContent = roomName;
    UI.$('gc-room-id').textContent = `Room: ${roomId}`;
    Render.gcParticipants();
    UI.showOverlay('overlay-group-call');

    if (State.localStream) {
      const localVid = UI.$('gc-local-video');
      if (localVid) localVid.srcObject = State.localStream;
    }
  },

  handleJoin(msg) {
    if (!State.groupCall) return;
    const { pin, room } = msg;
    if (pin === State.sim.net_number) {
      // Server confirmed our join, msg may include existing members
      if (msg.members) {
        msg.members.forEach(p => { if (p !== State.sim.net_number) State.groupCall.members[p] = {}; });
      }
    } else {
      State.groupCall.members[pin] = {};
      UI.toast('Group Call', `${Utils.contactName(pin)} joined`);
    }
    Render.gcParticipants();
    if (State.localStream) {
      const lv = UI.$('gc-local-video');
      if (lv) lv.srcObject = State.localStream;
    }
    // Establish peer connection with new member
    this.connectToPeer(pin);
  },

  handleLeave(msg) {
    if (!State.groupCall) return;
    const { pin } = msg;
    delete State.groupCall.members[pin];
    if (State.groupCall.peerConns[pin]) {
      State.groupCall.peerConns[pin].close();
      delete State.groupCall.peerConns[pin];
    }
    UI.toast('Group Call', `${Utils.contactName(pin)} left`);
    Render.gcParticipants();
  },

  handleInvite(msg) {
    // Someone invited us to a group call
    const name = Utils.contactName(msg.from);
    UI.toast(`Group Call`, `${name} invited you — tap to join`);
    // Store room for joining
    State._pendingGcRoom = msg.room;
  },

  async connectToPeer(pin) {
    if (!State.groupCall || !State.localStream) return;
    const pc = new RTCPeerConnection(ICE_CONFIG);
    State.groupCall.peerConns[pin] = pc;

    State.localStream.getTracks().forEach(t => pc.addTrack(t, State.localStream));

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) WS.send({ type: 'ice_candidate', target: pin, candidate, room: State.groupCall.roomId });
    };

    pc.ontrack = (ev) => {
      const vid = UI.$(`gc-video-${pin}`);
      if (vid) vid.srcObject = ev.streams[0];
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    WS.send({ type: 'call_offer', target: pin, sdp: offer.sdp, call_type: 'video', room: State.groupCall.roomId });
  },

  end() {
    if (!State.groupCall) return;
    WS.send({ type: 'gc_leave', room: State.groupCall.roomId });
    Object.values(State.groupCall.peerConns).forEach(pc => pc.close());
    if (State.localStream) { State.localStream.getTracks().forEach(t => t.stop()); State.localStream = null; }
    State.groupCall = null;
    UI.hideOverlay('overlay-group-call');
  },

  inviteContacts(pins) {
    if (!State.groupCall) return;
    pins.forEach(pin => {
      WS.send({ type: 'gc_invite', target: pin, room: State.groupCall.roomId });
    });
  },

  shareLink() {
    const { roomId, roomName } = State.groupCall || {};
    if (!roomId) return;
    const link = `${location.origin}${location.pathname}?gc=${roomId}&name=${encodeURIComponent(roomName || 'Group Call')}`;
    if (navigator.share) {
      navigator.share({ title: `Join "${roomName}" on iNet`, url: link });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(link);
      UI.toast('Copied', 'Group call link copied');
    }
  },

  toggleMute(btn) {
    if (State.localStream) {
      const enabled = State.localStream.getAudioTracks()[0]?.enabled;
      State.localStream.getAudioTracks().forEach(t => t.enabled = !enabled);
      btn.classList.toggle('active', enabled);
    }
  },

  toggleCamera(btn) {
    if (State.localStream) {
      const enabled = State.localStream.getVideoTracks()[0]?.enabled;
      State.localStream.getVideoTracks().forEach(t => t.enabled = !enabled);
      btn.classList.toggle('active', enabled);
    }
  },
};

/* ══════════════════════════════════════════════════
   MEDIA RECORDING
══════════════════════════════════════════════════ */
const Recording = {
  async start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
      State.mediaRecorder = mr;
      State.recChunks = [];
      State.recSeconds = 0;

      mr.ondataavailable = e => { if (e.data.size) State.recChunks.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(State.recChunks, { type: mr.mimeType });
        if (State._recCancelled) { State._recCancelled = false; return; }
        // Check 10 min limit
        if (State.recSeconds > State.recLimit) {
          UI.toast('Too long', 'Voice notes are limited to 10 minutes');
          return;
        }
        Recording.sendVoiceNote(blob, State.recSeconds);
      };

      mr.start(100);

      // Timer
      UI.$('recording-bar').classList.add('show');
      UI.$('voice-btn').classList.add('recording');
      State.recTimer = setInterval(() => {
        State.recSeconds++;
        UI.$('rec-timer').textContent = Utils.formatDuration(State.recSeconds);
        if (State.recSeconds >= State.recLimit) Recording.stop();
      }, 1000);
    } catch {
      UI.toast('Error', 'Microphone access denied');
    }
  },

  stop() {
    clearInterval(State.recTimer);
    if (State.mediaRecorder?.state !== 'inactive') State.mediaRecorder?.stop();
    UI.$('recording-bar').classList.remove('show');
    UI.$('voice-btn').classList.remove('recording');
  },

  cancel() {
    State._recCancelled = true;
    this.stop();
  },

  async sendVoiceNote(blob, seconds) {
    const b64 = await Utils.blobToB64(blob);
    Chat.send(Utils.formatDuration(seconds), 'voice', b64, '');
  },
};

/* ══════════════════════════════════════════════════
   STICKERS
══════════════════════════════════════════════════ */
const Stickers = {
  currentPack: '😊',

  render() {
    const grid = UI.$('sticker-grid');
    if (!grid) return;
    grid.innerHTML = '';
    STICKER_PACKS[this.currentPack].forEach(s => {
      const el = document.createElement('div');
      el.className = 'sticker-item';
      el.textContent = s;
      el.onclick = () => {
        Chat.send(s, 'sticker');
        App.hideStickers();
      };
      grid.appendChild(el);
    });

    // Tabs
    const tabs = UI.$('sticker-tabs');
    tabs.innerHTML = '';
    Object.keys(STICKER_PACKS).forEach(pack => {
      const tab = document.createElement('div');
      tab.className = `sticker-tab${pack === this.currentPack ? ' active' : ''}`;
      tab.textContent = pack;
      tab.onclick = () => { this.currentPack = pack; this.render(); };
      tabs.appendChild(tab);
    });
  },
};

/* ══════════════════════════════════════════════════
   APP CONTROLLER
══════════════════════════════════════════════════ */
const App = {
  /* ── SIM FLOW ──────────────────────────────── */
  showSim(panel) {
    ['sim-welcome', 'sim-create', 'sim-unlock', 'sim-created'].forEach(id => {
      UI.$(id).style.display = 'none';
    });
    UI.$(panel === 'create' ? 'sim-create' : panel === 'unlock' ? 'sim-unlock' : panel === 'created' ? 'sim-created' : 'sim-welcome').style.display = 'flex';
  },

  triggerSimImport() {
    UI.$('sim-file-input').click();
  },

  async handleSimImport(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    State._pendingSimData = await SIM.importFile(file);
    UI.$('sim-file-name').textContent = file.name;
    this.showSim('unlock');
  },

  async createSim() {
    const pass = UI.$('sim-pass').value;
    const confirm = UI.$('sim-pass-confirm').value;

    if (pass.length < 6) { UI.toast('Too short', 'Password must be at least 6 characters'); return; }
    if (pass !== confirm) { UI.toast('Mismatch', 'Passwords do not match'); return; }

    UI.setLoading('create-sim-btn', true, 'Creating...');
    try {
      const { net_number } = await SIM.create(pass);
      await SIM.save();

      // Cache session so no password on next open this session
      sessionStorage.setItem('inet_sim', JSON.stringify(State.sim));
      sessionStorage.setItem('inet_device', State.deviceId);
      sessionStorage.setItem('inet_vapid_s', State.vapidKey || '');
      sessionStorage.setItem('inet_pass', pass);

      UI.$('created-net-num').textContent = net_number;
      UI.$('sim-card-preview-num').textContent = net_number.replace(/(\d{2})(?=\d)/g, '$1 ');
      this.showSim('created');
    } catch (e) {
      UI.toast('Error', e.message || 'Could not create SIM');
    } finally {
      UI.setLoading('create-sim-btn', false);
      UI.$('create-sim-btn').innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M8 5v14M16 5v14"/></svg> Create SIM`;
    }
  },

  async unlockSim() {
    const pass = UI.$('sim-unlock-pass').value;
    if (!pass) { UI.toast('Required', 'Enter your SIM password'); return; }

    UI.setLoading('unlock-btn', true, 'Unlocking...');
    try {
      const simData = await SIM.decryptFile(State._pendingSimData, pass);
      if (!simData?.net_number) throw new Error('Invalid SIM file');

      await SIM.activate(simData, pass);
      await SIM.save();

      // Cache in session so password not needed until browser restart
      sessionStorage.setItem('inet_sim', JSON.stringify(State.sim));
      sessionStorage.setItem('inet_device', State.deviceId);
      sessionStorage.setItem('inet_vapid_s', State.vapidKey || '');
      sessionStorage.setItem('inet_pass', pass);

      this.enterApp();
    } catch (e) {
      UI.toast('Wrong password', 'Could not unlock SIM');
    } finally {
      UI.setLoading('unlock-btn', false);
      UI.$('unlock-btn').innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Unlock & Connect`;
    }
  },

  downloadSim() { SIM.exportFile(); },

  async changeSimPassword() {
    const newPass = prompt('Enter new SIM password (min 6 chars):');
    if (!newPass || newPass.length < 6) { UI.toast('Too short', 'Minimum 6 characters'); return; }
    const confirm = prompt('Confirm new password:');
    if (newPass !== confirm) { UI.toast('Mismatch', 'Passwords do not match'); return; }
    State.simPassword = newPass;
    await SIM.save();
    UI.toast('Done', 'SIM password updated. Download updated SIM file.');
    this.downloadSim();
  },

  ejectSim() {
    if (!confirm('Eject SIM? This device will be signed out. Make sure you have downloaded your SIM file.')) return;
    SIM.eject();
    location.reload();
  },

  togglePass(inputId, btn) {
    const input = UI.$(inputId);
    const isPass = input.type === 'password';
    input.type = isPass ? 'text' : 'password';
    btn.innerHTML = isPass
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  },

  /* ── ENTER APP ─────────────────────────────── */
  enterApp() {
    // Load stored data
    State.chats = Store.getChats();
    State.callLog = Store.getCallLog();

    // Show app
    UI.$('screen-sim').classList.add('hidden');
    UI.$('app').classList.remove('hidden');

    // Populate UI
    Render.chatList();
    Render.contactList();
    Render.callLog();
    Render.dialpadRecents();
    Render.tabBadges();
    this.populateSettings();

    // Connect WS
    WS.connect();

    // Fetch status for known contacts
    const pins = State.sim?.contacts.map(c => c.pin) || [];
    if (pins.length) Status.fetchBatch(pins);

    Render.roomsList();

    // Group call from URL param
    const gc = new URLSearchParams(location.search).get('gc');
    const gcName = new URLSearchParams(location.search).get('name') || 'Group Call';
    if (gc) GroupCall.start(gc, gcName);
  },

  populateSettings() {
    if (!State.sim) return;
    UI.$('settings-net-num').textContent = State.sim.net_number;
    UI.$('settings-created').textContent = `Member since ${Utils.formatDate(State.sim.created_at)}`;
  },

  /* ── TAB NAVIGATION ────────────────────────── */
  switchTab(tab, el) {
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    el.classList.add('active');

    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const view = UI.$(`view-${tab}`);
    if (view) view.classList.remove('hidden');

    State.activeTab = tab;

    if (tab === 'calllog') {
      State.callLog.forEach(l => { l.seen = true; });
      Store.saveCallLog();
      Render.callLog();
      Render.tabBadges();
    }
    if (tab === 'rooms') Render.roomsList();
    if (tab === 'dialpad') Render.dialpadRecents();
  },

  /* ── CHAT ──────────────────────────────────── */
  openChat(pin) {
    // Hide all views from tab area
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    const chatView = UI.$('view-chat');
    chatView.classList.remove('hidden');

    Chat.open(pin);
    this.hideNewChat();
    this.closeMediaSheet();
  },

  closeChat() {
    State.activeChatPin = null;
    UI.$('view-chat').classList.add('hidden');
    const active = UI.$(`view-${State.activeTab}`);
    if (active) active.classList.remove('hidden');
    Render.chatList();
  },

  searchChats(q) { Render.chatList(q); },
  searchContacts(q) { Render.contactList(q); },

  onMsgInput(el) {
    // Auto resize
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    const hasText = el.value.trim().length > 0;
    UI.$('send-btn').style.display = hasText ? 'flex' : 'none';
    UI.$('voice-btn').style.display = hasText ? 'none' : 'flex';
  },

  onMsgKeydown(ev) {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      this.sendMessage();
    }
  },

  sendMessage() {
    const input = UI.$('msg-input');
    const text = input.value.trim();
    if (!text) return;
    Chat.send(text, 'text');
    input.value = '';
    input.style.height = 'auto';
    UI.$('send-btn').style.display = 'none';
    UI.$('voice-btn').style.display = 'flex';
    this.closeMediaSheet();
  },

  /* ── MEDIA SHEET ───────────────────────────── */
  toggleMediaSheet() {
    const sheet = UI.$('media-sheet');
    sheet.classList.toggle('open');
  },

  closeMediaSheet() {
    UI.$('media-sheet').classList.remove('open');
  },

  toggleStickers() {
    const picker = UI.$('sticker-picker');
    const isOpen = picker.classList.contains('show');
    if (!isOpen) Stickers.render();
    picker.classList.toggle('show', !isOpen);
    this.closeMediaSheet();
  },

  hideStickers() { UI.$('sticker-picker').classList.remove('show'); },

  pickMedia(type) {
    this.closeMediaSheet();
    if (type === 'image') UI.$('img-input').click();
    else if (type === 'video') UI.$('video-input').click();
    else if (type === 'audio') UI.$('audio-input').click();
    else if (type === 'file') UI.$('file-input').click();
  },

  async handleImagePick(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    const compressed = await Utils.compressImage(file);
    const b64 = await Utils.blobToB64(compressed);
    State.pendingMedia = { type: 'image', data: b64, mimeType: 'image/jpeg' };
    this.showMediaPreview('image', b64);
    ev.target.value = '';
  },

  async handleVideoPick(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { UI.toast('Too large', 'Videos must be under 10MB'); ev.target.value = ''; return; }
    // Check duration
    const url = URL.createObjectURL(file);
    const vid = document.createElement('video');
    vid.src = url;
    vid.onloadedmetadata = async () => {
      URL.revokeObjectURL(url);
      if (vid.duration > 90) { UI.toast('Too long', 'Videos must be 90 seconds or less'); return; }
      const b64 = await Utils.blobToB64(file);
      State.pendingMedia = { type: 'video', data: b64, mimeType: file.type };
      this.showMediaPreview('video', b64);
    };
    ev.target.value = '';
  },

  async handleAudioPick(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    const b64 = await Utils.blobToB64(file);
    Chat.send(file.name, 'voice', b64);
    ev.target.value = '';
  },

  async handleFilePick(ev) {
    const file = ev.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { UI.toast('Too large', 'Files must be under 10MB'); return; }
    const b64 = await Utils.blobToB64(file);
    Chat.send(file.name, 'file', b64);
    ev.target.value = '';
  },

  showMediaPreview(type, src) {
    const content = UI.$('preview-content');
    content.innerHTML = '';
    if (type === 'image') {
      const img = document.createElement('img');
      img.src = src;
      content.appendChild(img);
    } else if (type === 'video') {
      const vid = document.createElement('video');
      vid.src = src;
      vid.controls = true;
      content.appendChild(vid);
    }
    UI.$('preview-title').textContent = type === 'image' ? 'Send Photo' : 'Send Video';
    UI.$('preview-caption').value = '';
    UI.showOverlay('overlay-media-preview');
  },

  sendMediaFromPreview() {
    if (!State.pendingMedia) return;
    const caption = UI.$('preview-caption').value.trim();
    const { type, data } = State.pendingMedia;
    Chat.send(caption, type, data, caption);
    State.pendingMedia = null;
    this.closeMediaPreview();
  },

  closeMediaPreview() {
    UI.hideOverlay('overlay-media-preview');
    State.pendingMedia = null;
  },

  previewMedia(type, src) {
    State.pendingMedia = null;
    const content = UI.$('preview-content');
    content.innerHTML = '';
    if (type === 'image') {
      const img = document.createElement('img');
      img.src = src;
      content.appendChild(img);
    } else if (type === 'video') {
      const vid = document.createElement('video');
      vid.src = src;
      vid.controls = true;
      content.appendChild(vid);
    }
    UI.$('preview-title').textContent = type === 'image' ? 'Photo' : 'Video';
    UI.$('preview-send-bar').style.display = 'none';
    UI.showOverlay('overlay-media-preview');
  },

  playVoiceNote(btn, src) {
    const audio = new Audio(src);
    const svgPlay = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    const svgPause = `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    btn.innerHTML = svgPause;
    audio.play();
    audio.onended = () => { btn.innerHTML = svgPlay; };
    audio.onpause = () => { btn.innerHTML = svgPlay; };
    btn.onclick = () => {
      if (audio.paused) { audio.play(); btn.innerHTML = svgPause; }
      else { audio.pause(); btn.innerHTML = svgPlay; }
    };
  },

  /* ── CALLS ─────────────────────────────────── */
  startCall(type) {
    if (!State.activeChatPin) return;
    Call.start(State.activeChatPin, type);
  },

  startCallFromDetail(type) {
    const el = UI.$('detail-pin');
    Call.start(el.textContent, type);
  },

  callContact(pin, type) {
    Call.start(pin, type);
  },

  callFromLog(pin, type) {
    Call.start(pin, type);
  },

  acceptCall() { Call.acceptCall(); },
  declineCall() { Call.declineCall(); },
  endCall() { Call.endCall(); },
  toggleMute(btn) { Call.toggleMute(btn); },
  toggleSpeaker(btn) { Call.toggleSpeaker(btn); },
  toggleCamera(btn) { Call.toggleCamera(btn); },
  flipCamera() { Call.flipCamera(); },

  /* ── GROUP CALLS ───────────────────────────── */
  /* ── ROOMS ─────────────────────────────────────── */
  showCreateRoom() {
    UI.$('room-create-panel').classList.add('show');
    UI.$('room-name-input').value = '';
    UI.$('room-time-input').value = '';
    UI.$('room-name-input').focus();
  },

  hideCreateRoom() {
    UI.$('room-create-panel').classList.remove('show');
  },

  createRoom() {
    const name = UI.$('room-name-input').value.trim() || 'Group Call';
    const time = UI.$('room-time-input').value;
    const roomId = Math.random().toString(36).slice(2, 9).toUpperCase();
    const room = {
      id: roomId,
      name,
      scheduledTime: time || null,
      createdAt: Date.now(),
      createdBy: State.sim.net_number,
    };
    const rooms = Store.get('inet_rooms', []);
    rooms.unshift(room);
    Store.set('inet_rooms', rooms.slice(0, 20)); // keep 20 max
    this.hideCreateRoom();
    Render.roomsList();
    UI.toast('Room created', `"${name}" is ready`);
  },

  joinRoom(roomId, roomName) {
    GroupCall.start(roomId, roomName);
  },

  shareRoom(roomId, roomName) {
    const link = `${location.origin}${location.pathname}?gc=${roomId}`;
    if (navigator.share) {
      navigator.share({ title: `Join "${roomName}" on iNet`, url: link });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(link);
      UI.toast('Link copied', `Share it to invite people`);
    }
  },

  deleteRoom(roomId) {
    const rooms = Store.get('inet_rooms', []).filter(r => r.id !== roomId);
    Store.set('inet_rooms', rooms);
    Render.roomsList();
  },

  showGroupCallSetup() {
    App.switchTab('rooms', document.querySelector('[data-tab="rooms"]'));
    setTimeout(() => App.showCreateRoom(), 100);
  },

  inviteToGroupCall() {
    Render.gcInviteList();
    UI.$('gc-invite-modal').classList.add('show');
  },

  hideGcInvite() { UI.$('gc-invite-modal').classList.remove('show'); },

  sendGcInvites() {
    const checked = document.querySelectorAll('#gc-invite-list .invite-check.checked');
    const pins = Array.from(checked).map(el => el.dataset.pin);
    GroupCall.inviteContacts(pins);
    this.hideGcInvite();
    UI.toast('Invites sent', `Invited ${pins.length} contact(s)`);
  },

  shareGroupCallLink() { GroupCall.shareLink(); },
  endGroupCall() { GroupCall.end(); },
  gcToggleMute(btn) { GroupCall.toggleMute(btn); },
  gcToggleCamera(btn) { GroupCall.toggleCamera(btn); },

  /* ── DIALPAD ───────────────────────────────── */
  dialPress(key) {
    const display = UI.$('dial-display');
    const current = display.dataset.value || '';
    if (current.length >= 6) return;
    const next = current + key;
    display.dataset.value = next;
    display.textContent = next;
    display.classList.remove('empty');
    UI.$('dial-del').classList.add('show');
  },

  dialDelete() {
    const display = UI.$('dial-display');
    const current = display.dataset.value || '';
    const next = current.slice(0, -1);
    display.dataset.value = next;
    if (next) {
      display.textContent = next;
      display.classList.remove('empty');
    } else {
      display.textContent = 'Enter net number';
      display.classList.add('empty');
      UI.$('dial-del').classList.remove('show');
    }
  },

  dialCall(type) {
    const pin = UI.$('dial-display').dataset.value;
    if (!Utils.isValidPin(pin)) { UI.toast('Invalid', 'Enter a 6-digit net number'); return; }
    Call.start(pin, type);
    // Reset dialpad
    UI.$('dial-display').dataset.value = '';
    UI.$('dial-display').textContent = 'Enter net number';
    UI.$('dial-display').classList.add('empty');
    UI.$('dial-del').classList.remove('show');
  },

  dialFromRecent(pin) {
    const display = UI.$('dial-display');
    display.dataset.value = pin;
    display.textContent = pin;
    display.classList.remove('empty');
    UI.$('dial-del').classList.add('show');
  },

  /* ── CONTACTS ──────────────────────────────── */
  showAddContact() {
    UI.$('add-contact-name').value = '';
    UI.$('add-contact-pin').value = '';
    UI.$('add-contact-sheet').classList.add('show');
  },

  hideAddContact() { UI.$('add-contact-sheet').classList.remove('show'); },

  saveContact() {
    const name = UI.$('add-contact-name').value.trim();
    const pin = UI.$('add-contact-pin').value.trim();
    if (!name) { UI.toast('Required', 'Enter a contact name'); return; }
    if (!Utils.isValidPin(pin)) { UI.toast('Invalid', '6-digit net number required'); return; }
    SIM.addContact(name, pin);
    this.hideAddContact();
    Render.contactList();
    UI.toast('Saved', `${name} added to SIM`);
  },

  openContactDetail(pin) {
    const contact = State.sim?.contacts.find(c => c.pin === pin);
    if (!contact) return;

    UI.setAvatar('detail-avatar', contact.name, pin);
    UI.$('detail-name').textContent = contact.name;
    UI.$('detail-pin').textContent = pin;
    UI.$('detail-pin-val').textContent = pin;

    const online = Status.isOnline(pin);
    const lastSeen = State.onlineStatus[pin]?.last_seen;
    UI.$('detail-status-val').textContent = online ? 'Online now' : lastSeen ? `Last seen ${Utils.formatTime(lastSeen)}` : 'Offline';

    State.editingContactPin = pin;
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    UI.$('view-contact-detail').classList.remove('hidden');
  },

  closeContactDetail() {
    UI.$('view-contact-detail').classList.add('hidden');
    const active = UI.$(`view-${State.activeTab}`);
    if (active) active.classList.remove('hidden');
    State.editingContactPin = null;
  },

  openContact() {
    if (State.activeChatPin) this.openContactDetail(State.activeChatPin);
  },

  editContact() {
    const pin = State.editingContactPin;
    if (!pin) return;
    const c = State.sim?.contacts.find(c => c.pin === pin);
    if (!c) return;
    UI.$('edit-contact-name').value = c.name;
    UI.$('edit-contact-pin').value = c.pin;
    UI.$('edit-modal').classList.add('show');
  },

  hideEditModal() { UI.$('edit-modal').classList.remove('show'); },

  saveEditContact() {
    const name = UI.$('edit-contact-name').value.trim();
    const pin = UI.$('edit-contact-pin').value.trim();
    if (!name) { UI.toast('Required', 'Name cannot be empty'); return; }
    if (!Utils.isValidPin(pin)) { UI.toast('Invalid', '6-digit net number required'); return; }
    SIM.updateContact(State.editingContactPin, name, pin);
    this.hideEditModal();
    this.openContactDetail(pin);
    Render.contactList();
    UI.toast('Updated', 'Contact saved to SIM');
  },

  deleteContact() {
    const pin = State.editingContactPin;
    if (!pin) return;
    const name = Utils.contactName(pin);
    if (!confirm(`Remove ${name} from contacts?`)) return;
    SIM.deleteContact(pin);
    this.closeContactDetail();
    Render.contactList();
    UI.toast('Removed', `${name} deleted from SIM`);
  },

  messageFromDetail() {
    const pin = State.editingContactPin;
    if (!pin) return;
    this.closeContactDetail();
    this.openChat(pin);
  },

  /* ── NEW CHAT ──────────────────────────────── */
  showNewChat() {
    Render.newChatContacts();
    UI.$('new-chat-pin').value = '';
    UI.$('new-chat-sheet').classList.add('show');
  },

  hideNewChat() { UI.$('new-chat-sheet').classList.remove('show'); },

  startNewChat() {
    const pin = UI.$('new-chat-pin').value.trim();
    if (!Utils.isValidPin(pin)) { UI.toast('Invalid', '6-digit net number required'); return; }
    if (pin === State.sim?.net_number) { UI.toast('Error', 'Cannot chat with yourself'); return; }
    this.openChat(pin);
  },

  /* ── CALL LOG ──────────────────────────────── */
  filterCallLog(filter, el) {
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    Render.callLog(filter);
  },

  clearCallLog() {
    if (!confirm('Clear all call history?')) return;
    State.callLog = [];
    Store.saveCallLog();
    Render.callLog();
    Render.dialpadRecents();
    Render.tabBadges();
  },

  toggleChatMenu() {
    // Simple options alert for now
    const options = ['Clear Chat', 'Contact Info'];
    const choice = options.findIndex((_, i) => confirm(options[i] + '?'));
    if (choice === 0 && State.activeChatPin) {
      State.chats[State.activeChatPin] = { messages: [], unread: 0 };
      Store.saveChats();
      Chat.open(State.activeChatPin);
    }
  },

  /* ── SETTINGS ──────────────────────────────── */
  async togglePush(toggle) {
    const isOn = toggle.classList.contains('on');
    if (!isOn) {
      const ok = await Push.subscribe();
      if (ok) {
        toggle.classList.add('on');
        UI.$('push-status-text').textContent = 'Enabled';
        UI.toast('Notifications', 'Push notifications enabled');
      } else {
        UI.toast('Failed', 'Could not enable push notifications');
      }
    } else {
      toggle.classList.remove('on');
      UI.$('push-status-text').textContent = 'Not enabled';
    }
  },

  toggleDark(toggle) {
    const isOn = toggle.classList.contains('on');
    toggle.classList.toggle('on', !isOn);
    const dark = !isOn;
    document.documentElement.style.setProperty('--bg',        dark ? '#000000' : '#F7F2F4');
    document.documentElement.style.setProperty('--surface',   dark ? '#0E0E0E' : '#FFFFFF');
    document.documentElement.style.setProperty('--border',    dark ? '#1E1E1E' : '#EDE0E4');
    document.documentElement.style.setProperty('--text',      dark ? '#F0F0F0' : '#180910');
    document.documentElement.style.setProperty('--text-2',    dark ? '#909090' : '#7A5865');
    document.documentElement.style.setProperty('--text-3',    dark ? '#505050' : '#B99AAA');
    document.documentElement.style.setProperty('--wine-mist', dark ? '#0A0005' : '#FAF3F5');
    Store.set('inet_dark', dark);
  },
};

/* ══════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════ */
async function init() {
  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(e => console.warn('SW:', e));
  }

  // Apply dark mode preference
  const dark = Store.get('inet_dark', false);
  if (dark) {
    App.toggleDark(UI.$('dark-toggle'));
    UI.$('dark-toggle').classList.add('on');
  }

  // ── SESSION CHECK ──────────────────────────────────────
  // If SIM was already unlocked this browser session, skip password
  const sessionSim = sessionStorage.getItem('inet_sim');
  const sessionDevice = sessionStorage.getItem('inet_device');
  const sessionVapid = sessionStorage.getItem('inet_vapid_s');

  if (sessionSim && sessionDevice) {
    try {
      State.sim = JSON.parse(sessionSim);
      State.deviceId = sessionDevice;
      State.vapidKey = sessionVapid || Store.get('inet_vapid');
      State.simPassword = sessionStorage.getItem('inet_pass') || null;
      App.enterApp();
      return;
    } catch { sessionStorage.clear(); }
  }

  // ── ENCRYPTED SIM ON DEVICE ────────────────────────────
  // Has SIM file saved locally → need password once per browser session
  const encSim = Store.get('inet_enc_sim');
  if (encSim) {
    State._pendingSimData = encSim;
    State.vapidKey = Store.get('inet_vapid');
    App.showSim('unlock');
    UI.$('sim-file-name').textContent = 'Your SIM card';
    return;
  }

  // ── NO SIM ─────────────────────────────────────────────
  App.showSim('welcome');
}

// Handle service worker messages (push notifications)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (ev) => {
    const { type, data } = ev.data || {};
    if (type === 'push' && data) {
      WS.handle(data);
    }
  });
}

// Handle visibility change (reconnect WS when tab regains focus)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && State.sim && State.ws?.readyState > 1) {
    WS.connect();
  }
});

// Close sheets on outside tap
document.addEventListener('click', (ev) => {
  if (typeof App !== 'undefined' && App.closeMediaSheet && ev.target === UI.$('media-sheet')?.parentElement) {
    App.closeMediaSheet();
  }
});

window.App = App;
document.addEventListener('DOMContentLoaded', init);
