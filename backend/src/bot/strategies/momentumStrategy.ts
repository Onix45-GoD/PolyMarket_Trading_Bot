import type { MarketState, SignalSide, StrategyVote } from "../../types/index.js";

export function momentumStrategy(market: MarketState): StrategyVote {
  const pct = market.btc.distancePct;
  if (pct == null || market.btc.stale) {
    return {
      strategy: "momentum",
      side: "NO_TRADE",
      score: 0,
      reason: "no_momentum_data",
    };
  }

  if (Math.abs(pct) < 0.02) {
    return {
      strategy: "momentum",
      side: "NO_TRADE",
      score: 0,
      reason: "weak_momentum",
    };
  }

  const side: SignalSide = pct > 0 ? "UP" : "DOWN";
  return {
    strategy: "momentum",
    side,
    score: Math.min(1, Math.abs(pct) / 0.1),
    reason: "btc_momentum",
  };
}
