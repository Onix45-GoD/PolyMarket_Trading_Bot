import type { MarketState, SignalSide, StrategyVote } from "../../types/index.js";

export function directionStrategy(market: MarketState): StrategyVote {
  const { btc } = market;
  if (!btc.startPrice || btc.stale || btc.price <= 0) {
    return {
      strategy: "direction",
      side: "NO_TRADE",
      score: 0,
      reason: "btc_unavailable",
    };
  }

  const diff = btc.price - btc.startPrice;
  const threshold = btc.startPrice * 0.0001;

  if (Math.abs(diff) < threshold) {
    return {
      strategy: "direction",
      side: "NO_TRADE",
      score: 0,
      reason: "btc_at_start",
    };
  }

  const side: SignalSide = diff > 0 ? "UP" : "DOWN";
  const score = Math.min(1, Math.abs(btc.distancePct ?? 0) / 0.15);

  return {
    strategy: "direction",
    side,
    score,
    reason: `btc_${diff > 0 ? "above" : "below"}_start`,
  };
}
