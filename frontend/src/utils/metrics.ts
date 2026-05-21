import type { SystemSnapshot } from "../types";
import {
  displayOrderCost,
  groupOrdersForDisplay,
  isDisplayOrderFilled,
} from "./groupPairOrders";

export function pairCost(snap: SystemSnapshot | null): number | null {
  const up = snap?.market.upBook?.mid;
  const down = snap?.market.downBook?.mid;
  if (up == null || down == null) return null;
  return up + down;
}

export function windowProgress(market: {
  windowStartUnix: number;
  endDate: string;
} | null): { pct: number; remainingSec: number; endLabel: string } {
  if (!market) {
    return { pct: 0, remainingSec: 0, endLabel: "—" };
  }
  const start = market.windowStartUnix * 1000;
  const end = new Date(market.endDate).getTime();
  const now = Date.now();
  const total = Math.max(1, end - start);
  const pct = Math.min(100, Math.max(0, ((now - start) / total) * 100));
  const remainingSec = Math.max(0, Math.floor((end - now) / 1000));
  const endLabel = new Date(market.endDate).toLocaleTimeString();
  return { pct, remainingSec, endLabel };
}

export function pnlIfSideWins(
  snap: SystemSnapshot | null,
  side: "UP" | "DOWN",
): number | null {
  if (!snap) return null;
  const shares =
    side === "UP" ? snap.position.upShares : snap.position.downShares;
  const payout = shares * 1;
  return payout - snap.position.exposureUsd;
}

export function history24hSummary(orders: SystemSnapshot["orders"]) {
  const rows = groupOrdersForDisplay(orders);
  const filled = rows.filter(isDisplayOrderFilled);
  const spent = filled.reduce((s, o) => s + displayOrderCost(o), 0);
  return {
    orders: filled.length,
    spent,
    payout: 0,
    net: -spent,
  };
}
