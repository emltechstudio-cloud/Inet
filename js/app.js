const App = {
  async init() {
    const profile = Auth.getProfile();
    if (!profile) return;

    // Connect WebSocket
    API.connect(profile.pin, profile.deviceId);

    // Setup WS listeners
    API.on('connected', () => {
      UI.toast('Connected to iNet');
      this.updateOnlineStatus();
    });
    API.on('disconnected', () => UI.toast('Disconnected'));
    API.on('chat', (msg) => Chat.receiveMessage(msg));
    API.on('offline_messages', (msgs) => {
      msgs.forEach(m => Chat.receiveMessage({ type: 'chat', from: m.from || 'unknown', payload: m }));
    });
    API.on('status_change', (payload) => {
      if (Chat.currentPin === payload.net_number) {
        document.getElementById('chat-status').textContent = payload.online ? 'online' : 'last seen ' + Utils.formatTime(payload.last_seen);
      }
    });
    API.on('call_signal', (msg) => {
      if (msg.type === 'call_offer') Calls.receiveCallOffer(msg);
      else if (msg.type === 'call_answer') Calls.handleCallAnswer(msg);
      else if (msg.type === 'call_end') Calls.handleCallEnd(msg);
      else if (msg.type === 'call_busy') Calls.handleCallBusy(msg);
      else if (msg.type === 'ice_candidate') Calls.handleIceCandidate(msg);
      else if (msg.type === 'call_reaction') Calls.showReactionBubble(msg.payload.reaction);
    });
    API.on('group_call', (msg) => Calls.handleGroupSignal(msg));

    // Init modules
    await Contacts.init();
    await Groups.init();
    await Chat.init();
    await Calls.init();
    UI.init();

    // Load settings
    const darkMode = await Storage.getSetting('darkMode', true);
    if (!darkMode) document.body.classList.add('light-mode');

    // Update settings UI
    document.getElementById('settings-my-pin').textContent = profile.pin;

    // Check for link call in URL
    const joined = await LinkCalls.joinFromUrl();
    if (!joined) {
      UI.showScreen('chats');
      UI.showNav(true);
    }

    // Request push notification permission
    this.setupPush();
  },

  async updateOnlineStatus() {
    const pins = Contacts.list.map(c => c.pin);
    if (!pins.length) return;
    try {
      const statuses = await API.batchStatus(pins);
      // Update UI with statuses
    } catch (e) {
      console.error('Status update failed:', e);
    }
  },

  async setupPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const keyData = await API.getVapidKey();
        const key = keyData.vapid_public_key;
        if (key) {
          const newSub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: this.urlBase64ToUint8Array(key)
          });
          const profile = Auth.getProfile();
          await API.subscribePush(profile.pin, profile.deviceId, newSub.toJSON());
        }
      }
    } catch (e) {
      console.error('Push setup failed:', e);
    }
  },

  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
  }
};

// ============================================================
// Settings module
// ============================================================
const Settings = {
  async toggleDarkMode() {
    const isDark = !document.body.classList.contains('light-mode');
    document.body.classList.toggle('light-mode', isDark);
    await Storage.setSetting('darkMode', !isDark);
    document.getElementById('dark-mode-toggle').classList.toggle('active', !isDark);
  },

  showProfile() {
    const profile = Auth.getProfile();
    UI.showModal('My Profile', `
      <div style="text-align:center;padding:16px;">
        <div class="list-item-avatar" style="width:80px;height:80px;font-size:32px;margin:0 auto 12px;">${profile.pin.slice(0,2)}</div>
        <div style="font-size:22px;font-weight:600;margin-bottom:4px;">iNet ${profile.pin}</div>
        <div style="font-size:13px;color:var(--text-muted);">Device: ${profile.deviceId.slice(0,8)}...</div>
      </div>
    `, [{ label: 'Close', class: 'primary', action: () => UI.hideModal() }]);
  },

  downloadSIM() {
    Auth.downloadSIM();
    UI.toast('SIM file downloaded');
  },

  async logout() {
    if (!confirm('Logout and clear all data?')) return;
    API.disconnect();
    await Storage.clearProfile();
    await Storage.clear('messages');
    await Storage.clear('contacts');
    await Storage.clear('groups');
    await Storage.clear('call_log');
    location.reload();
  }
};

// ============================================================
// Dialpad module
// ============================================================
const Dialpad = {
  display: '',

  press(key) {
    if (this.display.length >= 12) return;
    this.display += key;
    this.updateDisplay();
  },

  backspace() {
    this.display = this.display.slice(0, -1);
    this.updateDisplay();
  },

  updateDisplay() {
    document.getElementById('dial-display').textContent = this.display;
  },

  audioCall() {
    if (this.display.length !== 6) { UI.toast('Enter a valid 6-digit PIN'); return; }
    Chat.currentPin = this.display;
    Calls.startCall(false);
    this.display = '';
    this.updateDisplay();
  },

  videoCall() {
    if (this.display.length !== 6) { UI.toast('Enter a valid 6-digit PIN'); return; }
    Chat.currentPin = this.display;
    Calls.startCall(true);
    this.display = '';
    this.updateDisplay();
  }
};

// ============================================================
// Start app on load
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  Auth.init();
});
