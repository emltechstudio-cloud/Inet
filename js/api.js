const API = {
  BASE_URL: 'https://emltechstudio-inet-v2.hf.space',
  WS_URL: 'wss://emltechstudio-inet-v2.hf.space/ws',
  ws: null,
  reconnectTimer: null,
  pingInterval: null,
  listeners: {},
  isConnected: false,

  // REST API helpers
  async request(endpoint, options = {}) {
    const url = `${this.BASE_URL}${endpoint}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || `HTTP ${res.status}`);
    }
    return res.json();
  },

  // SIM endpoints
  simNew() { return this.request('/sim/new', { method: 'POST' }); },
  simActivate(pin, deviceId) { return this.request('/sim/activate', { method: 'POST', body: JSON.stringify({ net_number: pin, device_id: deviceId }) }); },
  simWhoami(pin, deviceId) { return this.request(`/sim/whoami?net_number=${pin}&device_id=${deviceId}`); },
  simLookup(fingerprint) { return this.request('/sim/lookup', { method: 'POST', body: JSON.stringify({ fingerprint }) }); },
  registerFingerprint(pin, deviceId, fingerprint) { return this.request('/sim/register-fingerprint', { method: 'POST', body: JSON.stringify({ net_number: pin, device_id: deviceId, fingerprint }) }); },

  // Device endpoints
  deviceRegister(pin, deviceId, fingerprint) { return this.request('/device/register', { method: 'POST', body: JSON.stringify({ net_number: pin, device_id: deviceId, fingerprint }) }); },
  deviceLookup(fingerprint) { return this.request('/device/lookup', { method: 'POST', body: JSON.stringify({ fingerprint }) }); },

  // Status endpoints
  getStatus(pin) { return this.request(`/status/${pin}`); },
  batchStatus(pins) { return this.request('/status/batch', { method: 'POST', body: JSON.stringify(pins) }); },

  // Push endpoints
  subscribePush(pin, deviceId, subscription) { return this.request('/push/subscribe', { method: 'POST', body: JSON.stringify({ net_number: pin, device_id: deviceId, subscription }) }); },
  getVapidKey() { return this.request('/push/vapid-public-key'); },

  // WebSocket
  connect(pin, deviceId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    const url = `${this.WS_URL}?net_number=${pin}&device_id=${deviceId}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.isConnected = true;
      clearTimeout(this.reconnectTimer);
      this.startPing();
      this.emit('connected');
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this.handleMessage(msg);
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.stopPing();
      this.emit('disconnected');
      this.reconnectTimer = setTimeout(() => this.connect(pin, deviceId), 3000);
    };

    this.ws.onerror = (err) => {
      console.error('WS error:', err);
      this.emit('error', err);
    };
  },

  disconnect() {
    clearTimeout(this.reconnectTimer);
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  },

  startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  },

  stopPing() {
    clearInterval(this.pingInterval);
  },

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  },

  // Message routing
  handleMessage(msg) {
    const type = msg.type;
    if (type === 'pong') return;
    if (type === 'chat') {
      this.emit('chat', msg);
      return;
    }
    if (type === 'offline_messages') {
      this.emit('offline_messages', msg.messages);
      return;
    }
    if (type === 'status_change') {
      this.emit('status_change', msg.payload);
      return;
    }
    if (['call_offer', 'call_answer', 'call_end', 'call_busy', 'ice_candidate'].includes(type)) {
      this.emit('call_signal', msg);
      return;
    }
    if (['gc_join', 'gc_leave', 'gc_invite', 'gc_members'].includes(type)) {
      this.emit('group_call', msg);
      return;
    }
    if (type === 'otp') {
      this.emit('otp', msg.payload);
      return;
    }
    this.emit(type, msg);
  },

  // Event system
  on(event, handler) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  },

  off(event, handler) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(h => h !== handler);
  },

  emit(event, data) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach(h => {
      try { h(data); } catch (e) { console.error(e); }
    });
  }
};
