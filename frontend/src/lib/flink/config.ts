const DEFAULT_API = "https://emltechstudio-eml-core-api.hf.space";

export const FLINK_API_URL = (
  import.meta.env.VITE_FLINK_API_URL ?? DEFAULT_API
).replace(/\/$/, "");

export const FLINK_WS_URL = FLINK_API_URL.replace(/^http/, "ws");

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export const PROTOCOL = 2;
