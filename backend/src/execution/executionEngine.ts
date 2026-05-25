import type { ClobClient } from "@polymarket/clob-client-v2";
import { OrderType, Side } from "@polymarket/clob-client-v2";
import { env } from "../config/env.js";
import { getBtcDirection } from "../btc_price/btcDirection.js";
import { refreshLiveCollateralBalance } from "../polymarket/clobBalance.js";
import { getClobClient } from "../polymarket/clobClient.js";
import {
  logClobOrderError,
  logClobOrderRequest,
  logClobOrderResponse,
  logClobPairBuyStart,
  type ClobLeg,
} from "../polymarket/clobOrderConsole.js";
import {
  isLocalPlaceholderOrderId,
  parseOrderPostResponse,
  type ParsedOrderPost,
} from "../polymarket/clobOrderResponse.js";
import type { OrderRecord } from "../types/index.js";
import { systemState } from "../state/systemState.js";
import { appendJsonl } from "../storage/jsonlWriter.js";
import type { HistoryMode } from "../storage/historyMode.js";
import { registerLivePairOrders } from "./liveOrderTracker.js";
import {
  abortUnbalancedLivePair,
  waitForLivePairFill,
} from "./livePairFill.js";

export interface PairExecutionResult {
  pairId: string;
  orders: OrderRecord[];
  ok: boolean;
}

async function postBuyLegToClob(
  clob: ClobClient,
  leg: ClobLeg,
  tokenID: string,
  price: number,
  size: number,
  orderType: OrderType,
): Promise<ParsedOrderPost> {
  logClobOrderRequest({
    action: "createAndPostOrder",
    leg,
    tokenID,
    price,
    size,
    side: "BUY",
    orderType: env.LIVE_ORDER_TYPE,
  });
  const t0 = Date.now();
  try {
    const raw = await clob.createAndPostOrder(
      { tokenID, price, size, side: Side.BUY },
      { tickSize: "0.01", negRisk: false },
      orderType as OrderType.GTC,
    );
    const parsed = parseOrderPostResponse(raw);
    logClobOrderResponse({ leg, parsed, elapsedMs: Date.now() - t0 });
    return parsed;
  } catch (err) {
    logClobOrderError({
      leg,
      action: "createAndPostOrder",
      elapsedMs: Date.now() - t0,
      err,
    });
    throw err;
  }
}

function makeOrder(
  partial: Omit<OrderRecord, "id" | "createdAt" | "pairId">,
  pairId: string,
): OrderRecord {
  return {
    ...partial,
    pairId,
    id: `local-${pairId}-${partial.leg}-${partial.side}`,
    createdAt: new Date().toISOString(),
  };
}

