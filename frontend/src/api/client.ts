import { API_BASE, getWsUrl } from "../config";
import type { SystemSnapshot, TradingMoneyMode } from "../types";

export interface AppConfig {
  botMode: string;
  virtualStartingBalanceUsd: number;
  maxOrderSizeUsd: number;
  maxDailyLossUsd: number;
  minConfidence: number;
  clobConfigured: boolean;
  publicWallet: string | null;
  proxyWallet: string | null;
}

export async function fetchState(): Promise<SystemSnapshot> {
  const res = await fetch(`${API_BASE}/state`);
  if (!res.ok) throw new Error("Failed to load state");
  return res.json();
}

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch(`${API_BASE}/config`);
  if (!res.ok) throw new Error("Failed to load config");
  return res.json();
}

export async function fetchHistory(
  kind: string,
  limit = 100,
): Promise<unknown[]> {
  const res = await fetch(`${API_BASE}/history/${kind}?limit=${limit}`);
  if (!res.ok) return [];
  return res.json();
}

async function botAction(
  path: string,
  label: string,
): Promise<SystemSnapshot["bot"]> {
  console.log(`[bot] ${label} → POST ${API_BASE}${path}`);
  const res = await fetch(`${API_BASE}${path}`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) {
    console.error(`[bot] ${label} failed`, res.status, data);
    throw new Error(
      typeof data?.error === "string" ? data.error : `${label} failed (${res.status})`,
    );
  }
  console.log(`[bot] ${label} ok`, data);
  return data;
}

export async function botStart() {
  return botAction("/bot/start", "START");
}

export async function botPause() {
  return botAction("/bot/pause", "PAUSE");
}

export async function botStop() {
  return botAction("/bot/stop", "STOP");
}

export async function setBotMode(mode: TradingMoneyMode) {
  return fetch(`${API_BASE}/bot/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  }).then((r) => r.json());
}

export async function resetVirtualBalance() {
  return fetch(`${API_BASE}/bot/reset-virtual-balance`, {
    method: "POST",
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
