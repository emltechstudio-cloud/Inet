/* calls.js — 1-to-1 WebRTC calls */
import { State } from '../core/state.js';
import { Store } from '../core/storage.js';
import * as WS from '../core/ws.js';
import { toast, formatDuration, contactName } from '../ui/components.js';

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
  iceCandidatePoolSize: 10
};

let pendingOffer = null;

export async function startCall(pin, type = 'audio') {
  if (State.currentCall) { toast('Busy', 'Already in a call'); return; }
  State.currentCall = { pin, type, direction: 'outgoing', state: 'calling', startTime: null };

  try {
    State.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
  } catch (e) {
    toast('Permission denied', 'Microphone/camera access required');
    State.currentCall = null; return;
  }

  showCallScreen(pin, type, 'calling');
  State.peerConn = new RTCPeerConnection(ICE_CONFIG);
  State.localStream.getTracks().forEach(t => State.peerConn.addTrack(t, State.localStream));

  State.peerConn.onicecandidate = ({ candidate }) => {
    if (candidate) WS.send({ type: 'ice_candidate', target: pin, candidate });
  };

  State.peerConn.ontrack = (ev) => {
    State.remoteStream = ev.streams[0];
  };

  State.peerConn.onconnectionstatechange = () => {
    const s = State.peerConn?.connectionState;
    if (s === 'connected') {
      State.currentCall.state = 'active';
      State.currentCall.startTime = Date.now();
      document.getElementById('call-status').textContent = 'Connected';
      startTimer();
    } else if (s === 'failed' || s === 'disconnected') {
      endCall(true);
    }
  };

  const offer = await State.peerConn.createOffer();
  await State.peerConn.setLocalDescription(offer);
  WS.send({ type: 'call_offer', target: pin, call_type: type, sdp: offer.sdp });
}

export async function handleOffer(msg) {
  if (State.currentCall) {
    WS.send({ type: 'call_busy', target: msg.from });
    return;
  }
  pendingOffer = msg;
  const name = contactName(msg.from);
  document.getElementById('inc-name').textContent = name;
  document.getElementById('inc-type').textContent = `Incoming ${msg.call_type === 'video' ? 'Video' : 'Audio'} Call`;
  document.getElementById('incoming-overlay').classList.add('active');
}

export async function acceptCall() {
  const msg = pendingOffer;
  if (!msg) return;
  document.getElementById('incoming-overlay').classList.remove('active');
  pendingOffer = null;

  State.currentCall = { pin: msg.from, type: msg.call_type, direction: 'incoming', state: 'connecting', startTime: null };

  try {
    State.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: msg.call_type === 'video' });
  } catch (e) {
    toast('Error', 'Media access failed'); State.currentCall = null; return;
  }

  showCallScreen(msg.from, msg.call_type, 'connecting');
  State.peerConn = new RTCPeerConnection(ICE_CONFIG);
  State.localStream.getTracks().forEach(t => State.peerConn.addTrack(t, State.localStream));

  State.peerConn.onicecandidate = ({ candidate }) => {
    if (candidate) WS.send({ type: 'ice_candidate', target: msg.from, candidate });
  };
  State.peerConn.ontrack = (ev) => { State.remoteStream = ev.streams[0]; };
  State.peerConn.onconnectionstatechange = () => {
    const s = State.peerConn?.connectionState;
    if (s === 'connected') {
      State.currentCall.state = 'active';
      State.currentCall.startTime = Date.now();
      document.getElementById('call-status').textContent = 'Connected';
      startTimer();
    } else if (s === 'failed' || s === 'disconnected') {
      endCall(true);
    }
  };

  await State.peerConn.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
  const answer = await State.peerConn.createAnswer();
  await State.peerConn.setLocalDescription(answer);
  WS.send({ type: 'call_answer', target: msg.from, sdp: answer.sdp });
}

export function declineCall() {
  if (pendingOffer) {
    WS.send({ type: 'call_end', target: pendingOffer.from });
    logCall(pendingOffer.from, pendingOffer.call_type, 'incoming', 0, true);
    pendingOffer = null;
  }
  document.getElementById('incoming-overlay').classList.remove('active');
}

export async function handleAnswer(msg) {
  if (!State.peerConn) return;
  await State.peerConn.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
}

export async function handleIce(msg) {
  if (!State.peerConn) return;
  try { await State.peerConn.addIceCandidate(msg.candidate); } catch {}
}

export function handleEnd(msg) {
  if (State.currentCall?.pin === msg.from || !State.currentCall) {
    endCall(false, true);
  }
}

export function handleBusy(msg) {
  toast('Line Busy', `${contactName(msg.from)} is on another call`);
  cleanupCall();
  logCall(State.currentCall?.pin, State.currentCall?.type, 'outgoing', 0, false);
  document.getElementById('call-overlay').classList.remove('active');
  State.currentCall = null;
}

export function endCall(fromError = false, remote = false) {
  if (!State.currentCall) return;
  if (!remote) WS.send({ type: 'call_end', target: State.currentCall.pin });
  const duration = State.currentCall.startTime ? Math.floor((Date.now() - State.currentCall.startTime) / 1000) : 0;
  logCall(State.currentCall.pin, State.currentCall.type, State.currentCall.direction, duration, duration === 0 && State.currentCall.direction === 'incoming');
  cleanupCall();
  document.getElementById('call-overlay').classList.remove('active');
  State.currentCall = null;
}

function cleanupCall() {
  clearInterval(State.callTimer);
  if (State.localStream) { State.localStream.getTracks().forEach(t => t.stop()); State.localStream = null; }
  if (State.peerConn) { State.peerConn.close(); State.peerConn = null; }
  State.isMuted = false; State.isSpeaker = false;
}

function showCallScreen(pin, type, status) {
  const name = contactName(pin);
  document.getElementById('call-avatar').textContent = name.slice(0,2).toUpperCase();
  document.getElementById('call-avatar').style.background = `hsl(${parseInt(pin||0)*60},60%,40%)`;
  document.getElementById('call-name').textContent = name;
  document.getElementById('call-timer').style.display = 'none';
  document.getElementById('call-status').textContent = status === 'calling' ? 'Calling...' : 'Connecting...';
  document.getElementById('call-overlay').classList.add('active');
}

function startTimer() {
  let s = 0;
  document.getElementById('call-timer').style.display = '';
  document.getElementById('call-status').textContent = '';
  State.callTimer = setInterval(() => {
    s++;
    document.getElementById('call-timer').textContent = formatDuration(s);
  }, 1000);
}

export function toggleMute() {
  State.isMuted = !State.isMuted;
  if (State.localStream) {
    State.localStream.getAudioTracks().forEach(t => t.enabled = !State.isMuted);
  }
  document.getElementById('call-mute').classList.toggle('active', State.isMuted);
}

export function toggleSpeaker() {
  State.isSpeaker = !State.isSpeaker;
  document.getElementById('call-speaker').classList.toggle('active', State.isSpeaker);
}

function logCall(pin, type, direction, duration, missed) {
  if (!pin) return;
  State.callLog.push({ pin, type: type || 'audio', direction, duration, missed: !!missed, ts: Date.now(), seen: !missed });
  if (State.callLog.length > 200) State.callLog = State.callLog.slice(-200);
  Store.saveCallLog(State.callLog);
  import('../ui/render.js').then(m => m.renderCalls());
}
