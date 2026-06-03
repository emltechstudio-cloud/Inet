/* components.js — Reusable UI builders */
import { State, AVATAR_COLORS } from '../core/state.js';

export function initials(name) {
  if (!name) return '?';
  return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export function avatarColor(pin) {
  const idx = parseInt(pin || '0') % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

export function avatarEl(name, pin, size = 48) {
  const color = avatarColor(pin);
  const init = initials(name);
  return `<div class="avatar" style="width:${size}px;height:${size}px;background:${color};font-size:${size*0.4}px;">${init}</div>`;
}

export function toast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), duration);
}

export function setLoading(btnId, loading, text = 'Please wait...') {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) btn.innerHTML = `<span class="spinner">&#9696;</span> ${text}`;
}

export function formatTime(ts) {
  const d = new Date(ts), now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff/60000)}m`;
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  if (diff < 86400000 * 7) return d.toLocaleDateString([], {weekday:'short'});
  return d.toLocaleDateString([], {month:'short', day:'numeric'});
}

export function formatDuration(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s.toString().padStart(2,'0')}`;
}

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString([], { year:'numeric', month:'long', day:'numeric' });
}

export function contactName(pin) {
  if (!State.sim) return pin;
  const c = State.sim.contacts?.find(c => c.pin === pin);
  return c ? c.name : pin;
}

export function isValidPin(pin) {
  return /^\d{6}$/.test(pin);
}

export async function compressImage(file, maxKb = 500) {
  return new Promise((res) => {
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
}

export function blobToB64(blob) {
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
}

export function b64toBlob(b64, mime) {
  const bin = atob(b64.split(',').pop());
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function waveformBars(count = 28) {
  return Array.from({ length: count }, () => Math.floor(Math.random() * 20 + 8));
}