/** Pair buy at best bid on UP + DOWN (limit buys). */
export async function executePairBuy(
  size: number,
  simulated: boolean,
): Promise<PairExecutionResult | null> {
  const market = systemState.market.market;
  const upBook = systemState.market.upBook;
  const downBook = systemState.market.downBook;
  if (!market || !upBook?.bestBid || !downBook?.bestBid) return null;

  const bidUp = upBook.bestBid;
  const bidDown = downBook.bestBid;
  const pairId = `pair-${Date.now()}`;

  const upOrder = makeOrder(
    {
      tokenId: market.upTokenId,
      leg: "UP",
      side: "BUY",
      price: bidUp,
      size,
      status: simulated ? "SIMULATED_FILLED" : "PENDING",
      simulated,
    },
    pairId,
  );
  const downOrder = makeOrder(
    {
      tokenId: market.downTokenId,
      leg: "DOWN",
      side: "BUY",
      price: bidDown,
      size,
      status: simulated ? "SIMULATED_FILLED" : "PENDING",
      simulated,
    },
    pairId,
  );

  const cost = size * (bidUp + bidDown);
  const historyMode: HistoryMode = simulated ? "paper" : "live";

  if (simulated) {
    if (systemState.virtualAccount.balanceUsd < cost) {
      upOrder.status = "SIMULATED_REJECTED_BALANCE";
      downOrder.status = "SIMULATED_REJECTED_BALANCE";
      systemState.addOrder(upOrder);
      systemState.addOrder(downOrder);
      await appendJsonl(
        "orders",
        { pairId, upOrder, downOrder, cost },
        historyMode,
      );
      return { pairId, orders: [upOrder, downOrder], ok: false };
    }

    const paperPos = systemState.paper.position;
    systemState.patchVirtualAccount({
      balanceUsd: systemState.virtualAccount.balanceUsd - cost,
    });
    systemState.patchPosition(
      {
        upShares: paperPos.upShares + size,
        downShares: paperPos.downShares + size,
        exposureUsd: paperPos.exposureUsd + cost,
        windowId: market.conditionId,
      },
      "paper",
    );
    systemState.addOrder(upOrder);
    systemState.addOrder(downOrder);
    await appendJsonl(
      "orders",
      { pairId, action: "BUY_PAIR", size, cost },
      historyMode,
    );
    await appendJsonl(
      "fills",
      {
        pairId,
        action: "BUY_PAIR",
        size,
        bidUp,
        bidDown,
        simulated: true,
      },
      historyMode,
    );
    return { pairId, orders: [upOrder, downOrder], ok: true };
  }

  const clob = await getClobClient();
  if (!clob) {
    upOrder.status = "FAILED_NO_CLIENT";
    downOrder.status = "FAILED_NO_CLIENT";
    systemState.addOrder(upOrder);
    systemState.addOrder(downOrder);
    return { pairId, orders: [upOrder, downOrder], ok: false };
  }

  const bal = await refreshLiveCollateralBalance();
  if (bal.ok) {
    console.log(
      `[live] Polymarket USDC balance ≈ $${bal.balanceUsd.toFixed(2)} (proxy/funder wallet, not MetaMask ETH)`,
    );
    if (bal.balanceUsd < cost * 1.01) {
      console.warn(
        `[live] skip BUY_PAIR — need ~$${cost.toFixed(2)} USDC, have $${bal.balanceUsd.toFixed(2)}`,
      );
      upOrder.status = "LIVE_REJECTED_BALANCE";
      downOrder.status = "LIVE_REJECTED_BALANCE";
      systemState.addOrder(upOrder);
      systemState.addOrder(downOrder);
      await appendJsonl(
        "orders",
        { pairId, cost, balanceUsd: bal.balanceUsd, reason: "insufficient_collateral" },
        historyMode,
      );
      return { pairId, orders: [upOrder, downOrder], ok: false };
    }
  } else {
    console.warn(`[live] could not read USDC balance: ${bal.error ?? "unknown"}`);
  }

  const orderType =
    env.LIVE_ORDER_TYPE === "GTC" ? OrderType.GTC : OrderType.FOK;

  logClobPairBuyStart({
    pairId,
    slug: market.slug,
    size,
    bidUp,
    bidDown,
    costUsd: cost,
    orderType: env.LIVE_ORDER_TYPE,
  });

  try {
    const [upParsed, downParsed] = await Promise.all([
      postBuyLegToClob(clob, "UP", market.upTokenId, bidUp, size, orderType),
      postBuyLegToClob(clob, "DOWN", market.downTokenId, bidDown, size, orderType),
    ]);

    if (!upParsed.success || !downParsed.success || !upParsed.orderId || !downParsed.orderId) {
      upOrder.status = "LIVE_REJECTED_CLOB";
      downOrder.status = "LIVE_REJECTED_CLOB";
      systemState.addOrder(upOrder);
      systemState.addOrder(downOrder);
      await appendJsonl("errors", {
        context: "executePairBuy_clob_post",
        pairId,
        up: upParsed,
        down: downParsed,
      });
      return { pairId, orders: [upOrder, downOrder], ok: false };
    }

    upOrder.id = upParsed.orderId;
    downOrder.id = downParsed.orderId;
    upOrder.status = "LIVE_SUBMITTED";
    downOrder.status = "LIVE_SUBMITTED";

    if (
      isLocalPlaceholderOrderId(upOrder.id) ||
      isLocalPlaceholderOrderId(downOrder.id)
    ) {
      console.error(
        `[live] BUG: CLOB returned no real order id — would orphan exchange orders`,
      );
      return { pairId, orders: [upOrder, downOrder], ok: false };
    }
    systemState.addOrder(upOrder);
    systemState.addOrder(downOrder);

    const btcDir = getBtcDirection(systemState.market.btc) ?? "FLAT";
    registerLivePairOrders(pairId, [upOrder, downOrder], {
      windowId: market.conditionId,
      conditionId: market.conditionId,
      btcDirection: btcDir,
    });

    await appendJsonl(
      "orders",
      {
        pairId,
        action: "BUY_PAIR",
        size,
        bidUp,
        bidDown,
        btcDirection: btcDir,
        orderType: env.LIVE_ORDER_TYPE,
      },
      historyMode,
    );

    const fill = await waitForLivePairFill(pairId, size);
    if (fill.ok) {
      console.log(
        `[live] pair ${pairId} both legs filled x${fill.size} (${env.LIVE_ORDER_TYPE})`,
      );
      return { pairId, orders: [upOrder, downOrder], ok: true };
    }

    console.warn(`[live] pair ${pairId} not fully filled: ${fill.reason}`);
    await abortUnbalancedLivePair(pairId, fill.reason);
    upOrder.status = "LIVE_PAIR_INCOMPLETE";
    downOrder.status = "LIVE_PAIR_INCOMPLETE";
    systemState.updateOrder(upOrder.id, { status: upOrder.status });
    systemState.updateOrder(downOrder.id, { status: downOrder.status });
    return { pairId, orders: [upOrder, downOrder], ok: false };
  } catch (err) {
    console.error(
      `[clob-req] BUY_PAIR aborted — pair=${pairId} (${err instanceof Error ? err.message : err})`,
    );
    upOrder.status = "FAILED";
    downOrder.status = "FAILED";
    systemState.addOrder(upOrder);
    systemState.addOrder(downOrder);
    await appendJsonl("errors", {
      message: err instanceof Error ? err.message : String(err),
      context: "executePairBuy",
      mode: historyMode,
    });
    return { pairId, orders: [upOrder, downOrder], ok: false };
  }
}
