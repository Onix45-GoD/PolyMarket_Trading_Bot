import type { BtcDirection } from "../btc_price/btcDirection.js";
import type { OrderRecord } from "../types/index.js";

export type LiveCancelReason =
  | "timeout"
  | "near_expiry"
  | "btc_direction"
  | "window_switch"
  | "bot_stop"
  | "manual";

export interface TrackedLiveOrder {
  orderId: string;
  pairId: string;
  leg: "UP" | "DOWN";
  tokenId: string;
  price: number;
  size: number;
  submittedAtMs: number;
  windowId: string;
  conditionId: string;
  btcDirection: BtcDirection;
  filledSize: number;
}

const openByOrderId = new Map<string, TrackedLiveOrder>();

export function registerLivePairOrders(
  pairId: string,
  orders: OrderRecord[],
  meta: {
    windowId: string;
    conditionId: string;
    btcDirection: BtcDirection;
  },
): void {
  const now = Date.now();
  for (const o of orders) {
    if (o.simulated) continue;
    openByOrderId.set(o.id, {
      orderId: o.id,
      pairId,
      leg: o.leg,
      tokenId: o.tokenId,
      price: o.price,
      size: o.size,
      submittedAtMs: now,
      windowId: meta.windowId,
      conditionId: meta.conditionId,
      btcDirection: meta.btcDirection,
      filledSize: 0,
    });
  }
}

export function getOpenLiveOrders(): TrackedLiveOrder[] {
  return [...openByOrderId.values()];
}

export function getOpenLiveOrdersForPair(pairId: string): TrackedLiveOrder[] {
  return getOpenLiveOrders().filter((o) => o.pairId === pairId);
}

export function hasOpenLiveOrders(): boolean {
  return openByOrderId.size > 0;
}

export function removeLiveOrder(orderId: string): void {
  openByOrderId.delete(orderId);
}

export function clearLiveOrders(): void {
  openByOrderId.clear();
}

export function getLiveOrder(orderId: string): TrackedLiveOrder | undefined {
  return openByOrderId.get(orderId);
}

export function addLiveFill(orderId: string, delta: number): void {
  const o = openByOrderId.get(orderId);
  if (o) o.filledSize += delta;
}
