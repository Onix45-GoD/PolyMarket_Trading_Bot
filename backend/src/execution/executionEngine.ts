import { Side } from "@polymarket/clob-client-v2";
import { getBtcDirection } from "../btc_price/btcDirection.js";
import { getClobClient } from "../polymarket/clobClient.js";
import type { OrderRecord } from "../types/index.js";
import { systemState } from "../state/systemState.js";
import { appendJsonl } from "../storage/jsonlWriter.js";
import type { HistoryMode } from "../storage/historyMode.js";
import { registerLivePairOrders } from "./liveOrderTracker.js";

export interface PairExecutionResult {
  pairId: string;
  orders: OrderRecord[];
  ok: boolean;
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

  try {
    const [upResp, downResp] = await Promise.all([
      clob.createAndPostOrder(
        {
          tokenID: market.upTokenId,
          price: bidUp,
          size,
          side: Side.BUY,
        },
        { tickSize: "0.01", negRisk: false },
      ),
      clob.createAndPostOrder(
        {
          tokenID: market.downTokenId,
          price: bidDown,
          size,
          side: Side.BUY,
        },
        { tickSize: "0.01", negRisk: false },
      ),
    ]);
    upOrder.id = (upResp as { orderID?: string }).orderID ?? upOrder.id;
    downOrder.id = (downResp as { orderID?: string }).orderID ?? downOrder.id;
    upOrder.status = "LIVE_SUBMITTED";
    downOrder.status = "LIVE_SUBMITTED";
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
      },
      historyMode,
    );
    return { pairId, orders: [upOrder, downOrder], ok: true };
  } catch (err) {
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
