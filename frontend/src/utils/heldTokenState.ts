import type { SystemSnapshot } from "../types";

export interface HeldLegState {
  leg: "UP" | "DOWN";
  shares: number;
  avgBuyPrice: number | null;
  costUsd: number | null;
  tokenId: string | null;
  /** Latest order status for this leg (current session). */
  lastOrderStatus: string | null;
  lastOrderAt: string | null;
}

function isLegFilledStatus(status: string): boolean {
  return (
    status.includes("FILLED") &&
    !status.includes("REJECT") &&
    !status.includes("FAIL")
  );
}

function avgBuyFromOrders(
  orders: SystemSnapshot["orders"],
  leg: "UP" | "DOWN",
): { avgPrice: number | null; costUsd: number | null } {
  const filled = orders.filter(
    (o) => o.leg === leg && isLegFilledStatus(o.status),
  );
  if (filled.length === 0) {
    return { avgPrice: null, costUsd: null };
  }
  let cost = 0;
  let size = 0;
  for (const o of filled) {
    cost += o.price * o.size;
    size += o.size;
  }
  return {
    avgPrice: size > 0 ? cost / size : null,
    costUsd: cost,
  };
}

function latestLegOrder(
  orders: SystemSnapshot["orders"],
  leg: "UP" | "DOWN",
): { status: string; createdAt: string } | null {
  const legOrders = orders.filter((o) => o.leg === leg);
  if (legOrders.length === 0) return null;
  const sorted = [...legOrders].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return { status: sorted[0]!.status, createdAt: sorted[0]!.createdAt };
}

export function computeHeldLegState(
  snap: SystemSnapshot | null,
  leg: "UP" | "DOWN",
): HeldLegState {
  const shares =
    leg === "UP"
      ? (snap?.position.upShares ?? 0)
      : (snap?.position.downShares ?? 0);
  const tokenId =
    leg === "UP"
      ? (snap?.market.market?.upTokenId ?? null)
      : (snap?.market.market?.downTokenId ?? null);
  const orders = snap?.orders ?? [];
  const { avgPrice, costUsd: orderCost } = avgBuyFromOrders(orders, leg);
  const latest = latestLegOrder(orders, leg);

  const costUsd =
    shares > 0 && avgPrice != null
      ? shares * avgPrice
      : orderCost;

  return {
    leg,
    shares,
    avgBuyPrice: avgPrice,
    costUsd: shares > 0 ? costUsd : orderCost,
    tokenId,
    lastOrderStatus: latest?.status ?? null,
    lastOrderAt: latest?.createdAt ?? null,
  };
}

export function computeHeldTokenStates(snap: SystemSnapshot | null): {
  up: HeldLegState;
  down: HeldLegState;
} {
  return {
    up: computeHeldLegState(snap, "UP"),
    down: computeHeldLegState(snap, "DOWN"),
  };
}
