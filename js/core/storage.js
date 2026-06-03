/* storage.js — localStorage wrapper */
export const Store = {
  get(k, def = null) {
    try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : def; }
    catch { return def; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { localStorage.removeItem(k); },
  getChats() { return Store.get('inet_chats', {}); },
  saveChats(chats) { Store.set('inet_chats', chats); },
  getCallLog() { return Store.get('inet_calllog', []); },
  saveCallLog(log) { Store.set('inet_calllog', log); },
};
