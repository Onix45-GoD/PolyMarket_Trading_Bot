import { env } from "../config/env.js";
import { systemState } from "../state/systemState.js";
import type { BotSignal, MarketState } from "../types/index.js";

export interface RiskResult {
  approved: boolean;
  reason: string;
}

export function evaluateRisk(
  signal: BotSignal,
  market: MarketState,
): RiskResult {
  if (signal.side === "NO_TRADE") {
    return { approved: false, reason: "no_trade_signal" };
  }

  if (signal.confidence < env.MIN_CONFIDENCE) {
    return { approved: false, reason: "low_confidence" };
  }

  if (market.btc.stale) {
    return { approved: false, reason: "stale_btc_feed" };
  }

  const book = signal.side === "UP" ? market.upBook : market.downBook;
  if (!book?.bestAsk || !book.bestBid) {
    return { approved: false, reason: "missing_liquidity" };
  }

  if (book.bestAsk - book.bestBid > 0.08) {
    return { approved: false, reason: "spread_too_wide" };
  }

  const m = market.market;
  if (m && new Date(m.endDate).getTime() - Date.now() < 10_000) {
    return { approved: false, reason: "too_close_to_expiry" };
  }

  if (systemState.pnl.daily <= -env.MAX_DAILY_LOSS_USD) {
    return { approved: false, reason: "max_daily_loss" };
  }

  return { approved: true, reason: "ok" };
}
