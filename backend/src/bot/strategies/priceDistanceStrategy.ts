import type { MarketState, SignalSide, StrategyVote } from "../../types/index.js";

const MIN_DISTANCE_PCT = 0.05;

export function priceDistanceStrategy(market: MarketState): StrategyVote {
  const pct = market.btc.distancePct;
  if (pct == null || market.btc.stale) {
    return {
      strategy: "price_distance",
      side: "NO_TRADE",
      score: 0,
      reason: "no_distance",
    };
  }

  if (Math.abs(pct) < MIN_DISTANCE_PCT) {
    return {
      strategy: "price_distance",
      side: "NO_TRADE",
      score: 0,
      reason: "below_min_distance",
    };
  }

  const side: SignalSide = pct > 0 ? "UP" : "DOWN";
  return {
    strategy: "price_distance",
    side,
    score: Math.min(1, Math.abs(pct) / 0.2),
    reason: "distance_threshold_met",
  };
}
