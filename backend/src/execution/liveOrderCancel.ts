import { env } from "../config/env.js";
import { getBtcDirection } from "../btc_price/btcDirection.js";
import { getClobClient } from "../polymarket/clobClient.js";
import { systemState } from "../state/systemState.js";
import { appendJsonl } from "../storage/jsonlWriter.js";
import { isVirtualMode, type BotMode } from "../bot/botMode.js";
import type { BtcDirection } from "../btc_price/btcDirection.js";
import {
  getOpenLiveOrders,
  getOpenLiveOrdersForPair,
  removeLiveOrder,
  addLiveFill,
  type LiveCancelReason,
  type TrackedLiveOrder,
} from "./liveOrderTracker.js";

let watchTimer: ReturnType<typeof setInterval> | null = null;

function clobOrderStatus(raw: unknown): string {
  return String((raw as { status?: string })?.status ?? "").toUpperCase();
}

function clobSizeMatched(raw: unknown): number {
  const o = raw as {
    size_matched?: string | number;
    sizeMatched?: string | number;
  };
  return Number(o.size_matched ?? o.sizeMatched ?? 0);
}

function clobOriginalSize(raw: unknown): number {
  const o = raw as {
    original_size?: string | number;
    originalSize?: string | number;
    size?: string | number;
  };
  return Number(o.original_size ?? o.originalSize ?? o.size ?? 0);
}

function isClobFilled(raw: unknown): boolean {
  const status = clobOrderStatus(raw);
  if (
    status.includes("MATCHED") ||
    status.includes("FILLED") ||
    status.includes("EXECUTED")
  ) {
    return true;
  }
  const matched = clobSizeMatched(raw);
  const size = clobOriginalSize(raw);
  return size > 0 && matched >= size * 0.999;
}

function isClobCancelled(raw: unknown): boolean {
  return clobOrderStatus(raw).includes("CANCEL");
}

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

function applyFillToPosition(tracked: TrackedLiveOrder, delta: number): void {
  if (delta <= 0) return;
  const cost = delta * tracked.price;
  const pos = systemState.live.position;
  if (tracked.leg === "UP") {
    systemState.patchPosition(
      {
        upShares: pos.upShares + delta,
        exposureUsd: pos.exposureUsd + cost,
        windowId: tracked.windowId,
      },
      "live",
    );
  } else {
    systemState.patchPosition(
      {
        downShares: pos.downShares + delta,
        exposureUsd: pos.exposureUsd + cost,
        windowId: tracked.windowId,
      },
      "live",
    );
  }
}

async function syncOrderFill(tracked: TrackedLiveOrder): Promise<boolean> {
  const clob = await getClobClient();
  if (!clob) return false;

  try {
    const raw = await clob.getOrder(tracked.orderId);
    if (isClobCancelled(raw)) {
      removeLiveOrder(tracked.orderId);
      return true;
    }

    const matched = clobSizeMatched(raw);
    const delta = matched - tracked.filledSize;
    if (delta > 0) {
      addLiveFill(tracked.orderId, delta);
      applyFillToPosition(tracked, delta);
    }

    if (isClobFilled(raw)) {
      systemState.updateOrder(tracked.orderId, { status: "LIVE_FILLED" });
      removeLiveOrder(tracked.orderId);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function cancelOnClob(orderId: string): Promise<boolean> {
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
): Promise<void> {
  const legs = getOpenLiveOrders();
  await Promise.all(legs.map((t) => cancelTracked(t, reason)));
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

/** Poll open live orders: fills, 1–2s timeout, expiry, BTC direction flip. */
export async function enforceLiveOrderCancelRules(): Promise<void> {
  if (isVirtualMode(systemState.bot.mode as BotMode)) {
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
    await cancelAllOpenLiveOrders("near_expiry");
    return;
  }

  if (currentBtc && currentBtc !== "FLAT") {
    for (const tracked of getOpenLiveOrders()) {
      if (shouldCancelForBtc(tracked)) {
        console.log(
          `[live] BTC direction ${tracked.btcDirection} → ${currentBtc} — cancel pair ${tracked.pairId}`,
        );
        await cancelLivePair(tracked.pairId, "btc_direction");
      }
    }
  }

  for (const tracked of getOpenLiveOrders()) {
    const age = now - tracked.submittedAtMs;
    if (age >= env.LIVE_ORDER_CANCEL_MS) {
      console.log(
        `[live] order unfilled ${age}ms — cancel pair ${tracked.pairId}`,
      );
      await cancelLivePair(tracked.pairId, "timeout");
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
  console.log(`[live] order watch every ${ms}ms (cancel after ${env.LIVE_ORDER_CANCEL_MS}ms)`);
}

export function stopLiveOrderWatch(): void {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
}

export function resetLiveOrderWatchState(): void {}
