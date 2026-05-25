import { env } from "../config/env.js";
import type { MarketState, OrderBookSnapshot } from "../types/index.js";

export type PairArbAction = "IDLE" | "BUY_PAIR";

export interface PairArbDecision {
  action: PairArbAction;
  /** buySum (UP bid + DOWN bid) when evaluating buy */
  sum: number | null;
  /** askSum (UP ask + DOWN ask) for display */
  askSum: number | null;
  size: number;
  reason: string;
}

export function buyThreshold(): number {
  return 1 - env.SLIPPAGE;
}

function bookReady(book: OrderBookSnapshot | null | undefined): boolean {
  return (
    book != null &&
    book.bestAsk != null &&
    book.bestBid != null &&
    book.bestAskSize != null &&
    book.bestBidSize != null
  );
}

/** buySum = UP ask + DOWN ask (buy signal - buying at ask to take liquidity). */
export function computeBuySum(market: MarketState): number | null {
  const up = market.upBook;
  const down = market.downBook;
  if (up?.bestAsk == null || down?.bestAsk == null) return null;
  return up.bestAsk + down.bestAsk;
}

/** askSum = UP bid + DOWN bid (dashboard / logs - what we could sell for). */
export function computeAskSum(market: MarketState): number | null {
  const up = market.upBook;
  const down = market.downBook;
  if (up?.bestBid == null || down?.bestBid == null) return null;
  return up.bestBid + down.bestBid;
}

/** @deprecated Use computeBuySum / computeAskSum */
export function computeDisplaySums(market: MarketState): {
  buySum: number | null;
  sellSum: number | null;
} {
  return { buySum: computeBuySum(market), sellSum: computeAskSum(market) };
}

/** Min top-of-book ask size for a pair buy (both legs at ask). */
export function computePairBuyQty(market: MarketState): number | null {
  const up = market.upBook;
  const down = market.downBook;
  if (up?.bestAskSize == null || down?.bestAskSize == null) return null;
  return Math.min(up.bestAskSize, down.bestAskSize);
}

export function computeBuySize(
  market: MarketState,
  virtualBalanceUsd: number,
): number {
  const up = market.upBook!;
  const down = market.downBook!;
  const askUp = up.bestAsk!;
  const askDown = down.bestAsk!;
  const bookCap = Math.min(up.bestAskSize!, down.bestAskSize!);
  const costPerShare = askUp + askDown;
  const walletCap =
    costPerShare > 0 ? Math.floor(virtualBalanceUsd / costPerShare) : 0;
  const size = Math.floor(
    Math.min(bookCap, walletCap, env.MAX_PAIR_ORDER_SIZE),
  );
  return size >= 1 ? size : 0;
}

/** Buy when buySum (UP ask + DOWN ask) <= 1 - SLIPPAGE. */
export function evaluatePairArb(
  market: MarketState,
  virtualBalanceUsd: number,
): PairArbDecision {
  const buySum = computeBuySum(market);
  const askSum = computeAskSum(market);
  const buyAt = buyThreshold();

  if (!market.market) {
    return { action: "IDLE", sum: buySum, askSum, size: 0, reason: "no_market" };
  }

  if (!bookReady(market.upBook) || !bookReady(market.downBook)) {
    return {
      action: "IDLE",
      sum: buySum,
      askSum,
      size: 0,
      reason: "incomplete_books",
    };
  }

  if (buySum == null || askSum == null) {
    return { action: "IDLE", sum: buySum, askSum, size: 0, reason: "no_sum" };
  }

  if (buySum <= buyAt) {
    const size = computeBuySize(market, virtualBalanceUsd);
    if (size >= 1) {
      return {
        action: "BUY_PAIR",
        sum: buySum,
        askSum,
        size,
        reason: `buySum_${buySum.toFixed(4)}<=${buyAt.toFixed(4)}_buy`,
      };
    }
    return {
      action: "IDLE",
      sum: buySum,
      askSum,
      size: 0,
      reason: "buy_size_zero_or_no_balance",
    };
  }

  return {
    action: "IDLE",
    sum: buySum,
    askSum,
    size: 0,
    reason: `no_buy_buySum_${buySum.toFixed(4)}_need_<=${buyAt.toFixed(4)}`,
  };
}
