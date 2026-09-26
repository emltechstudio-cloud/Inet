import { create } from "zustand";
import { toast } from "sonner";
import { downloadJson, randomId, sessionId } from "@/lib/utils";
import { flinkApi } from "./api";
import { registerFlinkPush } from "./push";
import { dropMailbox, SignalingSocket } from "./signaling";
import { FlinkSession } from "./session";
import { flinkStorage } from "./storage";
import type {
  AppView,
  CallLog,
  ChatMessage,
  CommMode,
  Contact,
  FlinkGroup,
  FlinkProfile,
  FlinkSimFile,
  IncomingRequest,
  Thread,
} from "./types";

type RemoteMedia = { id: string; stream: MediaStream };

type FlinkState = {
  boot: "loading" | "auth" | "ready";
  view: AppView;
  profile: FlinkProfile | null;
  sim: FlinkSimFile | null;
  contacts: Contact[];
  threads: Thread[];
  messages: ChatMessage[];
  calls: CallLog[];
  groups: FlinkGroup[];
  activeThread: Thread | null;
  incoming: IncomingRequest | null;
  outgoing: { to: string; mode: CommMode; sessionId: string } | null;
  session: FlinkSession | null;
  callStatus: string;
  remoteMedia: RemoteMedia[];
  muted: boolean;
  videoOff: boolean;
  mailbox: SignalingSocket | null;
  busy: boolean;
  notice: string | null;

  bootApp: () => Promise<void>;
  createAccount: (password: string) => Promise<void>;
  continueDevice: () => Promise<void>;
  continuePassword: (number: string, password: string) => Promise<void>;
  continueSimFile: (file: File) => Promise<void>;
  downloadSim: () => void;
  logout: () => Promise<void>;
  setView: (view: AppView) => void;
  refreshGroups: () => Promise<void>;
  createGroup: (name: string, members: string[]) => Promise<void>;
  approach: (target: string, mode: CommMode) => Promise<void>;
  approachGroup: (group: FlinkGroup, mode: CommMode) => Promise<void>;
  acceptIncoming: () => Promise<void>;
  declineIncoming: () => void;
  cancelOutgoing: () => void;
  openThread: (thread: Thread) => Promise<void>;
  sendText: (text: string) => Promise<void>;
  sendImage: (file: File) => Promise<void>;
  hangup: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  startRoom: (mode: CommMode, title: string) => { id: string; url: string };
  upsertContact: (number: string, name?: string) => Promise<void>;
};

function deviceId() {
  const existing = localStorage.getItem("flink_device_id");
  if (existing && existing.length >= 8) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem("flink_device_id", id);
  return id;
}

function threadIdFor(number: string) {
  return `d-${number}`;
}

async function mediaFor(mode: CommMode) {
  if (mode === "chat" || mode === "ping") return undefined;
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: mode === "video" ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } : false,
  });
}

