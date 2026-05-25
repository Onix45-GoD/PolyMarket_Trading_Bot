import { env } from "../config/env.js";
import { executePairBuy } from "../execution/executionEngine.js";
import { hasOpenLiveOrders } from "../execution/liveOrderTracker.js";
import { evaluatePairRisk } from "../risk/riskManager.js";
import { systemState } from "../state/systemState.js";
import { getRuntimeBotMode, isVirtualMode } from "./botMode.js";
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
/** Prevent overlapping live pair posts (market poll + tick used to fire 3–4 at once). */
let livePairInFlight = false;

export function resetPairArbTradeState(): void {
  lastBuyAtMs = 0;
  livePairInFlight = false;
}

/**
 * Execute pair buy when the bot is on and the book shows BUY_PAIR.
 * Buys at ask prices (taking liquidity) when ask sum <= threshold.
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
  const mode = getRuntimeBotMode();
  const simulated = isVirtualMode(mode);

  if (!simulated) {
    if (livePairInFlight) {
      return;
    }
    if (env.LIVE_BLOCK_WHILE_OPEN && hasOpenLiveOrders()) {
      return;
    }
    livePairInFlight = true;
    lastBuyAtMs = Date.now();
  }

  console.log(
    `[bot] ${source} ${at} ${slug} → BUY_PAIR x${decision.size} (mode=${mode}, ${simulated ? "PAPER/simulated" : "LIVE/CLOB — watch [clob-req]"}, maxPerTrade=${env.MAX_PAIR_ORDER_SIZE})`,
  );

  let result: Awaited<ReturnType<typeof executePairBuy>>;
  try {
    result = await executePairBuy(decision.size, simulated);
  } finally {
    if (!simulated) {
      livePairInFlight = false;
    }
  }
  if (result?.ok) {
    lastBuyAtMs = Date.now();
    console.log(
      `[bot] BUY_PAIR ok ${result.pairId} x${decision.size} UP@${market.upBook?.bestBid} DOWN@${market.downBook?.bestBid} | held UP=${systemState.activeSession().position.upShares} DOWN=${systemState.activeSession().position.downShares}`,
    );
    return;
  }

  const detail = simulated
    ? "(balance, books, or CLOB client)"
    : "(pair not fully filled, rejected, or CLOB error — see LIVE_PAIR_INCOMPLETE)";
  console.log(`[bot] BUY_PAIR failed x${decision.size} ${detail}`);
}
