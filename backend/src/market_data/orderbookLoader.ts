import type { OrderBookLevel, OrderBookSnapshot } from "../types/index.js";

type RawLevel = { price: string | number; size: string | number };

function parseLevels(raw: RawLevel[]): OrderBookLevel[] {
  return raw
    .map((l) => ({
      price: Number(l.price),
      size: Number(l.size),
    }))
    .filter((l) => Number.isFinite(l.price) && Number.isFinite(l.size));
}

export function buildBookSnapshot(
  bids: RawLevel[],
  asks: RawLevel[],
  lastTradePrice?: string | number | null,
): OrderBookSnapshot {
  const bidLevels = parseLevels(bids).sort((a, b) => b.price - a.price);
  const askLevels = parseLevels(asks).sort((a, b) => a.price - b.price);
  const bestBid = bidLevels[0]?.price ?? null;
  const bestAsk = askLevels[0]?.price ?? null;
  const last =
    lastTradePrice != null && lastTradePrice !== ""
      ? Number(lastTradePrice)
      : null;
  const lastOk = last != null && Number.isFinite(last) ? last : null;

  let mid: number | null =
    bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
  if (mid == null && lastOk != null) mid = lastOk;
  if (mid == null && bestBid != null && bestAsk == null) mid = bestBid;
  if (mid == null && bestAsk != null && bestBid == null) mid = bestAsk;

  return {
    bids: bidLevels.slice(0, 15),
    asks: askLevels.slice(0, 15),
    bestBid,
    bestAsk,
    mid,
    updatedAt: new Date().toISOString(),
  };
}
