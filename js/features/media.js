/* media.js — Voice notes, images, videos, files with backend storage */
import { State, Config } from '../core/state.js';
import { toast, compressImage, blobToB64 } from '../ui/components.js';
import * as Chat from './chat.js';

export async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
    });
    State.mediaRecorder = mr;
    State.recChunks = [];
    State.recSeconds = 0;

    mr.ondataavailable = e => { if (e.data.size) State.recChunks.push(e.data); };
    mr.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(State.recChunks, { type: mr.mimeType });
      if (State._recCancelled) { State._recCancelled = false; return; }
      if (State.recSeconds > State.recLimit) { toast('Too long', 'Voice notes max 10 min'); return; }
      sendVoiceNote(blob, State.recSeconds);
    };

    mr.start(100);
    document.getElementById('recording-bar').classList.add('active');
    document.getElementById('input-area').style.display = 'none';

    State.recTimer = setInterval(() => {
      State.recSeconds++;
      document.getElementById('rec-timer').textContent = formatRecTime(State.recSeconds);
      if (State.recSeconds >= State.recLimit) stopRecording();
    }, 1000);
  } catch {
    toast('Error', 'Microphone access denied');
  }
}

export function stopRecording() {
  clearInterval(State.recTimer);
  if (State.mediaRecorder?.state !== 'inactive') State.mediaRecorder?.stop();
  document.getElementById('recording-bar').classList.remove('active');
  document.getElementById('input-area').style.display = '';
}

export function cancelRecording() {
  State._recCancelled = true;
  stopRecording();
}

async function sendVoiceNote(blob, seconds) {
  const b64 = await blobToB64(blob);
  // Try to send via WS first, fallback to media storage
  sendMediaWithFallback('voice', b64, formatRecTime(seconds), '');
}

function formatRecTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export async function handleImage(file) {
  if (!file) return;
  const compressed = await compressImage(file);
  const b64 = await blobToB64(compressed);
  showPreview('image', b64);
}

export async function handleVideo(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('Too large', 'Videos must be under 10MB'); return; }
  const url = URL.createObjectURL(file);
  const vid = document.createElement('video');
  vid.src = url;
  vid.onloadedmetadata = async () => {
    URL.revokeObjectURL(url);
    if (vid.duration > 90) { toast('Too long', 'Videos max 90 seconds'); return; }
    const b64 = await blobToB64(file);
    showPreview('video', b64);
  };
}

export async function handleFile(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('Too large', 'Files must be under 10MB'); return; }
  const b64 = await blobToB64(file);
  Chat.send(file.name, 'file', b64);
}

function showPreview(type, src) {
  const content = document.getElementById('preview-content');
  content.innerHTML = '';
  if (type === 'image') {
    const img = document.createElement('img');
    img.src = src;
    content.appendChild(img);
  } else if (type === 'video') {
    const vid = document.createElement('video');
    vid.src = src; vid.controls = true;
    content.appendChild(vid);
  }
  State.pendingMedia = { type, data: src };
  document.getElementById('media-preview-overlay').classList.add('active');
}

export async function sendPreview() {
  if (!State.pendingMedia) return;
  const caption = document.getElementById('preview-caption').value.trim();
  const { type, data } = State.pendingMedia;
  await sendMediaWithFallback(type, data, caption, caption);
  State.pendingMedia = null;
  closePreview();
}

export function closePreview() {
  document.getElementById('media-preview-overlay').classList.remove('active');
  document.getElementById('preview-caption').value = '';
  State.pendingMedia = null;
}

/* ── NEW: Backend media storage with fallback ── */

async function sendMediaWithFallback(type, dataB64, content, caption) {
  const pin = State.activeChatPin;
  if (!pin) return;

  // 1. Try WebSocket first (fast, no storage)
  import('../core/ws.js').then(WS => {
    WS.send({
      type: 'chat',
      target: pin,
      payload: { type, content, media: dataB64, caption, ts: Date.now() }
    });
  });

  // 2. Also upload to backend media store for offline delivery
  //    (recipient will fetch if they miss the WS message)
  try {
    const res = await fetch(`${Config.API}/media/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: State.sim.net_number,
        recipient: pin,
        type: type,
        data_b64: dataB64,
        caption: caption,
      })
    });
    if (res.ok) {
      const { media_id } = await res.json();
      // Send a lightweight WS message with media_id reference
      // so recipient knows to fetch if they don't have the full data
      import('../core/ws.js').then(WS => {
        WS.send({
          type: 'chat',
          target: pin,
          payload: {
            type: type,
            content: content,
            media_id: media_id,  // recipient can fetch from backend
            caption: caption,
            ts: Date.now(),
          }
        });
      });
    }
  } catch (e) {
    console.log('[Media] Backend storage failed, WS only:', e);
  }

  // 3. Show in local chat immediately
  Chat.send(content, type, dataB64, caption);
}

/* ── Fetch media from backend if needed ── */

export async function fetchMedia(mediaId) {
  try {
    const res = await fetch(`${Config.API}/media/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_id: mediaId,
        recipient: State.sim.net_number,
      })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
