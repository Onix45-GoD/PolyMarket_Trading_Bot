import { Side } from "@polymarket/clob-client-v2";
import { env } from "../config/env.js";
import { getClobClient } from "../polymarket/clobClient.js";
import type { BotSignal, OrderRecord } from "../types/index.js";
import { systemState } from "../state/systemState.js";
import { appendJsonl } from "../storage/jsonlWriter.js";

export async function executeSignal(
  signal: BotSignal,
  simulated: boolean,
): Promise<OrderRecord | null> {
  const market = systemState.market.market;
  if (!market || signal.side === "NO_TRADE") return null;

  const tokenId =
    signal.side === "UP" ? market.upTokenId : market.downTokenId;
  const book =
    signal.side === "UP" ? systemState.market.upBook : systemState.market.downBook;
  const price = book?.bestAsk;
  if (!price) return null;

  const size = Math.max(1, Math.floor(env.MAX_ORDER_SIZE_USD / price));

  const record: OrderRecord = {
    id: `local-${Date.now()}`,
    tokenId,
    side: "BUY",
    price,
    size,
    status: simulated ? "SIMULATED_FILLED" : "PENDING",
    simulated,
    createdAt: new Date().toISOString(),
  };

  if (simulated) {
    const cost = price * size;
    if (systemState.virtualAccount.balanceUsd < cost) {
      record.status = "SIMULATED_REJECTED_BALANCE";
      systemState.addOrder(record);
      await appendJsonl("orders", { ...record, signal, cost });
      return record;
    }

    systemState.patchVirtualAccount({
      balanceUsd: systemState.virtualAccount.balanceUsd - cost,
    });
    systemState.patchPosition({
      exposureUsd: systemState.position.exposureUsd + cost,
    });

    systemState.addOrder(record);
    if (signal.side === "UP") {
      systemState.patchPosition({
        upShares: systemState.position.upShares + size,
      });
    } else {
      systemState.patchPosition({
        downShares: systemState.position.downShares + size,
      });
    }
    await appendJsonl("orders", { ...record, signal });
    await appendJsonl("fills", { orderId: record.id, price, size, simulated: true });
    return record;
  }

  const clob = await getClobClient();
  if (!clob) {
    record.status = "FAILED_NO_CLIENT";
    systemState.addOrder(record);
    return record;
  }

  try {
    const resp = await clob.createAndPostOrder(
      {
        tokenID: tokenId,
        price,
        size,
        side: Side.BUY,
      },
      { tickSize: "0.01", negRisk: false },
    );
    record.id = (resp as { orderID?: string }).orderID ?? record.id;
    record.status = "LIVE_SUBMITTED";
    systemState.addOrder(record);
    await appendJsonl("orders", { ...record, signal });
    return record;
  } catch (err) {
    record.status = "FAILED";
    systemState.addOrder(record);
    await appendJsonl("errors", {
      message: err instanceof Error ? err.message : String(err),
      context: "executeSignal",
    });
    return record;
  }
}
