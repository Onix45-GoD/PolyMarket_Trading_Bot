import { OrderType, Side } from "@polymarket/clob-client-v2";
import { env } from "../config/env.js";
import { getClobClient } from "../polymarket/clobClient.js";
import {
  logClobOrderError,
  logClobOrderRequest,
  logClobOrderResponse,
} from "../polymarket/clobOrderConsole.js";
import { parseOrderPostResponse } from "../polymarket/clobOrderResponse.js";
import { systemState } from "../state/systemState.js";
import { appendJsonl } from "../storage/jsonlWriter.js";
import {
  getOpenLiveOrdersForPair,
  removeLiveOrder,
  type TrackedLiveOrder,
} from "./liveOrderTracker.js";
import { cancelLivePair } from "./liveOrderCancel.js";
import { clobFillState, syncTrackedFillSize } from "./liveClobFill.js";

export type PairFillResult =
  | { ok: true; size: number }
  | { ok: false; reason: string };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function legFullyFilled(tracked: TrackedLiveOrder, raw: unknown): boolean {
  const { matched, size } = clobFillState(raw);
  tracked.filledSize = matched;
  return size > 0 && matched >= size * 0.999;
}

/** Apply matched pair size to live position (both legs together). */
export function applyPairFillToPosition(
  pairId: string,
  size: number,
): void {
  const legs = getOpenLiveOrdersForPair(pairId);
  const up = legs.find((l) => l.leg === "UP");
  const down = legs.find((l) => l.leg === "DOWN");
  if (!up || !down) return;

  const cost = size * (up.price + down.price);
  const pos = systemState.live.position;
  systemState.patchPosition(
    {
      upShares: pos.upShares + size,
      downShares: pos.downShares + size,
      exposureUsd: pos.exposureUsd + cost,
      windowId: up.windowId,
    },
    "live",
  );

  for (const t of legs) {
    systemState.updateOrder(t.orderId, { status: "LIVE_FILLED" });
    removeLiveOrder(t.orderId);
  }
}

/** Poll until both legs fully fill or timeout. */
export async function waitForLivePairFill(
  pairId: string,
  targetSize: number,
): Promise<PairFillResult> {
  const deadline = Date.now() + env.LIVE_PAIR_CONFIRM_MS;
  const pollMs = Math.min(100, env.LIVE_ORDER_WATCH_MS);

  while (Date.now() < deadline) {
    const legs = getOpenLiveOrdersForPair(pairId);
    if (legs.length < 2) {
      return { ok: false, reason: "pair_tracker_missing" };
    }

    const clob = await getClobClient();
    if (!clob) return { ok: false, reason: "no_clob_client" };

    const raws = await Promise.all(
      legs.map((t) => clob.getOrder(t.orderId).catch(() => null)),
    );

    const up = legs.find((l) => l.leg === "UP")!;
    const down = legs.find((l) => l.leg === "DOWN")!;
    const upRaw = raws[legs.indexOf(up)];
    const downRaw = raws[legs.indexOf(down)];

    if (upRaw && downRaw) {
      const upFull = legFullyFilled(up, upRaw);
      const downFull = legFullyFilled(down, downRaw);
      if (upFull && downFull) {
        applyPairFillToPosition(pairId, targetSize);
        await appendJsonl(
          "fills",
          {
            pairId,
            action: "BUY_PAIR",
            size: targetSize,
            bidUp: up.price,
            bidDown: down.price,
            simulated: false,
          },
          "live",
        );
        return { ok: true, size: targetSize };
      }
    }

    await sleep(pollMs);
  }

  return { ok: false, reason: "pair_confirm_timeout" };
}

/** Cancel open legs; optionally market-sell any filled single leg. */
export async function abortUnbalancedLivePair(
  pairId: string,
  reason: string,
): Promise<void> {
  const legs = [...getOpenLiveOrdersForPair(pairId)];
  if (legs.length === 0) return;

  await syncTrackedFillSize(legs);

  const up = legs.find((l) => l.leg === "UP");
  const down = legs.find((l) => l.leg === "DOWN");
  const upFilled = (up?.filledSize ?? 0) >= 0.001;
  const downFilled = (down?.filledSize ?? 0) >= 0.001;
  const upFull = up && up.filledSize >= up.size * 0.999;
  const downFull = down && down.filledSize >= down.size * 0.999;

  if (upFull && downFull) {
    applyPairFillToPosition(pairId, up!.size);
    return;
  }

  await cancelLivePair(pairId, "timeout");

  if (env.LIVE_UNWIND_ONE_LEG) {
    const clob = await getClobClient();
    if (clob) {
      for (const leg of legs) {
        if (leg.filledSize < 0.001) continue;
        if ((leg.leg === "UP" && upFull) || (leg.leg === "DOWN" && downFull)) {
          continue;
        }
        try {
          logClobOrderRequest({
            action: "createAndPostMarketOrder",
            leg: leg.leg,
            tokenID: leg.tokenId,
            amount: leg.filledSize,
            side: "SELL",
            orderType: "FAK",
          });
          const t0 = Date.now();
          const raw = await clob.createAndPostMarketOrder(
            {
              tokenID: leg.tokenId,
              amount: leg.filledSize,
              side: Side.SELL,
            },
            { tickSize: "0.01", negRisk: false },
            OrderType.FAK,
          );
          logClobOrderResponse({
            leg: leg.leg,
            parsed: parseOrderPostResponse(raw),
            elapsedMs: Date.now() - t0,
          });
          console.log(
            `[live] unwind ${leg.leg} x${leg.filledSize} (pair ${pairId})`,
          );
          systemState.updateOrder(leg.orderId, {
            status: "LIVE_UNWIND_SELL",
          });
        } catch (err) {
          logClobOrderError({
            leg: leg.leg,
            action: "createAndPostMarketOrder",
            elapsedMs: 0,
            err,
          });
          console.warn(
            `[live] unwind ${leg.leg} failed:`,
            err instanceof Error ? err.message : err,
          );
          systemState.updateOrder(leg.orderId, {
            status: "LIVE_UNBALANCED",
          });
        }
      }
    }
  } else {
    for (const leg of legs) {
      if (leg.filledSize > 0) {
        systemState.updateOrder(leg.orderId, { status: "LIVE_UNBALANCED" });
      }
    }
  }

  if (upFilled !== downFilled) {
    console.warn(
      `[live] unbalanced pair ${pairId} (${reason}) UP=${up?.filledSize ?? 0} DOWN=${down?.filledSize ?? 0}`,
    );
    await appendJsonl(
      "orders",
      {
        action: "PAIR_ABORT",
        pairId,
        reason,
        upFilled: up?.filledSize ?? 0,
        downFilled: down?.filledSize ?? 0,
      },
      "live",
    );
  }
}
