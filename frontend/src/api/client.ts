import { API_BASE, getWsUrl } from "../config";
import type { SystemSnapshot, TradingMoneyMode } from "../types";

export interface AppConfig {
  botMode: string;
  virtualStartingBalanceUsd: number;
  maxPairOrderSize: number;
  maxDailyLossUsd: number;
  slippage: number;
  botTickMs: number;
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

async function uiAction<T>(
  path: string,
  label: string,
  init?: RequestInit,
): Promise<T> {
  console.log(`[ui] ${label} → POST ${API_BASE}${path}`);
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", ...init });
  const data = await res.json();
  if (!res.ok) {
    console.error(`[ui] ${label} failed`, res.status, data);
    throw new Error(
      typeof data?.error === "string" ? data.error : `${label} failed (${res.status})`,
    );
  }
  console.log(`[ui] ${label} ok`, data);
  return data as T;
}

export async function setBotMode(mode: TradingMoneyMode) {
  return uiAction<SystemSnapshot["bot"]>("/bot/mode", `MODE → ${mode}`, {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
}

export async function resetVirtualBalance() {
  return uiAction<{ balanceUsd: number }>(
    "/bot/reset-virtual-balance",
    "RESET paper balance",
  );
}

export interface CancelAllOrdersResult {
  ok: boolean;
  mode?: string;
  trackedCancelled?: number;
  ordersMarkedCancelled?: number;
  clob?: unknown;
  error?: string;
}

export async function cancelAllOrders(): Promise<CancelAllOrdersResult> {
  return uiAction<CancelAllOrdersResult>(
    "/orders/cancel-all",
    "CANCEL ALL orders",
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
