/* chat.js — Messaging logic with backend media fallback */
import { State } from '../core/state.js';
import { Store } from '../core/storage.js';
import * as WS from '../core/ws.js';
import { toast, contactName } from '../ui/components.js';
import { renderMessages, updateBadges } from '../ui/render.js';

export function ensureChat(pin) {
  if (!State.chats[pin]) State.chats[pin] = { messages: [], unread: 0 };
  return State.chats[pin];
}

export async function receive(msg) {
  const from = msg.from || msg.payload?.from;
  const pin = from || msg.pin;
  if (!pin) return;

  const payload = msg.payload || msg;

  // If message has media_id but no media data, fetch from backend
  if (payload.media_id && !payload.media) {
    const mediaData = await fetchMediaFromBackend(payload.media_id);
    if (mediaData) {
      payload.media = mediaData.data_b64;
      payload.caption = mediaData.caption || payload.caption;
    }
  }

  const chat = ensureChat(pin);
  const message = {
    id: msg.id || Date.now() + Math.random(),
    from: pin,
    type: payload.type || 'text',
    content: payload.content || payload.text || '',
    media: payload.media || null,
    caption: payload.caption || '',
    ts: payload.ts || Date.now(),
  };
  chat.messages.push(message);

  if (State.activeChatPin === pin) {
    import('../ui/render.js').then(m => {
      m.renderMessages();
      chat.unread = 0;
      Store.saveChats(State.chats);
      updateBadges();
    });
  } else {
    chat.unread++;
    const name = contactName(pin);
    let preview = message.content;
    if (message.type === 'image') preview = '📷 Photo';
    else if (message.type === 'video') preview = '🎥 Video';
    else if (message.type === 'voice') preview = '🎤 Voice note';
    else if (message.type === 'sticker') preview = 'Sticker';
    else if (message.type === 'file') preview = '📎 File';
    toast(`${name}: ${preview || 'New message'}`);
    import('../ui/render.js').then(m => m.renderChats());
    updateBadges();
  }
  Store.saveChats(State.chats);
}

async function fetchMediaFromBackend(mediaId) {
  try {
    const { fetchMedia } = await import('./media.js');
    return await fetchMedia(mediaId);
  } catch {
    return null;
  }
}

export function send(content, type = 'text', media = null, caption = '') {
  const pin = State.activeChatPin;
  if (!pin) return;
  const chat = ensureChat(pin);
  const ts = Date.now();
  const message = { id: Date.now() + Math.random(), from: 'me', type, content, media, caption, ts };
  WS.send({ type: 'chat', target: pin, payload: { type, content, media, caption, ts } });
  chat.messages.push(message);
  import('../ui/render.js').then(m => m.renderMessages());
  Store.saveChats(State.chats);
  import('../ui/render.js').then(m => m.renderChats());
}

export function openChat(pin) {
  State.activeChatPin = pin;
  const chat = ensureChat(pin);
  chat.unread = 0;
  Store.saveChats(State.chats);
  updateBadges();

  const name = contactName(pin);
  document.getElementById('chat-name').textContent = name;
  document.getElementById('chat-avatar').textContent = name.slice(0,2).toUpperCase();
  document.getElementById('chat-avatar').style.background = `hsl(${parseInt(pin||0)*60},60%,40%)`;

  const online = State.onlineStatus[pin]?.online;
  document.getElementById('chat-status').textContent = online ? 'Online' : 'Offline';

  document.getElementById('chat-screen').classList.add('active');
  renderMessages();
}

export function closeChat() {
  State.activeChatPin = null;
  document.getElementById('chat-screen').classList.remove('active');
  import('../ui/render.js').then(m => m.renderChats());
}
