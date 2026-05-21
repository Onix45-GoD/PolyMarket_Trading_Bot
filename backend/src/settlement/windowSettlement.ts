import type { ActiveMarket, LastClosedWindowState } from "../types/index.js";
import { resetPairArbTradeState } from "../bot/pairArbTrade.js";
import { systemState } from "../state/systemState.js";
import { appendJsonl } from "../storage/jsonlWriter.js";
import { isVirtualMode } from "../bot/botMode.js";
import type { BotMode } from "../bot/botMode.js";
import {
  resolveWindowWinnerForMarket,
  type WindowWinner,
} from "./windowResolution.js";
import {
  clearInFlightSettlement,
  getInFlightSettlement,
  isWindowAlreadySettled,
  markWindowSettled,
  resetSettlementState,
  trackInFlightSettlement,
} from "./settlementGuard.js";

export type { WindowWinner };
export { resetSettlementState };

function hasOpenPaperPosition(): boolean {
  const { upShares, downShares } = systemState.position;
  return upShares > 0 || downShares > 0;
}

/**
 * Paper mode: pay $1 per winning share, credit balance, record realized P/L.
 * Idempotent per windowId (safe if market poll + window switch both trigger).
 */
export async function settlePaperWindow(
  closedMarket: ActiveMarket,
  btcStart: number | null,
  btcEnd: number | null,
): Promise<LastClosedWindowState | null> {
  if (!isVirtualMode(systemState.bot.mode as BotMode)) {
    return null;
  }

  const windowKey = closedMarket.conditionId;

  if (isWindowAlreadySettled(windowKey)) {
    return null;
  }

  const inFlight = getInFlightSettlement(windowKey);
  if (inFlight) {
    return inFlight;
  }

  const run = doSettlePaperWindow(closedMarket, btcStart, btcEnd);
  trackInFlightSettlement(windowKey, run);
  try {
    return await run;
  } finally {
    clearInFlightSettlement(windowKey);
  }
}

async function doSettlePaperWindow(
  closedMarket: ActiveMarket,
  btcStart: number | null,
  btcEnd: number | null,
): Promise<LastClosedWindowState | null> {
  const windowKey = closedMarket.conditionId;

  const snapshot = {
    upShares: systemState.position.upShares,
    downShares: systemState.position.downShares,
    exposureUsd: systemState.position.exposureUsd,
    windowId: systemState.position.windowId,
  };

  if (snapshot.upShares <= 0 && snapshot.downShares <= 0) {
    return null;
  }

  if (snapshot.windowId && snapshot.windowId !== windowKey) {
    console.warn(
      `[settlement] position window ${snapshot.windowId} != market ${windowKey}`,
    );
  }

  // Claim position immediately so parallel settlement calls see zero shares.
  systemState.patchPosition({
    upShares: 0,
    downShares: 0,
    exposureUsd: 0,
    windowId: null,
  });

  const resolved = await resolveWindowWinnerForMarket(
    closedMarket,
    btcStart,
    btcEnd,
  );
  if (!resolved) {
    systemState.patchPosition(snapshot);
    console.warn(
      `[settlement] ${closedMarket.slug} — cannot resolve winner (Gamma/CLOB/BTC unavailable)`,
    );
    return null;
  }

  const { winner, source, upPrice, downPrice } = resolved;
  const { upShares, downShares, exposureUsd } = snapshot;

  const upPayout = winner === "UP" ? upShares : 0;
  const downPayout = winner === "DOWN" ? downShares : 0;
  const payoutUsd = upPayout + downPayout;
  const costUsd = exposureUsd;
  const profitUsd = payoutUsd - costUsd;
  const closedAt = new Date().toISOString();

  systemState.patchVirtualAccount({
    balanceUsd: systemState.virtualAccount.balanceUsd + payoutUsd,
  });
  systemState.patchPnl({
    realized: systemState.pnl.realized + profitUsd,
    daily: systemState.pnl.daily + profitUsd,
    unrealized: 0,
  });

  markWindowSettled(windowKey);

  const lastClosed: LastClosedWindowState = {
    windowId: windowKey,
    slug: closedMarket.slug,
    winner,
    upShares,
    downShares,
    payoutUsd,
    costUsd,
    profitUsd,
    btcStart,
    btcEnd,
    closedAt,
    resolutionSource: source,
    upPrice,
    downPrice,
  };

  systemState.lastClosedWindow = lastClosed;
  systemState.windowsCompleted += 1;
  resetPairArbTradeState();

  const priceHint =
    source === "gamma" || source === "clob"
      ? ` | UP=${upPrice?.toFixed(2) ?? "—"} DOWN=${downPrice?.toFixed(2) ?? "—"} (${source})`
      : ` | BTC ${btcStart?.toFixed(2)} → ${btcEnd?.toFixed(2)}`;

  console.log(
    `[settlement] ${closedMarket.slug} closed → ${winner} wins | payout=$${payoutUsd.toFixed(2)} cost=$${costUsd.toFixed(2)} profit=$${profitUsd.toFixed(2)}${priceHint}`,
  );

  try {
    await appendJsonl("settlements", lastClosed);
  } catch (err) {
    console.warn(
      "[settlement] failed to write settlements.jsonl:",
      err instanceof Error ? err.message : err,
    );
  }

  return lastClosed;
}

/** Settle if paper position exists for the market that just ended. */
export async function settlePaperWindowIfNeeded(
  closedMarket: ActiveMarket,
  btcStart: number | null,
  btcEnd: number | null,
): Promise<void> {
  if (!hasOpenPaperPosition()) return;
  await settlePaperWindow(closedMarket, btcStart, btcEnd);
}

/** Settle when endDate passed but Gamma still returns same market id. */
export async function maybeSettleExpiredPaperWindow(): Promise<void> {
  const market = systemState.market.market;
  if (!market || !isVirtualMode(systemState.bot.mode as BotMode)) return;
  if (!hasOpenPaperPosition()) return;
  if (systemState.position.windowId !== market.conditionId) return;

  const endMs = new Date(market.endDate).getTime();
  if (Date.now() < endMs) return;

  const btc = systemState.market.btc;
  await settlePaperWindow(market, btc.startPrice, btc.price);
}
