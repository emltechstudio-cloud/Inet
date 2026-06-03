/* app.js — Main app controller. Under 300 lines. */
import { State, Config } from './core/state.js';
import { Store } from './core/storage.js';
import { Crypto } from './core/crypto.js';
import * as WS from './core/ws.js';
import * as Auth from './features/auth.js';
import * as Chat from './features/chat.js';
import * as Calls from './features/calls.js';
import * as Media from './features/media.js';
import { toast, isValidPin, formatDate, contactName } from './ui/components.js';
import { renderChats, renderContacts, renderCalls, renderMessages, renderNewChatContacts, updateBadges } from './ui/render.js';

// ── DOM refs ──
const $ = id => document.getElementById(id);

// ── Auth Panel Switcher ──
function showAuth(panel) {
  document.querySelectorAll('.auth-panel').forEach(el => el.classList.remove('active'));
  const map = {
    welcome: 'auth-welcome', register: 'auth-register', continue: 'auth-continue',
    password: 'auth-password', created: 'auth-created', accounts: 'auth-accounts',
    loginNum: 'auth-login-num', activate: 'auth-activate', unlock: 'auth-unlock'
  };
  const target = $(map[panel] || 'auth-welcome');
  if (target) target.classList.add('active');
}

// ── Auth Flow ──
async function tryAutoContinue() {
  try {
    const data = await Auth.continueDevice();
    if (data.found && data.accounts.length > 0) {
      if (data.accounts.length === 1 && !data.accounts[0].has_password) {
        const acc = data.accounts[0];
        State.sim = { net_number: acc.net_number, created_at: acc.created_at, contacts: [] };
        State.simPassword = null;
        enterApp();
      } else {
        showAccountPicker(data.accounts);
      }
    } else {
      showAuth('welcome');
    }
  } catch (e) {
    showAuth('welcome');
  }
}

function showAccountPicker(accounts) {
  showAuth('accounts');
  const list = $('accounts-list');
  list.innerHTML = '';
  accounts.forEach(acc => {
    const el = document.createElement('div');
    el.className = 'account-item';
    el.innerHTML = `
      <div class="avatar" style="background:hsl(${parseInt(acc.net_number)*60},60%,40%)">${acc.net_number}</div>
      <div class="info"><div class="name">${acc.net_number}</div><div class="meta">${acc.has_password ? '🔒 Password protected' : 'Tap to enter'}</div></div>
    `;
    el.addEventListener('click', () => selectAccount(acc));
    list.appendChild(el);
  });
}

async function selectAccount(acc) {
  if (acc.has_password) {
    $('pw-account-num').textContent = acc.net_number;
    showAuth('password');
  } else {
    State.sim = { net_number: acc.net_number, created_at: acc.created_at, contacts: [] };
    State.simPassword = null;
    enterApp();
  }
}

async function doRegister() {
  const pass = $('reg-pass').value;
  const confirm = $('reg-pass-confirm').value;
  if (pass && pass.length < 4) { toast('Too short', 'Min 4 chars'); return; }
  if (pass && pass !== confirm) { toast('Mismatch', 'Passwords do not match'); return; }
  try {
    const { net_number } = await Auth.register(pass || null);
    $('created-net-num').textContent = net_number;
    showAuth('created');
  } catch (e) {
    toast('Error', e.message || 'Could not create account');
  }
}

async function doLoginPassword() {
  const num = $('pw-account-num').textContent;
  const pass = $('login-pass').value;
  if (!pass) { toast('Required', 'Enter password'); return; }
  try {
    await Auth.loginPassword(num, pass);
    State.simPassword = pass;
    await Auth.save();
    enterApp();
  } catch (e) {
    toast('Login failed', e.message || 'Incorrect password');
  }
}

async function doLoginNumber() {
  const num = $('login-number').value.trim();
  const pass = $('login-number-pass').value;
  if (!isValidPin(num)) { toast('Invalid', '6-digit number required'); return; }
  if (!pass) { toast('Required', 'Enter password'); return; }
  try {
    await Auth.loginPassword(num, pass);
    State.simPassword = pass;
    await Auth.save();
    enterApp();
  } catch (e) {
    toast('Login failed', e.message || 'Check number and password');
  }
}