export const useFlink = create<FlinkState>((set, get) => ({
  boot: "loading",
  view: "home",
  profile: null,
  sim: null,
  contacts: [],
  threads: [],
  messages: [],
  calls: [],
  groups: [],
  activeThread: null,
  incoming: null,
  outgoing: null,
  session: null,
  callStatus: "",
  remoteMedia: [],
  muted: false,
  videoOff: false,
  mailbox: null,
  busy: false,
  notice: null,

  async bootApp() {
    try {
      await flinkStorage.migrateLegacyData();
      const profile = await flinkStorage.getProfile();
      const sim = await flinkStorage.getSim();
      const contacts = await flinkStorage.getContacts();
      const threads = await flinkStorage.getThreads();
      const calls = await flinkStorage.getCalls();
      if (profile?.accessToken) {
        try {
          await flinkApi.me(profile.accessToken);
          set({ profile, sim, contacts, threads, calls, boot: "ready" });
          await get().refreshGroups();
          startMailbox();
          void registerFlinkPush(profile.accessToken);
          return;
        } catch {
          if (profile.deviceId) {
            try {
              await get().continueDevice();
              return;
            } catch {
              /* fall through */
            }
          }
        }
      }
      set({ sim, contacts, threads, calls, boot: "auth" });
    } catch {
      set({ boot: "auth" });
    }
  },

  async createAccount(password) {
    set({ busy: true, notice: null });
    try {
      const device = deviceId();
      const simId = crypto.randomUUID();
      const res = await flinkApi.createAccount(password, device, simId);
      const profile: FlinkProfile = {
        flinkNumber: res.flink_number ?? "",
        deviceId: device,
        simId,
        accessToken: res.access_token,
        password,
        createdAt: Date.now(),
      };
      await flinkStorage.saveProfile(profile);
      let sim: FlinkSimFile | null = null;
      try {
        const signed = await flinkApi.signSim(profile.flinkNumber, simId, { device: "browser" });
        sim = {
          kind: "flink-sim",
          version: 1,
          payload: signed.payload,
          signature: signed.signature,
          algorithm: signed.algorithm,
          public_key: signed.public_key,
          password,
          deviceId: device,
          simId,
        };
        await flinkStorage.saveSim(sim);
      } catch {
        /* signing optional if keys missing */
      }
      set({ profile, sim, boot: "ready", busy: false, view: "you" });
      startMailbox();
      void registerFlinkPush(profile.accessToken);
      toast.success("Your Flink number is ready");
    } catch (err) {
      set({ busy: false, notice: err instanceof Error ? err.message : "Could not create account" });
      throw err;
    }
  },

  async continueDevice() {
    set({ busy: true, notice: null });
    try {
      const id = deviceId();
      const res = await flinkApi.continueDevice(id);
      const prev = await flinkStorage.getProfile();
      const profile: FlinkProfile = {
        flinkNumber: res.flink_number ?? prev?.flinkNumber ?? "",
        deviceId: id,
        simId: prev?.simId ?? id,
        accessToken: res.access_token,
        password: prev?.password,
        createdAt: prev?.createdAt ?? Date.now(),
      };
      await flinkStorage.saveProfile(profile);
      const sim = await flinkStorage.getSim();
      const contacts = await flinkStorage.getContacts();
      const threads = await flinkStorage.getThreads();
      const calls = await flinkStorage.getCalls();
      set({ profile, sim, contacts, threads, calls, boot: "ready", busy: false, view: "home" });
      startMailbox();
      void registerFlinkPush(profile.accessToken);
      await get().refreshGroups();
    } catch (err) {
      set({ busy: false, notice: err instanceof Error ? err.message : "This device is not registered" });
      throw err;
    }
  },

  async continuePassword(number, password) {
    set({ busy: true, notice: null });
    try {
      const res = await flinkApi.continuePassword(number, password);
      const device = deviceId();
      const profile: FlinkProfile = {
        flinkNumber: number,
        deviceId: device,
        simId: crypto.randomUUID(),
        accessToken: res.access_token,
        password,
        createdAt: Date.now(),
      };
      await flinkStorage.saveProfile(profile);
      set({ profile, boot: "ready", busy: false, view: "home" });
      startMailbox();
      void registerFlinkPush(profile.accessToken);
      await get().refreshGroups();
    } catch (err) {
      set({ busy: false, notice: err instanceof Error ? err.message : "Could not continue with password" });
      throw err;
    }
  },

  async continueSimFile(file) {
    set({ busy: true, notice: null });
    try {
      const parsed = JSON.parse(await file.text()) as Partial<FlinkSimFile> & {
        flinkNumber?: string;
        payload?: Record<string, unknown>;
        signature?: string;
        password?: string;
      };
      if (parsed.payload && parsed.signature) {
        const res = await flinkApi.continueSim(parsed.payload, parsed.signature);
        const device = deviceId();
        const profile: FlinkProfile = {
          flinkNumber: res.flink_number ?? String(parsed.payload.flink_number ?? ""),
          deviceId: parsed.deviceId ?? device,
          simId: parsed.simId ?? String(parsed.payload.sim_id ?? crypto.randomUUID()),
          accessToken: res.access_token,
          password: parsed.password,
          createdAt: Date.now(),
        };
        await flinkStorage.saveProfile(profile);
        await flinkStorage.saveSim({
          kind: "flink-sim",
          version: 1,
          payload: parsed.payload,
          signature: parsed.signature,
          algorithm: parsed.algorithm ?? "Ed25519",
          public_key: parsed.public_key,
          password: parsed.password,
          deviceId: profile.deviceId,
          simId: profile.simId,
        });
        set({ profile, sim: parsed as FlinkSimFile, boot: "ready", busy: false, view: "home" });
        startMailbox();
        void registerFlinkPush(profile.accessToken);
        await get().refreshGroups();
        return;
      }
      if (parsed.flinkNumber && parsed.password && /^\d{6}$/.test(parsed.flinkNumber)) {
        await get().continuePassword(parsed.flinkNumber, parsed.password);
        return;
      }
      throw new Error("This file is not a valid Flink SIM");
    } catch (err) {
      set({ busy: false, notice: err instanceof Error ? err.message : "Could not read SIM" });
      throw err;
    }
  },

  downloadSim() {
    const { sim, profile } = get();
    if (sim) {
      downloadJson(`flink-${profile?.flinkNumber ?? "sim"}.sim.json`, sim);
      return;
    }
    if (profile) {
      downloadJson(`flink-${profile.flinkNumber}.sim.json`, {
        kind: "flink-sim",
        version: 1,
        note: "Re-issue a signed SIM from this device after opening Flink.",
        flinkNumber: profile.flinkNumber,
        deviceId: profile.deviceId,
        simId: profile.simId,
        password: profile.password,
      });
    }
  },

  async logout() {
    get().mailbox?.close();
    get().session?.close();
    await flinkStorage.wipe();
    set({
      boot: "auth",
      profile: null,
      sim: null,
      session: null,
      mailbox: null,
      incoming: null,
      outgoing: null,
      view: "home",
      groups: [],
      threads: [],
      messages: [],
      contacts: [],
    });
  },

  setView(view) {
    set({ view });
  },

  async refreshGroups() {
    const token = get().profile?.accessToken;
    if (!token) return;
    try {
      const res = await flinkApi.listGroups(token);
      set({ groups: res.groups });
    } catch {
      /* groups optional */
    }
  },

  async createGroup(name, members) {
    const token = get().profile?.accessToken;
    if (!token) return;
    const res = await flinkApi.createGroup(token, name, members.filter((n) => /^\d{6}$/.test(n)));
    set({ groups: [res.group, ...get().groups] });
    toast.success("Group created");
  },

  async approach(target, mode) {
    const profile = get().profile;
    if (!profile) return;
    if (target === profile.flinkNumber) {
      toast.error("That is your own number");
      return;
    }
    if (!/^\d{6}$/.test(target)) {
      toast.error("Enter a six-digit Flink number");
      return;
    }
    const sid = sessionId("s");
    set({ busy: true, outgoing: { to: target, mode, sessionId: sid }, callStatus: "Approaching…" });
    try {
      await flinkApi.ping(profile.accessToken, target, mode, sid);
      void dropMailbox(
        target,
        {
          from: profile.flinkNumber,
          mode,
          session_id: sid,
        },
        profile.accessToken,
      );
      await get().upsertContact(target);
      const log: CallLog = {
        id: randomId(12),
        peer: target,
        mode,
        direction: "out",
        status: "calling",
        ts: Date.now(),
      };
      await flinkStorage.putCall(log);
      set({ calls: [log, ...get().calls], busy: false });
      await joinSession(sid, mode, target);
    } catch (err) {
      set({ busy: false, outgoing: null });
      toast.error(err instanceof Error ? err.message : "Could not send the request");
    }
  },

  async approachGroup(group, mode) {
    const profile = get().profile;
    if (!profile) return;
    const sid = sessionId("g");
    set({
      busy: true,
      outgoing: { to: group.name, mode, sessionId: sid },
      callStatus: `Approaching ${group.name}…`,
    });
    try {
      await flinkApi.groupPing(profile.accessToken, group.group_id, mode, sid);
      for (const member of group.members) {
        if (member !== profile.flinkNumber) {
          void dropMailbox(
            member,
            {
              from: profile.flinkNumber,
              mode,
              session_id: sid,
              group_id: group.group_id,
              group_name: group.name,
            },
            profile.accessToken,
          );
        }
      }
      set({ busy: false });
      await joinSession(sid, mode, group.name);
    } catch (err) {
      set({ busy: false, outgoing: null });
      toast.error(err instanceof Error ? err.message : "Could not ping the group");
    }
  },

  async acceptIncoming() {
    const incoming = get().incoming;
    if (!incoming) return;
    set({ incoming: null });
    await joinSession(incoming.sessionId, incoming.mode, incoming.from);
  },

  declineIncoming() {
    const incoming = get().incoming;
    set({ incoming: null });
    if (incoming) {
      const token = get().profile?.accessToken;
      void dropMailbox(incoming.from, { type: "declined", session_id: incoming.sessionId }, token);
    }
  },

  cancelOutgoing() {
    get().session?.close();
    set({ session: null, outgoing: null, remoteMedia: [], callStatus: "" });
  },

  async openThread(thread) {
    const messages = await flinkStorage.getMessages(thread.id);
    set({ activeThread: thread, messages, view: "chat" });
  },

  async sendText(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const thread = get().activeThread;
    const profile = get().profile;
    if (!thread || !profile) return;
    const msg: ChatMessage = {
      id: randomId(10),
      threadId: thread.id,
      from: profile.flinkNumber,
      kind: "text",
      text: trimmed,
      ts: Date.now(),
      mine: true,
    };
    await flinkStorage.putMessage(msg);
    const next = { ...thread, lastText: trimmed, lastTs: msg.ts };
    await flinkStorage.putThread(next);
    set({
      messages: [...get().messages, msg],
      threads: [next, ...get().threads.filter((t) => t.id !== next.id)],
      activeThread: next,
    });
    get().session?.sendChat({ kind: "text", text: trimmed, id: msg.id, ts: msg.ts });
  },

  async sendImage(file) {
    if (file.size > 180_000) {
      toast.error("Keep images under 180 KB for peer transfer");
      return;
    }
    const thread = get().activeThread;
    const profile = get().profile;
    if (!thread || !profile) return;
    const dataUrl = await fileToDataUrl(file);
    const msg: ChatMessage = {
      id: randomId(10),
      threadId: thread.id,
      from: profile.flinkNumber,
      kind: "image",
      imageUrl: dataUrl,
      ts: Date.now(),
      mine: true,
    };
    await flinkStorage.putMessage(msg);
    const next = { ...thread, lastText: "Photo", lastTs: msg.ts };
    await flinkStorage.putThread(next);
    set({
      messages: [...get().messages, msg],
      threads: [next, ...get().threads.filter((t) => t.id !== next.id)],
      activeThread: next,
    });
    get().session?.sendChat({ kind: "image", image: dataUrl, id: msg.id, ts: msg.ts });
  },

  hangup() {
    get().session?.close();
    set({ session: null, outgoing: null, incoming: null, remoteMedia: [], callStatus: "", muted: false, videoOff: false });
  },

  toggleMute() {
    const next = !get().muted;
    get().session?.mute(next);
    set({ muted: next });
  },

  toggleVideo() {
    const next = !get().videoOff;
    get().session?.setVideo(!next);
    set({ videoOff: next });
  },

  startRoom(mode, title) {
    const id = sessionId("r");
    const base = new URL(import.meta.env.BASE_URL, window.location.href).toString();
    const params = new URLSearchParams({ mode, title: title || "Room" });
    const url = `${base}#room/${encodeURIComponent(id)}?${params.toString()}`;
    return { id, url };
  },

  async upsertContact(number, name) {
    const existing = get().contacts.find((c) => c.flinkNumber === number);
    const contact: Contact = {
      flinkNumber: number,
      name: name || existing?.name || number,
      lastSeen: Date.now(),
    };
    await flinkStorage.putContact(contact);
    set({ contacts: [contact, ...get().contacts.filter((c) => c.flinkNumber !== number)] });
  },
}));

