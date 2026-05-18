import type { OrderBookLevel, OrderBookSnapshot } from "../types/index.js";

function parseLevels(raw: { price: string; size: string }[]): OrderBookLevel[] {
  return raw.map((l) => ({
    price: Number(l.price),
    size: Number(l.size),
  }));
}

export function buildBookSnapshot(
  bids: { price: string; size: string }[],
  asks: { price: string; size: string }[],
): OrderBookSnapshot {
  const bidLevels = parseLevels(bids).sort((a, b) => b.price - a.price);
  const askLevels = parseLevels(asks).sort((a, b) => a.price - b.price);
  const bestBid = bidLevels[0]?.price ?? null;
  const bestAsk = askLevels[0]?.price ?? null;
  const mid =
    bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;

  return {
    bids: bidLevels.slice(0, 15),
    asks: askLevels.slice(0, 15),
    bestBid,
    bestAsk,
    mid,
    updatedAt: new Date().toISOString(),
  };
}
