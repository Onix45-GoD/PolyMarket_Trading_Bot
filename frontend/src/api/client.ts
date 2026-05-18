import { API_BASE, getWsUrl } from "../config";
import type { SystemSnapshot } from "../types";

export async function fetchState(): Promise<SystemSnapshot> {
  const res = await fetch(`${API_BASE}/state`);
  if (!res.ok) throw new Error("Failed to load state");
  return res.json();
}

export async function botStart() {
  return fetch(`${API_BASE}/bot/start`, { method: "POST" }).then((r) =>
    r.json(),
  );
}

export async function botPause() {
  return fetch(`${API_BASE}/bot/pause`, { method: "POST" }).then((r) =>
    r.json(),
  );
}

export async function botStop() {
  return fetch(`${API_BASE}/bot/stop`, { method: "POST" }).then((r) => r.json());
}

export async function setBotMode(mode: "dry-run" | "live") {
  return fetch(`${API_BASE}/bot/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  }).then((r) => r.json());
}

export async function cancelAllOrders() {
  return fetch(`${API_BASE}/orders/cancel-all`, { method: "POST" }).then((r) =>
    r.json(),
  );
}

export function connectWs(
  onMessage: (snap: SystemSnapshot) => void,
): () => void {
  const ws = new WebSocket(getWsUrl());

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === "market.state" && msg.payload) {
        onMessage(msg.payload as SystemSnapshot);
      }
    } catch {
      /* ignore */
    }
  };

  return () => ws.close();
}
