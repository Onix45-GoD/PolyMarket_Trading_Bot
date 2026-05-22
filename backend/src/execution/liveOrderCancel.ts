import { env } from "../config/env.js";
import { getBtcDirection } from "../btc_price/btcDirection.js";
import { getClobClient } from "../polymarket/clobClient.js";
import { isLocalPlaceholderOrderId } from "../polymarket/clobOrderResponse.js";
import { systemState } from "../state/systemState.js";
import { appendJsonl } from "../storage/jsonlWriter.js";
import { getRuntimeBotMode, isVirtualMode } from "../bot/botMode.js";
import {
  getOpenLiveOrders,
  getOpenLiveOrdersForPair,
  removeLiveOrder,
  type LiveCancelReason,
  type TrackedLiveOrder,
} from "./liveOrderTracker.js";
import {
  clobFillState,
  isClobCancelled,
  isClobFilled,
} from "./liveClobFill.js";

let watchTimer: ReturnType<typeof setInterval> | null = null;

function statusForCancel(reason: LiveCancelReason): string {
  switch (reason) {
    case "timeout":
      return "LIVE_CANCELLED_TIMEOUT";
    case "near_expiry":
      return "LIVE_CANCELLED_EXPIRY";
    case "btc_direction":
      return "LIVE_CANCELLED_BTC";
    case "window_switch":
      return "LIVE_CANCELLED_WINDOW";
    case "bot_stop":
      return "LIVE_CANCELLED_STOP";
    default:
      return "LIVE_CANCELLED";
  }
}

