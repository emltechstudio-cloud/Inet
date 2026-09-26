import { FLINK_API_URL } from "./config";
import type { CommMode, FlinkGroup } from "./types";

export class FlinkApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function detailMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (typeof d === "object" && d && "msg" in d ? String((d as { msg: string }).msg) : String(d)))
      .join(", ");
  }
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(`${FLINK_API_URL}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? ctrl.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { detail: text };
      }
    }
    if (!res.ok) {
      throw new FlinkApiError(res.status, detailMessage(json, `Request failed (${res.status})`));
    }
    return json as T;
  } catch (err) {
    if (err instanceof FlinkApiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new FlinkApiError(408, "Flink is taking too long to wake. Try again.");
    }
    throw new FlinkApiError(0, "Could not reach Flink. Check your connection.");
  } finally {
    clearTimeout(timer);
  }
}

export type TokenResponse = {
  success: boolean;
  access_token: string;
  token_type: string;
  flink_number?: string;
};

export const flinkApi = {
  health() {
    return request<{
      success: boolean;
      service: string;
      protocol: number;
      store_ok: boolean;
      users: number;
    }>("/flink/health");
  },

  createAccount(password: string, deviceId: string, simId: string) {
    return request<TokenResponse>("/flink/account", {
      method: "POST",
      body: JSON.stringify({ password, device_id: deviceId, sim_id: simId }),
    });
  },

  continuePassword(flinkNumber: string, password: string) {
    return request<TokenResponse>("/flink/continue/password", {
      method: "POST",
      body: JSON.stringify({ flink_number: flinkNumber, password }),
    });
  },

  continueDevice(deviceId: string) {
    return request<TokenResponse>("/flink/continue/device", {
      method: "POST",
      body: JSON.stringify({ device_id: deviceId }),
    });
  },

  continueSim(payload: Record<string, unknown>, signature: string) {
    return request<TokenResponse>("/flink/continue/sim", {
      method: "POST",
      body: JSON.stringify({ payload, signature }),
    });
  },

  simPublicKey() {
    return request<{ success: boolean; algorithm: string; public_key: string }>("/flink/sim/public-key");
  },

  signSim(flinkNumber: string, simId: string, metadata: Record<string, string> = {}) {
    return request<{
      success: boolean;
      payload: Record<string, unknown>;
      signature: string;
      algorithm: string;
      public_key: string;
    }>("/flink/sim/sign", {
      method: "POST",
      body: JSON.stringify({ flink_number: flinkNumber, sim_id: simId, metadata }),
    });
  },

  me(token: string) {
    return request<{ success: boolean; flink_number: string; created_at: string }>("/flink/me", {}, token);
  },

  pushPublicKey() {
    return request<{ success: boolean; public_key: string }>("/flink/push/public-key");
  },

  registerPush(
    token: string,
    subscription: { endpoint: string; keys?: Record<string, string>; expirationTime?: number | null },
  ) {
    return request<{ success: boolean }>(
      "/flink/push/subscribe",
      { method: "POST", body: JSON.stringify(subscription) },
      token,
    );
  },

  listGroups(token: string) {
    return request<{ success: boolean; groups: FlinkGroup[] }>("/flink/groups", {}, token);
  },

  createGroup(token: string, name: string, memberNumbers: string[] = []) {
    return request<{ success: boolean; group: FlinkGroup }>(
      "/flink/groups",
      { method: "POST", body: JSON.stringify({ name, member_numbers: memberNumbers }) },
      token,
    );
  },

  addGroupMembers(token: string, groupId: string, memberNumbers: string[]) {
    return request<{ success: boolean; group: FlinkGroup }>(
      `/flink/groups/${encodeURIComponent(groupId)}/members`,
      { method: "POST", body: JSON.stringify({ member_numbers: memberNumbers }) },
      token,
    );
  },

  removeGroupMember(token: string, groupId: string, flinkNumber: string) {
    return request<{ success: boolean; group: FlinkGroup }>(
      `/flink/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(flinkNumber)}`,
      { method: "DELETE" },
      token,
    );
  },

  ping(token: string, target: string, mode: CommMode, sessionId: string) {
    return request<{
      success: boolean;
      session_id: string;
      notifications_sent: number;
    }>(
      "/flink/ping",
      {
        method: "POST",
        body: JSON.stringify({
          target_flink_number: target,
          mode,
          session_id: sessionId,
        }),
      },
      token,
    );
  },

  groupPing(token: string, groupId: string, mode: CommMode, sessionId: string) {
    return request<{ success: boolean; session_id: string; notifications_sent: number }>(
      "/flink/group-ping",
      {
        method: "POST",
        body: JSON.stringify({ group_id: groupId, mode, session_id: sessionId }),
      },
      token,
    );
  },
};
