import { computeAskSum, computeBuySum, evaluatePairArb } from "../bot/pairArb.js";
import { executePairArbDecision, resolveSkipReason } from "../bot/pairArbTrade.js";
import { systemState } from "../state/systemState.js";
import type { PairArbState } from "../types/index.js";
import { formatBookPrices } from "./bookFormat.js";

/**
 * Log book snapshot and run buy execution when the bot is on.
 * Runs on every CLOB book refresh.
 */
export function logPairArbSnapshot(): void {
  const market = systemState.market;
  const m = market.market;
  const slug = m?.slug ?? "no-market";
  const at = new Date().toISOString();

  if (!m || !market.upBook || !market.downBook) {
    console.log(
      `[market] ${at} ${slug} — no book data → skip (no_market_or_books)`,
    );
    return;
  }

  const decision = evaluatePairArb(market, systemState.tradingBalanceUsd());

  const pairArb: PairArbState = {
    action: decision.action,
    sum: decision.sum,
    buySum: computeBuySum(market),
    askSum: decision.askSum ?? computeAskSum(market),
    size: decision.size,
    reason: decision.reason,
    timestamp: at,
  };
  systemState.patchBot({ pairArb, lastTickAt: at });

  const skip = resolveSkipReason(decision);
  const prices = formatBookPrices(market);

  if (decision.action === "BUY_PAIR" && skip === "ok") {
    console.log(
      `[market] ${at} ${slug} ${prices} signal=BUY_PAIR size=${decision.size} [arb: ${decision.reason}]`,
    );
    void executePairArbDecision(decision, "market");
    return;
  }

  // console.log(
  //   `[market] ${at} ${slug} ${prices} action=${decision.action} size=${decision.size} → skip (${skip}) [arb: ${decision.reason}]`,
  // );
}