/** Sync fill sizes only — position updates when pair is fully confirmed. */
async function syncOrderFill(tracked: TrackedLiveOrder): Promise<boolean> {
  const clob = await getClobClient();
  if (!clob) return false;

  try {
    const raw = await clob.getOrder(tracked.orderId);
    if (isClobCancelled(raw)) {
      removeLiveOrder(tracked.orderId);
      return true;
    }

    tracked.filledSize = clobFillState(raw).matched;

    if (isClobFilled(raw)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function cancelOnClob(orderId: string): Promise<boolean> {
  if (isLocalPlaceholderOrderId(orderId)) {
    console.error(
      `[live] cancel skipped — not a CLOB order id (${orderId.slice(0, 24)}…); check POST response parsing`,
    );
    return false;
  }
  const clob = await getClobClient();
  if (!clob) return false;
  try {
    await clob.cancelOrder({ orderID: orderId });
    return true;
  } catch {
    try {
      await clob.cancelOrders([orderId]);
      return true;
    } catch {
      return false;
    }
  }
}

async function cancelTracked(
  tracked: TrackedLiveOrder,
  reason: LiveCancelReason,
): Promise<void> {
  const ok = await cancelOnClob(tracked.orderId);
  const status = statusForCancel(reason);
  systemState.updateOrder(tracked.orderId, {
    status: ok ? status : `${status}_FAILED`,
  });
  removeLiveOrder(tracked.orderId);
  console.log(
    `[live] cancel ${tracked.leg} ${tracked.orderId.slice(0, 10)}… reason=${reason} ok=${ok}`,
  );
  await appendJsonl(
    "orders",
    {
      action: "CANCEL",
      orderId: tracked.orderId,
      pairId: tracked.pairId,
      reason,
      ok,
    },
    "live",
  );
}

export async function cancelLivePair(
  pairId: string,
  reason: LiveCancelReason,
): Promise<void> {
  const legs = getOpenLiveOrdersForPair(pairId);
  await Promise.all(legs.map((t) => cancelTracked(t, reason)));
}

export async function cancelAllOpenLiveOrders(
  reason: LiveCancelReason,
): Promise<{ tracked: number; cancelled: number }> {
  const legs = getOpenLiveOrders();
  const tracked = legs.length;
  if (tracked === 0) {
    console.log(`[live] cancel-all (tracker) reason=${reason} — no open tracked orders`);
    return { tracked: 0, cancelled: 0 };
  }
  console.log(
    `[live] cancel-all (tracker) reason=${reason} — ${tracked} order(s): ${legs.map((t) => `${t.leg}:${t.orderId.slice(0, 10)}…`).join(", ")}`,
  );
  await Promise.all(legs.map((t) => cancelTracked(t, reason)));
  console.log(`[live] cancel-all (tracker) done — cleared ${tracked} tracked order(s)`);
  return { tracked, cancelled: tracked };
}

function secondsToMarketEnd(): number | null {
  const end = systemState.market.market?.endDate;
  if (!end) return null;
  return (new Date(end).getTime() - Date.now()) / 1000;
}

function shouldCancelForBtc(tracked: TrackedLiveOrder): boolean {
  const current = getBtcDirection(systemState.market.btc);
  if (!current || current === "FLAT") return false;
  if (tracked.btcDirection === "FLAT") return false;
  return tracked.btcDirection !== current;
}

/** Poll open live orders: fills, timeout, expiry, BTC direction flip. */
export async function enforceLiveOrderCancelRules(): Promise<void> {
  if (isVirtualMode(getRuntimeBotMode())) {
    return;
  }

  const open = getOpenLiveOrders();
  if (open.length === 0) {
    return;
  }

  const now = Date.now();
  const currentBtc = getBtcDirection(systemState.market.btc);

  for (const tracked of [...open]) {
    await syncOrderFill(tracked);
  }

  const remaining = getOpenLiveOrders();
  if (remaining.length === 0) {
    return;
  }

  const secToEnd = secondsToMarketEnd();
  if (secToEnd != null && secToEnd <= env.LIVE_EXPIRY_CANCEL_SEC) {
    console.log(
      `[live] market expires in ${secToEnd.toFixed(0)}s — cancelling ${remaining.length} open order(s)`,
    );
    const pairIds = [...new Set(remaining.map((r) => r.pairId))];
    const { abortUnbalancedLivePair } = await import("./livePairFill.js");
    for (const pairId of pairIds) {
      await abortUnbalancedLivePair(pairId, "near_expiry");
    }
    return;
  }

  if (currentBtc && currentBtc !== "FLAT") {
    for (const tracked of getOpenLiveOrders()) {
      if (shouldCancelForBtc(tracked)) {
        console.log(
          `[live] BTC direction ${tracked.btcDirection} → ${currentBtc} — abort pair ${tracked.pairId}`,
        );
        const { abortUnbalancedLivePair } = await import("./livePairFill.js");
        await abortUnbalancedLivePair(tracked.pairId, "btc_direction");
      }
    }
  }

  const seenPairs = new Set<string>();
  for (const tracked of getOpenLiveOrders()) {
    if (seenPairs.has(tracked.pairId)) continue;
    seenPairs.add(tracked.pairId);
    const age = now - tracked.submittedAtMs;
    if (age >= env.LIVE_ORDER_CANCEL_MS) {
      console.log(
        `[live] pair unfilled ${age}ms — abort ${tracked.pairId}`,
      );
      const { abortUnbalancedLivePair } = await import("./livePairFill.js");
      await abortUnbalancedLivePair(tracked.pairId, "timeout");
    }
  }
}

export function startLiveOrderWatch(): void {
  if (watchTimer) return;
  const ms = env.LIVE_ORDER_WATCH_MS;
  watchTimer = setInterval(() => {
    enforceLiveOrderCancelRules().catch((err) => {
      console.warn(
        "[live] cancel watch:",
        err instanceof Error ? err.message : err,
      );
    });
  }, ms);
  console.log(
    `[live] order watch every ${ms}ms (FOK/${env.LIVE_ORDER_TYPE}, confirm ${env.LIVE_PAIR_CONFIRM_MS}ms, cancel ${env.LIVE_ORDER_CANCEL_MS}ms)`,
  );
}

export function stopLiveOrderWatch(): void {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
}

export function resetLiveOrderWatchState(): void {}
