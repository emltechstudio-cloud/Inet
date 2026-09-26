import { urlBase64ToUint8Array } from "@/lib/utils";
import { flinkApi } from "./api";

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
