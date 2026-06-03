/* state.js — Single source of truth */
export const State = {
  sim: null,
  simPassword: null,
  deviceId: null,
  fingerprint: null,
  ws: null,
  wsReady: false,
  wsConnecting: false,
  wsReconnectDelay: 2000,
  wsReconnectTimer: null,
  activeTab: 'chats',
  activeChatPin: null,
  chats: {},
  callLog: [],
  onlineStatus: {},
  currentCall: null,
  peerConn: null,
  localStream: null,
  remoteStream: null,
  callTimer: null,
  isMuted: false,
  isSpeaker: false,
  groupCall: null,
  mediaRecorder: null,
  recChunks: [],
  recTimer: null,
  recSeconds: 0,
  recLimit: 600,
  pendingMedia: null,
  msgQueue: [],
};

export const Config = {
  API: 'https://emltechstudio-inet-v2.hf.space',
  WS_URL: 'wss://emltechstudio-inet-v2.hf.space/ws',
};

export const AVATAR_COLORS = [
  '#7B1535','#1E3A5F','#1A5E20','#4A148C','#BF360C','#006064',
  '#33691E','#4E342E','#1A237E','#880E4F','#3E2723','#0D47A1'
];
