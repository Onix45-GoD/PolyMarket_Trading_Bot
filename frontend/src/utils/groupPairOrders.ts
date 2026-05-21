import type { SystemSnapshot } from "../types";

export type OrderRecord = SystemSnapshot["orders"][number];

export interface DisplayOrderRow {
  key: string;
  createdAt: string;
  leg: "PAIR" | "UP" | "DOWN";
  side: string;
  /** Pair buy sum or single-leg price */
  price: number;
  upPrice?: number;
  downPrice?: number;
  size: number;
  status: string;
  simulated: boolean;
  /** $ profit at window settlement (pair: same either winner). */
  benefitUsd: number | null;
  costUsd: number;
}

function pairStatus(up: OrderRecord, down: OrderRecord): string {
  const statuses = [up.status, down.status];
  if (statuses.some((s) => s.includes("REJECT") || s.includes("FAIL"))) {
    return statuses.find((s) => s.includes("REJECT") || s.includes("FAIL"))!;
  }
  if (statuses.every((s) => s.includes("FILLED"))) {
    return up.status;
  }
  return up.status;
}

/** Expected P/L when the window settles ($1 payout per winning share). */
export function settlementBenefitUsd(
  row: Pick<DisplayOrderRow, "price" | "size" | "status">,
): number | null {
  if (!isDisplayOrderFilled(row)) return null;
  if (row.price >= 1) return 0;
  return row.size * (1 - row.price);
}

/** Merge UP+DOWN legs with the same pairId into one dashboard row. */
export function groupOrdersForDisplay(orders: OrderRecord[]): DisplayOrderRow[] {
  const byPair = new Map<string, OrderRecord[]>();
  for (const o of orders) {
    const list = byPair.get(o.pairId) ?? [];
    list.push(o);
    byPair.set(o.pairId, list);
  }

  const usedPairIds = new Set<string>();
  const rows: DisplayOrderRow[] = [];

  for (const o of orders) {
    const legs = byPair.get(o.pairId) ?? [o];
    const up = legs.find((x) => x.leg === "UP");
    const down = legs.find((x) => x.leg === "DOWN");

    if (
      up &&
      down &&
      !usedPairIds.has(o.pairId) &&
      up.side === down.side &&
      up.size === down.size
    ) {
      usedPairIds.add(o.pairId);
      const price = up.price + down.price;
      const row = {
        key: o.pairId,
        createdAt: up.createdAt,
        leg: "PAIR" as const,
        side: up.side,
        price,
        upPrice: up.price,
        downPrice: down.price,
        size: up.size,
        status: pairStatus(up, down),
        simulated: up.simulated,
        costUsd: price * up.size,
        benefitUsd: null as number | null,
      };
      row.benefitUsd = settlementBenefitUsd(row);
      rows.push(row);
      continue;
    }

    if (usedPairIds.has(o.pairId)) continue;

    const row = {
      key: o.id,
      createdAt: o.createdAt,
      leg: o.leg,
      side: o.side,
      price: o.price,
      size: o.size,
      status: o.status,
      simulated: o.simulated,
      costUsd: o.price * o.size,
      benefitUsd: null as number | null,
    };
    row.benefitUsd = settlementBenefitUsd(row);
    rows.push(row);
  }

  return rows;
}

export function displayOrderCost(row: DisplayOrderRow): number {
  return row.price * row.size;
}

export function isDisplayOrderFilled(
  row: Pick<DisplayOrderRow, "status">,
): boolean {
  return (
    row.status.includes("FILLED") ||
    row.status.includes("SUBMITTED") ||
    row.status === "PENDING"
  );
}
