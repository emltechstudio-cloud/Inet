import { ICE_SERVERS } from "./config";
import { SignalingSocket } from "./signaling";
import type { CommMode, SignalEvent } from "./types";

type PeerSlot = {
  id: string;
  flinkNumber?: string | null;
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pending: RTCIceCandidateInit[];
};

export type SessionHandlers = {
  onStatus: (text: string) => void;
  onChat: (from: string, data: { kind: string; text?: string; image?: string; id: string; ts: number }) => void;
  onPeerMedia: (peerId: string, stream: MediaStream) => void;
  onPeerLeft: (peerId: string) => void;
  onConnected: (peers: number) => void;
  onDeclined?: () => void;
};

export class FlinkSession {
  private signaling: SignalingSocket;
  private peers = new Map<string, PeerSlot>();
  private localStream: MediaStream | null = null;
  private selfId = "";
  closed = false;

  constructor(
    readonly sessionId: string,
    readonly token: string | undefined,
    readonly mode: CommMode,
    readonly handlers: SessionHandlers,
  ) {
    this.signaling = new SignalingSocket(sessionId, token, {
      onEvent: (e) => void this.onSignal(e),
      onOpen: (id) => {
        this.selfId = id;
        this.handlers.onStatus("Waiting for them to join");
      },
    });
  }

  async start(stream?: MediaStream) {
    this.localStream = stream ?? null;
    this.signaling.connect();
  }

  attachLocal(stream: MediaStream) {
    this.localStream = stream;
    for (const slot of this.peers.values()) {
      for (const track of stream.getTracks()) {
        const existing = slot.pc.getSenders().find((s) => s.track?.kind === track.kind);
        if (existing) void existing.replaceTrack(track);
        else slot.pc.addTrack(track, stream);
      }
    }
  }

  sendChat(data: { kind: string; text?: string; image?: string; id: string; ts: number }) {
    const raw = JSON.stringify({ v: 1, ...data });
    for (const slot of this.peers.values()) {
      if (slot.channel?.readyState === "open") slot.channel.send(raw);
    }
  }

  mute(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }

  setVideo(on: boolean) {
    this.localStream?.getVideoTracks().forEach((t) => {
      t.enabled = on;
    });
  }

  decline() {
    this.signaling.send("session-decline", { reason: "declined" });
    this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.signaling.send("session-leave", {});
    this.signaling.close();
    for (const slot of this.peers.values()) {
      try {
        slot.channel?.close();
      } catch {
        /* noop */
      }
      slot.pc.close();
    }
    this.peers.clear();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
  }

  get local() {
    return this.localStream;
  }

  private async onSignal(event: SignalEvent) {
    if (event.type === "ready") {
      this.selfId = event.peer_id ?? this.selfId;
      for (const p of event.peers ?? []) {
        if (p.peer_id) await this.ensurePeer(p.peer_id, p.flink_number);
      }
      return;
    }
    if (event.type === "peer-joined" && event.peer?.peer_id) {
      await this.ensurePeer(event.peer.peer_id, event.peer.flink_number);
      return;
    }
    if (event.type === "peer-left" && event.peer?.peer_id) {
      this.dropPeer(event.peer.peer_id);
      return;
    }
    if (event.type === "session-decline") {
      this.handlers.onDeclined?.();
      return;
    }
    if (!event.from) return;
    const slot = await this.ensurePeer(event.from);
    if (event.type === "offer") {
      await this.handleOffer(slot, event.payload as RTCSessionDescriptionInit);
    } else if (event.type === "answer") {
      await this.handleAnswer(slot, event.payload as RTCSessionDescriptionInit);
    } else if (event.type === "ice") {
      const cand = event.payload as RTCIceCandidateInit;
      if (slot.pc.remoteDescription) {
        try {
          await slot.pc.addIceCandidate(cand);
        } catch {
          /* glare */
        }
      } else {
        slot.pending.push(cand);
      }
    }
  }

  private async ensurePeer(id: string, flinkNumber?: string | null) {
    const existing = this.peers.get(id);
    if (existing) {
      if (flinkNumber) existing.flinkNumber = flinkNumber;
      return existing;
    }
    const polite = this.selfId > id;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const slot: PeerSlot = {
      id,
      flinkNumber,
      pc,
      makingOffer: false,
      ignoreOffer: false,
      pending: [],
    };
    this.peers.set(id, slot);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);
    }

    const channel = pc.createDataChannel("flink", { ordered: true });
    this.bindChannel(slot, channel);
    pc.ondatachannel = (ev) => this.bindChannel(slot, ev.channel);

    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.signaling.send("ice", ev.candidate.toJSON(), id);
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      this.handlers.onPeerMedia(id, stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        this.handlers.onConnected(this.peers.size);
        this.handlers.onStatus("Connected");
      }
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        this.handlers.onStatus("Connection dropped");
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        slot.makingOffer = true;
        await pc.setLocalDescription(await pc.createOffer());
        this.signaling.send("offer", pc.localDescription, id);
      } catch (err) {
        console.warn("offer failed", err);
      } finally {
        slot.makingOffer = false;
      }
    };

    // Kick an offer from the impolite (higher id) side if we already have a stream
    if (!polite && this.localStream) {
      try {
        slot.makingOffer = true;
        await pc.setLocalDescription(await pc.createOffer());
        this.signaling.send("offer", pc.localDescription, id);
      } finally {
        slot.makingOffer = false;
      }
    }

    return slot;
  }

  private bindChannel(slot: PeerSlot, channel: RTCDataChannel) {
    slot.channel = channel;
    channel.onopen = () => {
      this.handlers.onConnected(this.peers.size);
      this.handlers.onStatus("Talking");
    };
    channel.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as {
          kind: string;
          text?: string;
          image?: string;
          id: string;
          ts: number;
        };
        this.handlers.onChat(slot.flinkNumber || slot.id, data);
      } catch {
        /* ignore */
      }
    };
  }

  private async handleOffer(slot: PeerSlot, desc: RTCSessionDescriptionInit) {
    const polite = this.selfId > slot.id;
    const collision = slot.makingOffer || slot.pc.signalingState !== "stable";
    slot.ignoreOffer = !polite && collision;
    if (slot.ignoreOffer) return;
    await slot.pc.setRemoteDescription(desc);
    for (const c of slot.pending) {
      try {
        await slot.pc.addIceCandidate(c);
      } catch {
        /* noop */
      }
    }
    slot.pending = [];
    await slot.pc.setLocalDescription(await slot.pc.createAnswer());
    this.signaling.send("answer", slot.pc.localDescription, slot.id);
  }

  private async handleAnswer(slot: PeerSlot, desc: RTCSessionDescriptionInit) {
    try {
      await slot.pc.setRemoteDescription(desc);
      for (const c of slot.pending) {
        try {
          await slot.pc.addIceCandidate(c);
        } catch {
          /* noop */
        }
      }
      slot.pending = [];
    } catch {
      /* glare */
    }
  }

  private dropPeer(id: string) {
    const slot = this.peers.get(id);
    if (!slot) return;
    slot.pc.close();
    this.peers.delete(id);
    this.handlers.onPeerLeft(id);
  }
}