async function doActivate() {
  const num = $('activate-number').value.trim();
  const pass = $('activate-pass').value;
  if (!isValidPin(num)) { toast('Invalid', '6-digit number required'); return; }
  if (!pass) { toast('Required', 'Enter password'); return; }
  try {
    await Auth.activateDevice(num, pass);
    State.simPassword = pass;
    await Auth.save();
    enterApp();
  } catch (e) {
    toast('Activation failed', e.message || 'Check number and password');
  }
}

async function doUnlock() {
  const pass = $('unlock-pass').value;
  if (!pass) { toast('Required', 'Enter password'); return; }
  try {
    const simData = await Auth.decryptFile(State._pendingSimData, pass);
    if (!simData?.net_number) { toast('Invalid SIM', 'File is not valid'); return; }
    await Auth.activateDevice(simData.net_number, pass);
    await Auth.save();
    enterApp();
  } catch (e) {
    toast('Wrong password', 'Could not decrypt SIM file');
  }
}

// ── Enter App ──
function enterApp() {
  State.chats = Store.getChats();
  State.callLog = Store.getCallLog();
  $('auth-screen').style.display = 'none';
  $('app').style.display = 'flex';

  renderChats();
  renderContacts();
  renderCalls();
  updateBadges();

  $('settings-net-num').textContent = State.sim?.net_number || '-';
  $('settings-created').textContent = State.sim?.created_at ? formatDate(State.sim.created_at) : '-';

  WS.setHandler('pong', () => {});
  WS.setHandler('offline_messages', (msg) => {
    if (Array.isArray(msg.messages)) msg.messages.forEach(m => Chat.receive(m));
  });
  WS.setHandler('status_change', (msg) => {
    State.onlineStatus[msg.pin] = { online: msg.online, last_seen: msg.last_seen };
    if (State.activeChatPin === msg.pin) {
      $('chat-status').textContent = msg.online ? 'Online' : 'Offline';
    }
    renderChats(); renderContacts();
  });
  WS.setHandler('chat', (msg) => Chat.receive(msg));
  WS.setHandler('call_offer', (msg) => Calls.handleOffer(msg));
  WS.setHandler('call_answer', (msg) => Calls.handleAnswer(msg));
  WS.setHandler('call_end', (msg) => Calls.handleEnd(msg));
  WS.setHandler('call_busy', (msg) => Calls.handleBusy(msg));
  WS.setHandler('ice_candidate', (msg) => Calls.handleIce(msg));
  WS.setHandler('otp', (msg) => {
    const code = msg.otp || msg.code || '000000';
    toast(`OTP from ${msg.developer_name || 'Service'}: ${code}`, 15000);
  });
  WS.setHandler('api_message', (msg) => {
    Chat.receive({ from: msg.from || 'api', payload: { type: 'api', content: msg.content || msg.message || '', ts: Date.now() } });
  });

  WS.connect();

  // Fetch status for contacts
  const pins = State.sim?.contacts?.map(c => c.pin) || [];
  if (pins.length) {
    fetch(`${Config.API}/status/batch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pins })
    }).then(r => r.ok ? r.json() : null).then(data => {
      if (data) Object.assign(State.onlineStatus, data);
      renderChats(); renderContacts();
    }).catch(() => {});
  }
}

// ── Tab Switching ──
function switchTab(tab) {
  document.querySelectorAll('.tab-item').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== `view-${tab}`));
  State.activeTab = tab;
  $('header-title').textContent = tab.charAt(0).toUpperCase() + tab.slice(1);
  $('fab-new').style.display = tab === 'contacts' || tab === 'chats' ? 'flex' : 'none';
  if (tab === 'calls') renderCalls();
}

// ── Chat ──
export function openChat(pin) {
  Chat.openChat(pin);
}

function closeChat() {
  Chat.closeChat();
}

function sendMessage() {
  const input = $('msg-input');
  const text = input.value.trim();
  if (!text) return;
  Chat.send(text, 'text');
  input.value = '';
  input.style.height = 'auto';
}

// ── Sheets ──
function openSheet(id) {
  $(id).classList.add('active');
  $('sheet-overlay').classList.add('active');
}

export function closeSheet(id) {
  if (id) $(id).classList.remove('active');
  else document.querySelectorAll('.sheet').forEach(s => s.classList.remove('active'));
  $('sheet-overlay').classList.remove('active');
}

// ── Media ──
function onFileChange(type, input) {
  const file = input.files[0];
  if (!file) return;
  if (type === 'photo') Media.handleImage(file);
  else if (type === 'video') Media.handleVideo(file);
  else if (type === 'file') Media.handleFile(file);
  input.value = '';
}

// ── Event Listeners ──
document.addEventListener('DOMContentLoaded', () => {
  // Auth buttons
  $('btn-continue').addEventListener('click', tryAutoContinue);
  $('btn-register').addEventListener('click', () => showAuth('register'));
  $('btn-login-num').addEventListener('click', () => showAuth('loginNum'));
  $('btn-activate').addEventListener('click', () => showAuth('activate'));
  $('link-import').addEventListener('click', () => $('sim-file-input').click());
  $('sim-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { State._pendingSimData = await Auth.importFile(file); showAuth('unlock'); }
    catch { toast('Error', 'Failed to read SIM file'); }
  });

  $('btn-reg-submit').addEventListener('click', doRegister);
  $('btn-reg-back').addEventListener('click', () => showAuth('welcome'));
  $('btn-login-submit').addEventListener('click', doLoginPassword);
  $('btn-pw-back').addEventListener('click', () => showAuth('accounts'));
  $('btn-accounts-back').addEventListener('click', () => showAuth('welcome'));
  $('btn-login-number-submit').addEventListener('click', doLoginNumber);
  $('btn-login-num-back').addEventListener('click', () => showAuth('welcome'));
  $('btn-activate-submit').addEventListener('click', doActivate);
  $('btn-activate-back').addEventListener('click', () => showAuth('welcome'));
  $('btn-enter-app').addEventListener('click', enterApp);
  $('btn-unlock-submit').addEventListener('click', doUnlock);
  $('btn-unlock-back').addEventListener('click', () => showAuth('welcome'));

  // Tabs
  document.querySelectorAll('.tab-item').forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });

  // Search
  $('btn-search').addEventListener('click', () => {
    $('search-bar').classList.toggle('hidden');
    if (!$('search-bar').classList.contains('hidden')) $('search-input').focus();
  });
  $('search-input').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    if (State.activeTab === 'chats') renderChats(q);
    else if (State.activeTab === 'contacts') renderContacts(q);
  });

  // FAB
  $('fab-new').addEventListener('click', () => {
    if (State.activeTab === 'contacts') openSheet('add-contact-sheet');
    else { renderNewChatContacts(); openSheet('new-chat-sheet'); }
  });

  // Chat screen
  $('chat-back').addEventListener('click', closeChat);
  $('chat-call-audio').addEventListener('click', () => Calls.startCall(State.activeChatPin, 'audio'));
  $('chat-call-video').addEventListener('click', () => Calls.startCall(State.activeChatPin, 'video'));
  $('btn-send').addEventListener('click', sendMessage);
  $('msg-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  $('msg-input').addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
    const hasText = e.target.value.trim().length > 0;
    $('btn-send').style.display = hasText ? 'flex' : 'none';
    $('btn-mic').style.display = hasText ? 'none' : 'flex';
  });

  // Recording
  $('btn-mic').addEventListener('mousedown', Media.startRecording);
  $('btn-mic').addEventListener('touchstart', Media.startRecording);
  $('btn-mic').addEventListener('mouseup', Media.stopRecording);
  $('btn-mic').addEventListener('touchend', Media.stopRecording);
  $('rec-cancel').addEventListener('click', Media.cancelRecording);
  $('rec-send').addEventListener('click', () => { Media.stopRecording(); });

  // Attach
  $('btn-attach').addEventListener('click', () => openSheet('attach-sheet'));
  $('attach-photo').addEventListener('click', () => { closeSheet(); $('file-photo').click(); });
  $('attach-video').addEventListener('click', () => { closeSheet(); $('file-video').click(); });
  $('attach-file').addEventListener('click', () => { closeSheet(); $('file-file').click(); });
  $('file-photo').addEventListener('change', (e) => onFileChange('photo', e.target));
  $('file-video').addEventListener('change', (e) => onFileChange('video', e.target));
  $('file-file').addEventListener('change', (e) => onFileChange('file', e.target));

  // Media preview
  $('preview-send').addEventListener('click', Media.sendPreview);
  $('preview-close').addEventListener('click', Media.closePreview);

  // New chat sheet
  $('btn-start-chat').addEventListener('click', () => {
    const pin = $('new-chat-pin').value.trim();
    if (!isValidPin(pin)) { toast('Invalid', '6-digit number required'); return; }
    if (pin === State.sim?.net_number) { toast('Error', 'Cannot chat with yourself'); return; }
    closeSheet('new-chat-sheet');
    openChat(pin);
  });
  $('btn-new-chat-cancel').addEventListener('click', () => closeSheet('new-chat-sheet'));

  // Add contact sheet
  $('btn-save-contact').addEventListener('click', () => {
    const name = $('add-contact-name').value.trim();
    const pin = $('add-contact-pin').value.trim();
    if (!name) { toast('Required', 'Enter a name'); return; }
    if (!isValidPin(pin)) { toast('Invalid', '6-digit number required'); return; }
    Auth.addContact(name, pin);
    closeSheet('add-contact-sheet');
    renderContacts();
    toast('Saved', `${name} added`);
  });
  $('btn-add-contact-cancel').addEventListener('click', () => closeSheet('add-contact-sheet'));

  // Call overlays
  $('inc-accept').addEventListener('click', () => Calls.acceptCall());
  $('inc-decline').addEventListener('click', () => Calls.declineCall());
  $('call-end').addEventListener('click', () => Calls.endCall());
  $('call-mute').addEventListener('click', () => Calls.toggleMute());
  $('call-speaker').addEventListener('click', () => Calls.toggleSpeaker());

  // Settings
  $('btn-set-password').addEventListener('click', async () => {
    const newPass = prompt('New password (min 4 chars):');
    if (!newPass || newPass.length < 4) { toast('Too short'); return; }
    const confirm = prompt('Confirm:');
    if (newPass !== confirm) { toast('Mismatch'); return; }
    try {
      await Auth.setPassword(State.sim.net_number, newPass);
      State.simPassword = newPass;
      await Auth.save();
      toast('Done', 'Password updated');
    } catch { toast('Error', 'Failed'); }
  });
  $('btn-download-sim').addEventListener('click', () => Auth.exportFile());
  $('btn-eject').addEventListener('click', () => {
    if (!confirm('Eject SIM? This signs you out.')) return;
    Auth.eject(); location.reload();
  });

  // Sheet overlay click to close
  $('sheet-overlay').addEventListener('click', () => closeSheet());

  // Global voice note player
  window.playVoice = function(btn, src) {
    const audio = new Audio(src);
    btn.innerHTML = '&#9646;&#9646;';
    audio.play();
    audio.onended = () => { btn.innerHTML = '&#9654;'; };
    audio.onpause = () => { btn.innerHTML = '&#9654;'; };
    btn.onclick = () => {
      if (audio.paused) { audio.play(); btn.innerHTML = '&#9646;&#9646;'; }
      else { audio.pause(); btn.innerHTML = '&#9654;'; }
    };
  };

  window.previewMedia = function(type, src) {
    const content = $('preview-content');
    content.innerHTML = '';
    if (type === 'image') { const img = document.createElement('img'); img.src = src; content.appendChild(img); }
    else if (type === 'video') { const vid = document.createElement('video'); vid.src = src; vid.controls = true; content.appendChild(vid); }
    $('media-preview-overlay').classList.add('active');
  };

  // Visibility reconnect
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && State.sim && State.ws?.readyState > 1) WS.connect();
  });

  // Init
  const sessionSim = sessionStorage.getItem('inet_sim');
  const sessionDevice = sessionStorage.getItem('inet_device');
  if (sessionSim && sessionDevice) {
    try {
      State.sim = JSON.parse(sessionSim);
      State.deviceId = sessionDevice;
      State.simPassword = sessionStorage.getItem('inet_pass') || null;
      enterApp();
      return;
    } catch { sessionStorage.clear(); }
  }
  tryAutoContinue();
});
