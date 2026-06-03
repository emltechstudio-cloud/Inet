/* ws.js — WebSocket manager */
import { State, Config } from './state.js';
import { Store } from './storage.js';

let handlers = {};

export function setHandler(type, fn) { handlers[type] = fn; }

export function connect() {
  if (State.wsConnecting || (State.ws && State.ws.readyState < 2)) return;
  if (!State.sim?.net_number || !State.deviceId) return;

  State.wsConnecting = true;
  const url = `${Config.WS_URL}?net_number=${State.sim.net_number}&device_id=${State.deviceId}`;
  const ws = new WebSocket(url);
  State.ws = ws;

  ws.onopen = () => {
    State.wsReady = true; State.wsConnecting = false;
    State.wsReconnectDelay = 2000;
    clearTimeout(State.wsReconnectTimer);
    flushQueue();
    send({ type: 'sync_request' });
    if (handlers._onopen) handlers._onopen();
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    const fn = handlers[msg.type];
    if (fn) fn(msg);
    else console.log('[WS] unhandled:', msg.type);
  };

  ws.onclose = () => {
    State.wsReady = false; State.wsConnecting = false;
    State.wsReconnectTimer = setTimeout(() => connect(), State.wsReconnectDelay);
    State.wsReconnectDelay = Math.min(State.wsReconnectDelay * 1.5, 30000);
    if (handlers._onclose) handlers._onclose();
  };

  ws.onerror = () => { State.wsConnecting = false; };
}

export function send(obj) {
  if (State.ws && State.wsReady) {
    State.ws.send(JSON.stringify(obj));
  } else {
    State.msgQueue.push(obj);
    if (!State.wsConnecting) connect();
  }
}

function flushQueue() {
  while (State.msgQueue.length > 0 && State.wsReady) {
    const msg = State.msgQueue.shift();
    State.ws.send(JSON.stringify(msg));
  }
}

export function disconnect() {
  if (State.ws) { State.ws.close(); State.ws = null; }
  clearTimeout(State.wsReconnectTimer);
  State.wsReady = false; State.wsConnecting = false;
}
