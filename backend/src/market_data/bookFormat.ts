import type { MarketState } from "../types/index.js";
import {
  buyThreshold,
  computeAskSum,
  computeBuySum,
  computePairBuyQty,
} from "../bot/pairArb.js";

function fmtPx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(4);
}

function fmtQty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toFixed(0);
  if (n >= 1) return n.toFixed(1);
  return n.toFixed(2);
}

/** UP/DOWN ask prices + buy signal (bid sum) for logs */
export function formatBookPrices(market: MarketState): string {
  const up = market.upBook;
  const down = market.downBook;
  const buySum = computeBuySum(market);
  const askSum = computeAskSum(market);
  const pairBuyQty = computePairBuyQty(market);
  const parts = [
    `UP bid=${fmtPx(up?.bestBid)}@${fmtQty(up?.bestBidSize)} ask=${fmtPx(up?.bestAsk)}@${fmtQty(up?.bestAskSize)}`,
    `DOWN bid=${fmtPx(down?.bestBid)}@${fmtQty(down?.bestBidSize)} ask=${fmtPx(down?.bestAsk)}@${fmtQty(down?.bestAskSize)}`,
    `buySum=${fmtPx(buySum)}`,
    `askSum=${fmtPx(askSum)}`,
    `pairBuyQty=${fmtQty(pairBuyQty)}`,
    `buySum<=${buyThreshold().toFixed(2)}`,
  ];
  return parts.join(" ");
}
