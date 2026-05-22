import type { ActiveMarket, LastClosedWindowState } from "../types/index.js";
import { resetPairArbTradeState } from "../bot/pairArbTrade.js";
import { systemState } from "../state/systemState.js";
import { appendJsonl } from "../storage/jsonlWriter.js";
import { getRuntimeBotMode, isVirtualMode } from "../bot/botMode.js";
import { env } from "../config/env.js";
import { redeemLiveCondition } from "./liveRedeem.js";
import {
  isMarketReadyToRedeem,
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

function paperPosition() {
  return systemState.paper.position;
}

function hasOpenPaperPosition(): boolean {
  const { upShares, downShares } = paperPosition();
  return upShares > 0 || downShares > 0;
}

function livePosition() {
  return systemState.live.position;
}

function hasOpenLivePosition(): boolean {
  const { upShares, downShares } = livePosition();
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
  if (!isVirtualMode(getRuntimeBotMode())) {
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

  const snapshot = { ...paperPosition() };

  if (snapshot.upShares <= 0 && snapshot.downShares <= 0) {
    return null;
  }

  if (snapshot.windowId && snapshot.windowId !== windowKey) {
    console.warn(
      `[settlement] position window ${snapshot.windowId} != market ${windowKey}`,
    );
  }

  // Claim position immediately so parallel settlement calls see zero shares.
  systemState.patchPosition(
    {
      upShares: 0,
      downShares: 0,
      exposureUsd: 0,
      windowId: null,
    },
    "paper",
  );

  const resolved = await resolveWindowWinnerForMarket(
    closedMarket,
    btcStart,
    btcEnd,
  );
  if (!resolved) {
    systemState.patchPosition(snapshot, "paper");
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
  const paperPnl = systemState.paper.pnl;
  systemState.patchPnl(
    {
      realized: paperPnl.realized + profitUsd,
      daily: paperPnl.daily + profitUsd,
      unrealized: 0,
    },
    "paper",
  );

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

  systemState.setLastClosedWindow(lastClosed, "paper");
  systemState.incrementWindowsCompleted("paper");
  resetPairArbTradeState();

  const priceHint =
    source === "gamma" || source === "clob"
      ? ` | UP=${upPrice?.toFixed(2) ?? "—"} DOWN=${downPrice?.toFixed(2) ?? "—"} (${source})`
      : ` | BTC ${btcStart?.toFixed(2)} → ${btcEnd?.toFixed(2)}`;

  console.log(
    `[settlement] ${closedMarket.slug} closed → ${winner} wins | payout=$${payoutUsd.toFixed(2)} cost=$${costUsd.toFixed(2)} profit=$${profitUsd.toFixed(2)}${priceHint}`,
  );

  try {
    await appendJsonl("settlements", lastClosed, "paper");
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
  if (!market || !isVirtualMode(getRuntimeBotMode())) return;
  if (!hasOpenPaperPosition()) return;
  if (paperPosition().windowId !== market.conditionId) return;

  const endMs = new Date(market.endDate).getTime();
  if (Date.now() < endMs) return;

  const btc = systemState.market.btc;
  await settlePaperWindow(market, btc.startPrice, btc.price);
}

/**
 * Live mode: resolve winner, redeem winning tokens on CTF → pUSD, update P/L.
 */
export async function settleLiveWindow(
  closedMarket: ActiveMarket,
  btcStart: number | null,
  btcEnd: number | null,
): Promise<LastClosedWindowState | null> {
  if (isVirtualMode(getRuntimeBotMode())) {
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

  const run = doSettleLiveWindow(closedMarket, btcStart, btcEnd);
  trackInFlightSettlement(windowKey, run);
  try {
    return await run;
  } finally {
    clearInFlightSettlement(windowKey);
  }
}

async function doSettleLiveWindow(
  closedMarket: ActiveMarket,
  btcStart: number | null,
  btcEnd: number | null,
): Promise<LastClosedWindowState | null> {
  const windowKey = closedMarket.conditionId;
  const snapshot = { ...livePosition() };

  if (snapshot.upShares <= 0 && snapshot.downShares <= 0) {
    return null;
  }

  systemState.patchPosition(
    {
      upShares: 0,
      downShares: 0,
      exposureUsd: 0,
      windowId: null,
    },
    "live",
  );

  const endMs = new Date(closedMarket.endDate).getTime();
  const deadline = endMs + env.LIVE_REDEEM_MAX_WAIT_MS;
  let resolved = await resolveWindowWinnerForMarket(
    closedMarket,
    btcStart,
    btcEnd,
  );

  while (!resolved && Date.now() < deadline) {
    if (Date.now() < endMs + env.LIVE_REDEEM_DELAY_MS) {
      await sleep(env.LIVE_REDEEM_POLL_MS);
      continue;
    }
    if (await isMarketReadyToRedeem(closedMarket.slug)) {
      resolved = await resolveWindowWinnerForMarket(
        closedMarket,
        btcStart,
        btcEnd,
      );
      break;
    }
    await sleep(env.LIVE_REDEEM_POLL_MS);
  }

  if (!resolved) {
    systemState.patchPosition(snapshot, "live");
    console.warn(
      `[redeem] ${closedMarket.slug} — cannot resolve winner yet (will retry on next poll)`,
    );
    return null;
  }

  const { winner, source, upPrice, downPrice } = resolved;
  const { upShares, downShares, exposureUsd } = snapshot;
  const expectedPayout =
    (winner === "UP" ? upShares : 0) + (winner === "DOWN" ? downShares : 0);

  let redeemTxHash: string | null = null;
  let redeemMethod: string | null = null;

  if (await isMarketReadyToRedeem(closedMarket.slug)) {
    const redeem = await redeemLiveCondition(closedMarket);
    if (redeem.ok && redeem.txHash) {
      redeemTxHash = redeem.txHash;
      redeemMethod = redeem.method ?? null;
      console.log(
        `[redeem] ${closedMarket.slug} ok tx=${redeem.txHash.slice(0, 14)}… method=${redeem.method} balance $${redeem.balanceBeforeUsd?.toFixed(2) ?? "?"} → $${redeem.balanceAfterUsd?.toFixed(2) ?? "?"}`,
      );
    } else if (redeem.error === "nothing_to_redeem") {
      console.log(`[redeem] ${closedMarket.slug} — nothing to redeem on-chain`);
    } else {
      console.warn(
        `[redeem] ${closedMarket.slug} failed: ${redeem.error ?? "unknown"}`,
      );
    }
  }

  const payoutUsd = expectedPayout;
  const costUsd = exposureUsd;
  const profitUsd = payoutUsd - costUsd;
  const closedAt = new Date().toISOString();

  const livePnl = systemState.live.pnl;
  systemState.patchPnl(
    {
      realized: livePnl.realized + profitUsd,
      daily: livePnl.daily + profitUsd,
      unrealized: 0,
    },
    "live",
  );

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
    redeemTxHash,
    redeemMethod,
  };

  systemState.setLastClosedWindow(lastClosed, "live");
  systemState.incrementWindowsCompleted("live");
  resetPairArbTradeState();

  console.log(
    `[redeem] ${closedMarket.slug} closed → ${winner} wins | expected payout=$${payoutUsd.toFixed(2)} cost=$${costUsd.toFixed(2)} profit=$${profitUsd.toFixed(2)}`,
  );

  try {
    await appendJsonl("settlements", lastClosed, "live");
  } catch (err) {
    console.warn(
      "[redeem] failed to write settlements_live.jsonl:",
      err instanceof Error ? err.message : err,
    );
  }

  return lastClosed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function settleLiveWindowIfNeeded(
  closedMarket: ActiveMarket,
  btcStart: number | null,
  btcEnd: number | null,
): Promise<void> {
  if (!hasOpenLivePosition()) return;
  await settleLiveWindow(closedMarket, btcStart, btcEnd);
}

/** Retry redeem when window end passed but slug unchanged. */
export async function maybeRedeemExpiredLiveWindow(): Promise<void> {
  const market = systemState.market.market;
  if (!market || isVirtualMode(getRuntimeBotMode())) return;
  if (!hasOpenLivePosition()) return;
  if (livePosition().windowId !== market.conditionId) return;

  const endMs = new Date(market.endDate).getTime();
  if (Date.now() < endMs + env.LIVE_REDEEM_DELAY_MS) return;

  const btc = systemState.market.btc;
  await settleLiveWindow(market, btc.startPrice, btc.price);
}
