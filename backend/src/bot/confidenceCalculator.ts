import type { BotSignal, SignalSide, StrategyVote } from "../types/index.js";
import { directionStrategy } from "./strategies/directionStrategy.js";
import { momentumStrategy } from "./strategies/momentumStrategy.js";
import { priceDistanceStrategy } from "./strategies/priceDistanceStrategy.js";
import { lateWindowStrategy } from "./strategies/lateWindowStrategy.js";
import { arbitrageStrategy } from "./strategies/arbitrageStrategy.js";
import type { MarketState } from "../types/index.js";

const WEIGHTS: Record<string, number> = {
  direction: 0.25,
  momentum: 0.2,
  price_distance: 0.2,
  late_window: 0.2,
  arbitrage: 0.15,
};

function runAll(market: MarketState): StrategyVote[] {
  return [
    directionStrategy(market),
    momentumStrategy(market),
    priceDistanceStrategy(market),
    lateWindowStrategy(market),
    arbitrageStrategy(market),
  ];
}

export function calculateSignal(market: MarketState): BotSignal {
  const votes = runAll(market);
  const scores: Record<SignalSide, number> = {
    UP: 0,
    DOWN: 0,
    NO_TRADE: 0,
  };

  let totalWeight = 0;
  for (const v of votes) {
    if (v.side === "NO_TRADE") continue;
    const w = WEIGHTS[v.strategy] ?? 0.1;
    scores[v.side] += v.score * w;
    totalWeight += w;
  }

  const up = scores.UP;
  const down = scores.DOWN;
  let side: SignalSide = "NO_TRADE";
  let confidence = 0;

  if (up > down && up > 0) {
    side = "UP";
    confidence = totalWeight > 0 ? up / totalWeight : 0;
  } else if (down > up && down > 0) {
    side = "DOWN";
    confidence = totalWeight > 0 ? down / totalWeight : 0;
  }

  return {
    side,
    confidence,
    votes,
    timestamp: new Date().toISOString(),
  };
}
