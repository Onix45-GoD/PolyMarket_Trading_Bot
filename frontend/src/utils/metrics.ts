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

export interface PairPositionMetrics {
  matched: number;
  unmatched: number;
  balanced: boolean;
  /** Total $ paid for pairs (UP+DOWN legs). */
  exposureUsd: number;
  /** Average buy sum per matched share-pair (exposure / matched). */
  avgBuySum: number | null;
  /** When UP and DOWN held equally: profit is the same whichever side wins. */
  settlementPnl: number | null;
  pnlIfUpWins: number | null;
  pnlIfDownWins: number | null;
}

/** P/L for pair-arb: matched pairs settle at $1 total payout per pair. */
export function pairPositionMetrics(
  snap: SystemSnapshot | null,
): PairPositionMetrics | null {
  if (!snap) return null;
  const { upShares, downShares, exposureUsd } = snap.position;
  const matched = Math.min(upShares, downShares);
  const unmatched = Math.abs(upShares - downShares);
  const balanced = unmatched === 0;

  const avgBuySum =
    matched > 0 && exposureUsd > 0 ? exposureUsd / matched : null;

  const pnlIfUpWins =
    upShares > 0 || exposureUsd > 0 ? upShares * 1 - exposureUsd : 0;
  const pnlIfDownWins =
    downShares > 0 || exposureUsd > 0 ? downShares * 1 - exposureUsd : 0;

  const settlementPnl =
    matched > 0 && balanced
      ? matched * 1 - exposureUsd
      : matched > 0
        ? null
        : exposureUsd > 0
          ? null
          : 0;

  return {
    matched,
    unmatched,
    balanced,
    exposureUsd,
    avgBuySum,
    settlementPnl,
    pnlIfUpWins,
    pnlIfDownWins,
  };
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
