import { Side } from "@polymarket/clob-client-v2";
import { getClobClient } from "../polymarket/clobClient.js";
import type { OrderRecord } from "../types/index.js";
import { systemState } from "../state/systemState.js";
import { appendJsonl } from "../storage/jsonlWriter.js";

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

  if (simulated) {
    if (systemState.virtualAccount.balanceUsd < cost) {
      upOrder.status = "SIMULATED_REJECTED_BALANCE";
      downOrder.status = "SIMULATED_REJECTED_BALANCE";
      systemState.addOrder(upOrder);
      systemState.addOrder(downOrder);
      await appendJsonl("orders", { pairId, upOrder, downOrder, cost });
      return { pairId, orders: [upOrder, downOrder], ok: false };
    }

    systemState.patchVirtualAccount({
      balanceUsd: systemState.virtualAccount.balanceUsd - cost,
    });
    systemState.patchPosition({
      upShares: systemState.position.upShares + size,
      downShares: systemState.position.downShares + size,
      exposureUsd: systemState.position.exposureUsd + cost,
      windowId: market.conditionId,
    });
    systemState.addOrder(upOrder);
    systemState.addOrder(downOrder);
    await appendJsonl("orders", { pairId, action: "BUY_PAIR", size, cost });
    await appendJsonl("fills", {
      pairId,
      action: "BUY_PAIR",
      size,
      bidUp,
      bidDown,
      simulated: true,
    });
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
    await appendJsonl("orders", { pairId, action: "BUY_PAIR", size });
    return { pairId, orders: [upOrder, downOrder], ok: true };
  } catch (err) {
    upOrder.status = "FAILED";
    downOrder.status = "FAILED";
    systemState.addOrder(upOrder);
    systemState.addOrder(downOrder);
    await appendJsonl("errors", {
      message: err instanceof Error ? err.message : String(err),
      context: "executePairBuy",
    });
    return { pairId, orders: [upOrder, downOrder], ok: false };
  }
}
