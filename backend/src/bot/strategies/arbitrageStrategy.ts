import type { MarketState, SignalSide, StrategyVote } from "../../types/index.js";

export function arbitrageStrategy(market: MarketState): StrategyVote {
  const upAsk = market.upBook?.bestAsk;
  const downAsk = market.downBook?.bestAsk;

  if (upAsk == null || downAsk == null) {
    return {
      strategy: "arbitrage",
      side: "NO_TRADE",
      score: 0,
      reason: "incomplete_books",
    };
  }

  const sum = upAsk + downAsk;
  if (sum < 0.98) {
    return {
      strategy: "arbitrage",
      side: "UP",
      score: Math.min(1, (1 - sum) * 5),
      reason: `arb_sum_asks_${sum.toFixed(3)}`,
    };
  }

  return {
    strategy: "arbitrage",
    side: "NO_TRADE",
    score: 0,
    reason: "no_arb",
  };
}