function startMailbox() {
  const { profile, mailbox } = useFlink.getState();
  if (!profile) return;
  mailbox?.close();
  const sock = new SignalingSocket(`mb-${profile.flinkNumber}`, profile.accessToken, {
    onEvent: (event) => {
      if (event.type !== "flink_request") return;
      const payload = (event.payload ?? {}) as {
        from?: string;
        mode?: CommMode;
        session_id?: string;
        group_id?: string;
        group_name?: string;
      };
      if (!payload.session_id || !payload.from) return;
      if (payload.from === profile.flinkNumber) return;
      useFlink.setState({
        incoming: {
          from: payload.from,
          mode: payload.mode ?? "ping",
          sessionId: payload.session_id,
          groupId: payload.group_id,
          groupName: payload.group_name,
        },
      });
    },
  });
  sock.connect();
  useFlink.setState({ mailbox: sock });
}

async function joinSession(sid: string, mode: CommMode, peerLabel: string) {
  const prev = useFlink.getState().session;
  prev?.close();
  let stream: MediaStream | undefined;
  try {
    stream = await mediaFor(mode);
  } catch {
    if (mode === "voice" || mode === "video") {
      toast.error("Camera or microphone was blocked");
      return;
    }
  }
  const session = new FlinkSession(sid, useFlink.getState().profile?.accessToken, mode, {
    onStatus: (text) => useFlink.setState({ callStatus: text }),
    onConnected: async () => {
      const number = /^\d{6}$/.test(peerLabel) ? peerLabel : undefined;
      if (number) {
        await useFlink.getState().upsertContact(number);
        const thread: Thread = {
          id: threadIdFor(number),
          kind: "direct",
          title: number,
          peerNumber: number,
          lastText: "Connected",
          lastTs: Date.now(),
        };
        await flinkStorage.putThread(thread);
        const messages = await flinkStorage.getMessages(thread.id);
        useFlink.setState((s) => ({
          threads: [thread, ...s.threads.filter((t) => t.id !== thread.id)],
          activeThread: s.activeThread ?? thread,
          messages: s.activeThread ? s.messages : messages,
          view: mode === "voice" || mode === "video" ? s.view : "chat",
        }));
      }
    },
    onChat: async (from, data) => {
      const number = /^\d{6}$/.test(from) ? from : peerLabel;
      const tid = threadIdFor(number);
      const msg: ChatMessage = {
        id: data.id,
        threadId: tid,
        from,
        kind: data.kind === "image" ? "image" : "text",
        text: data.text,
        imageUrl: data.image,
        ts: data.ts,
        mine: false,
      };
      await flinkStorage.putMessage(msg);
      const thread: Thread = {
        id: tid,
        kind: "direct",
        title: number,
        peerNumber: number,
        lastText: data.text || "Photo",
        lastTs: data.ts,
      };
      await flinkStorage.putThread(thread);
      useFlink.setState((s) => ({
        threads: [thread, ...s.threads.filter((t) => t.id !== tid)],
        messages: s.activeThread?.id === tid ? [...s.messages, msg] : s.messages,
      }));
    },
    onPeerMedia: (id, mediaStream) => {
      useFlink.setState((s) => ({
        remoteMedia: [...s.remoteMedia.filter((m) => m.id !== id), { id, stream: mediaStream }],
      }));
    },
    onPeerLeft: (id) => {
      useFlink.setState((s) => ({ remoteMedia: s.remoteMedia.filter((m) => m.id !== id) }));
    },
    onDeclined: () => {
      toast.message("They declined");
      useFlink.getState().hangup();
    },
  });
  await session.start(stream);
  useFlink.setState({
    session,
    outgoing: mode === "voice" || mode === "video" ? { to: peerLabel, mode, sessionId: sid } : useFlink.getState().outgoing,
    view: mode === "chat" || mode === "ping" ? "chat" : useFlink.getState().view,
  });
  if (mode === "chat" || mode === "ping") {
    const number = /^\d{6}$/.test(peerLabel) ? peerLabel : undefined;
    if (number) {
      const thread: Thread = {
        id: threadIdFor(number),
        kind: "direct",
        title: number,
        peerNumber: number,
        lastText: "Waiting…",
        lastTs: Date.now(),
      };
      await flinkStorage.putThread(thread);
      useFlink.setState((s) => ({
        activeThread: thread,
        threads: [thread, ...s.threads.filter((t) => t.id !== thread.id)],
        messages: [],
        view: "chat",
      }));
    }
  }
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

if (typeof window !== "undefined") {
  navigator.serviceWorker?.addEventListener("message", (event) => {
    const data = event.data as { type?: string; payload?: IncomingRequest & { session_id?: string; from?: string; mode?: CommMode } };
    if (data?.type !== "flink-push") return;
    const payload = data.payload;
    if (!payload) return;
    useFlink.setState({
      incoming: {
        from: payload.from,
        mode: payload.mode ?? "ping",
        sessionId: payload.sessionId ?? payload.session_id ?? "",
        groupId: payload.groupId,
        groupName: payload.groupName,
      },
    });
  });
}
