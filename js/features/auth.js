/* auth.js — All authentication logic */
import { State } from '../core/state.js';
import { Store } from '../core/storage.js';
import { Crypto } from '../core/crypto.js';
import { apiFetch } from '../core/api.js';
import { toast } from '../ui/components.js';

export async function register(password = null) {
  const fingerprint = await Crypto.getFingerprint();
  const device_id = Crypto.randomDeviceId();
  const res = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ fingerprint, device_id, password })
  });
  if (!res.ok) throw new Error('Backend error');
  const { net_number } = await res.json();
  State.sim = { net_number, created_at: new Date().toISOString(), contacts: [] };
  State.simPassword = password;
  State.deviceId = device_id;
  Store.set('inet_device_id', device_id);
  await save();
  return { net_number };
}

export async function continueDevice() {
  const fingerprint = await Crypto.getFingerprint();
  const device_id = State.deviceId || Crypto.randomDeviceId();
  const res = await apiFetch('/auth/continue', {
    method: 'POST',
    body: JSON.stringify({ fingerprint, device_id })
  });
  if (!res.ok) throw new Error('Continue failed');
  const data = await res.json();
  if (data.found && data.accounts.length > 0) {
    State.deviceId = device_id;
    Store.set('inet_device_id', device_id);
  }
  return data;
}

export async function loginPassword(net_number, password) {
  const fingerprint = await Crypto.getFingerprint();
  const device_id = Crypto.randomDeviceId();
  const res = await apiFetch('/auth/login-password', {
    method: 'POST',
    body: JSON.stringify({ net_number, password, device_id, fingerprint })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Login failed');
  }
  const data = await res.json();
  State.deviceId = data.device_id || device_id;
  Store.set('inet_device_id', State.deviceId);
  return data;
}

export async function activateDevice(net_number, password) {
  const fingerprint = await Crypto.getFingerprint();
  const device_id = Crypto.randomDeviceId();
  const res = await apiFetch('/auth/activate-device', {
    method: 'POST',
    body: JSON.stringify({ net_number, password, fingerprint, device_id })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Activation failed');
  }
  const data = await res.json();
  State.deviceId = data.device_id || device_id;
  Store.set('inet_device_id', State.deviceId);
  return data;
}

export async function setPassword(net_number, password) {
  const res = await apiFetch('/auth/set-password', {
    method: 'POST',
    body: JSON.stringify({ net_number, password })
  });
  if (!res.ok) throw new Error('Failed');
  return await res.json();
}

export async function save() {
  if (!State.sim || !State.simPassword) return;
  const enc = await Crypto.encrypt(State.simPassword, State.sim);
  Store.set('inet_enc_sim', enc);
}

export async function exportFile() {
  if (!State.sim || !State.simPassword) return;
  const enc = await Crypto.encrypt(State.simPassword, State.sim);
  const blob = new Blob([enc], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `inet-${State.sim.net_number}.sim.inet`; a.click();
  URL.revokeObjectURL(url);
}

export async function importFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.trim());
    r.onerror = () => rej(new Error('Failed to read'));
    r.readAsText(file);
  });
}

export async function decryptFile(encData, password) {
  return Crypto.decrypt(password, encData);
}

export function addContact(name, pin) {
  if (!State.sim) return;
  const exists = State.sim.contacts.find(c => c.pin === pin);
  if (exists) exists.name = name;
  else State.sim.contacts.push({ name, pin });
  State.sim.contacts.sort((a, b) => a.name.localeCompare(b.name));
  save();
}

export function updateContact(oldPin, name, pin) {
  if (!State.sim) return;
  const c = State.sim.contacts.find(c => c.pin === oldPin);
  if (c) { c.name = name; c.pin = pin; }
  State.sim.contacts.sort((a, b) => a.name.localeCompare(b.name));
  save();
}

export function deleteContact(pin) {
  if (!State.sim) return;
  State.sim.contacts = State.sim.contacts.filter(c => c.pin !== pin);
  save();
}

export function eject() {
  State.sim = null; State.simPassword = null; State.deviceId = null;
  Store.del('inet_enc_sim'); Store.del('inet_device_id');
  sessionStorage.clear();
}
