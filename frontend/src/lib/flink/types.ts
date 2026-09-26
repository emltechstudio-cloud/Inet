export type CommMode = "chat" | "ping" | "voice" | "video";

export type FlinkProfile = {
  flinkNumber: string;
  deviceId: string;
  simId: string;
  accessToken: string;
  password?: string;
  createdAt: number;
};

export type FlinkSimFile = {
  kind: "flink-sim";
  version: 1;
  payload: Record<string, unknown>;
  signature: string;
  algorithm: string;
  public_key?: string;
  password?: string;
  deviceId?: string;
  simId?: string;
};

export type Contact = {
  flinkNumber: string;
  name: string;
  lastSeen: number;
};

export type ChatMessage = {
  id: string;
  threadId: string;
  from: string;
  kind: "text" | "image" | "system";
  text?: string;
  imageUrl?: string;
  ts: number;
  mine: boolean;
};

export type Thread = {
  id: string;
  kind: "direct" | "group" | "room";
  title: string;
  peerNumber?: string;
  groupId?: string;
  lastText: string;
  lastTs: number;
};

export type CallLog = {
  id: string;
  peer: string;
  mode: CommMode;
  direction: "in" | "out";
  status: "calling" | "ringing" | "connected" | "ended" | "missed" | "declined";
  ts: number;
  durationSec?: number;
};

export type FlinkGroup = {
  group_id: string;
  name: string;
  owner: string;
  members: string[];
  created_at: string;
  updated_at: string;
};

export type IncomingRequest = {
  from: string;
  mode: CommMode;
  sessionId: string;
  groupId?: string;
  groupName?: string;
  roomTitle?: string;
};

export type AppView =
  | "home"
  | "dial"
  | "history"
  | "chat"
  | "groups"
  | "rooms"
  | "you";

export type SignalEvent = {
  type: string;
  from?: string;
  payload?: unknown;
  peer?: { peer_id: string; flink_number?: string | null };
  peer_id?: string;
  peers?: Array<{ peer_id: string; flink_number?: string | null }>;
  protocol?: number;
  session_id?: string;
};
