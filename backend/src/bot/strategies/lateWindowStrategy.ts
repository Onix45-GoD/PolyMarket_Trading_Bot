import type { MarketState, SignalSide, StrategyVote } from "../../types/index.js";

export function lateWindowStrategy(market: MarketState): StrategyVote {
  const m = market.market;
  if (!m) {
    return {
      strategy: "late_window",
      side: "NO_TRADE",
      score: 0,
      reason: "no_market",
    };
  }

  const msLeft = new Date(m.endDate).getTime() - Date.now();
  if (msLeft > 60_000 || msLeft < 0) {
    return {
      strategy: "late_window",
      side: "NO_TRADE",
      score: 0,
      reason: "outside_late_window",
    };
  }

  const pct = market.btc.distancePct;
  if (pct == null || Math.abs(pct) < 0.03) {
    return {
      strategy: "late_window",
      side: "NO_TRADE",
      score: 0,
      reason: "uncertain_late",
    };
  }

  const side: SignalSide = pct > 0 ? "UP" : "DOWN";
  return {
    strategy: "late_window",
    side,
    score: 0.85,
    reason: "late_window_confident",
  };
}
