import { env } from "../config/env.js";
import { executePairBuy } from "../execution/executionEngine.js";
import { hasOpenLiveOrders } from "../execution/liveOrderTracker.js";
import { evaluatePairRisk } from "../risk/riskManager.js";
import { systemState } from "../state/systemState.js";
import { isVirtualMode } from "./botMode.js";
import type { BotMode } from "./botMode.js";
import type { PairArbDecision } from "./pairArb.js";

function botIsActive(): boolean {
  const { status, enabled } = systemState.bot;
  return status === "running" && enabled;
}

/** Why the bot will not execute this snapshot. */
export function resolveSkipReason(decision: PairArbDecision): string {
  if (!botIsActive()) {
    return "bot_stopped";
  }
  if (systemState.activeSession().pnl.daily <= -env.MAX_DAILY_LOSS_USD) {
    return "max_daily_loss";
  }
  if (decision.action === "IDLE") {
    return decision.reason;
  }
  const risk = evaluatePairRisk(decision.action);
  if (!risk.approved) {
    return risk.reason;
  }
  return "ok";
}

/** Min ms between successful pair buys in the same window (multiple buys allowed). */
let lastBuyAtMs = 0;

export function resetPairArbTradeState(): void {
  lastBuyAtMs = 0;
}

/**
 * Execute pair buy when the bot is on and the book shows BUY_PAIR.
 * May run many times per 5m window; each trade size <= MAX_PAIR_ORDER_SIZE.
 */
export async function executePairArbDecision(
  decision: PairArbDecision,
  source: "market" | "tick",
): Promise<void> {
  if (decision.action !== "BUY_PAIR") {
    return;
  }

  const skip = resolveSkipReason(decision);
  if (skip !== "ok") {
    return;
  }

  const cooldownMs = env.PAIR_BUY_COOLDOWN_MS;
  if (Date.now() - lastBuyAtMs < cooldownMs) {
    return;
  }

  const market = systemState.market;
  const slug = market.market?.slug ?? "no-market";
  const at = new Date().toISOString();
  const mode = systemState.bot.mode as BotMode;
  const simulated = isVirtualMode(mode);

  if (
    !simulated &&
    env.LIVE_BLOCK_WHILE_OPEN &&
    hasOpenLiveOrders()
  ) {
    return;
  }

  console.log(
    `[bot] ${source} ${at} ${slug} → BUY_PAIR x${decision.size} (mode=${mode}, maxPerTrade=${env.MAX_PAIR_ORDER_SIZE})`,
  );

  const result = await executePairBuy(decision.size, simulated);
  if (result?.ok) {
    lastBuyAtMs = Date.now();
    console.log(
      `[bot] BUY_PAIR ok ${result.pairId} x${decision.size} UP@${market.upBook?.bestBid} DOWN@${market.downBook?.bestBid} | held UP=${systemState.activeSession().position.upShares} DOWN=${systemState.activeSession().position.downShares}`,
    );
    return;
  }

  console.log(
    `[bot] BUY_PAIR failed x${decision.size} (balance, books, or CLOB client)`,
  );
}
