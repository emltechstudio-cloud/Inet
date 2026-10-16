const DEFAULT_API = "https://emltechstudio-eml-core-api.hf.space";

export const FLINK_API_URL = (
  import.meta.env.VITE_FLINK_API_URL ?? DEFAULT_API
).replace(/\/$/, "");

export const FLINK_WS_URL = FLINK_API_URL.replace(/^http/, "ws");

const configuredTurn = import.meta.env.VITE_TURN_URL as string | undefined;
const configuredTurnUsername = import.meta.env.VITE_TURN_USERNAME as string | undefined;
const configuredTurnCredential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  ...(configuredTurn ? [{ urls: configuredTurn, username: configuredTurnUsername, credential: configuredTurnCredential }] : []),
];

export const PROTOCOL = 2;
