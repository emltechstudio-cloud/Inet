import { urlBase64ToUint8Array } from "@/lib/utils";
import { flinkApi } from "./api";

let notificationInterval: ReturnType<typeof setInterval> | null = null;
const pendingNotifications = new Set<string>();

export async function registerFlinkPush(token: string, requestPermission = false) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return false;
  }
  try {
    let permission = Notification.permission;
    if (permission === "default" && requestPermission) permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    });
    await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) return true;
    const { public_key } = await flinkApi.pushPublicKey();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(public_key),
    });
    const json = sub.toJSON();
    await flinkApi.registerPush(token, {
      endpoint: json.endpoint ?? sub.endpoint,
      keys: (json.keys as Record<string, string> | undefined) ?? {},
      expirationTime: json.expirationTime ?? null,
    });
    return true;
  } catch {
    return false;
  }
}

export function showPersistentNotification(title: string, body: string, tag: string, data?: Record<string, unknown>) {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return;
  }
  if (Notification.permission !== "granted") {
    return;
  }
  if (pendingNotifications.has(tag)) {
    return;
  }
  pendingNotifications.add(tag);
  navigator.serviceWorker.ready.then((reg) => {
    const options: NotificationOptions = {
      body,
      tag,
      data,
      icon: "icon.svg",
    };
    reg.showNotification(title, options);
  });
  notificationInterval = setInterval(() => {
    if (!pendingNotifications.has(tag)) {
      if (notificationInterval) {
        clearInterval(notificationInterval);
        notificationInterval = null;
      }
      return;
    }
    navigator.serviceWorker.ready.then((reg) => {
      const options: NotificationOptions = {
        body,
        tag,
        data,
        icon: "icon.svg",
      };
      reg.showNotification(title, options);
    });
  }, 30000);
}

export function dismissPersistentNotification(tag: string) {
  pendingNotifications.delete(tag);
  if (notificationInterval) {
    clearInterval(notificationInterval);
    notificationInterval = null;
  }
}

export function notifyIncomingCall(from: string, mode: string) {
  showPersistentNotification(
    `Incoming ${mode === "voice" ? "Call" : "Video Call"} from Inet`,
    `This is a call from Inet: ${from} wants to connect`,
    `call-${from}-${Date.now()}`,
    { type: "call", from, mode, ts: Date.now() }
  );
}

export function notifyNewMessage(from: string, text: string) {
  showPersistentNotification(
    "New Message from Inet",
    `This is a message from Inet: ${text.slice(0, 50)}${text.length > 50 ? "..." : ""}`,
    `msg-${from}-${Date.now()}`,
    { type: "message", from, text, ts: Date.now() }
  );
}
