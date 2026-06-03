/* crypto.js — SIM encryption */
export const Crypto = {
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
    const buf = new Uint8Array(16 + 12 + ct.byteLength);
    buf.set(salt, 0); buf.set(iv, 16); buf.set(new Uint8Array(ct), 28);
    return btoa(String.fromCharCode(...buf));
  },

  async decrypt(password, b64) {
    const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const salt = buf.slice(0, 16); const iv = buf.slice(16, 28); const ct = buf.slice(28);
    const key = await this.deriveKey(password, salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(new TextDecoder().decode(plain));
  },

  randomDeviceId() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  },

  async getFingerprint() {
    const components = [
      navigator.userAgent, navigator.language,
      screen.width + 'x' + screen.height,
      screen.colorDepth, new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency || '', navigator.deviceMemory || ''
    ];
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(components.join('::')));
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
};
