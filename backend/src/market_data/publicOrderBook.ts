import { env } from "../config/env.js";
import { fetchWithTimeout, formatFetchError } from "../net/initNetwork.js";
import type { OrderBookSnapshot } from "../types/index.js";
import { buildBookSnapshot } from "./orderbookLoader.js";

interface ClobBookResponse {
  bids?: { price: string | number; size: string | number }[];
  asks?: { price: string | number; size: string | number }[];
  buys?: { price: string | number; size: string | number }[];
  sells?: { price: string | number; size: string | number }[];
  last_trade_price?: string | number;
}

/** Public CLOB endpoint — no PRIVATE_KEY required */
export async function fetchPublicOrderBook(
  tokenId: string,
): Promise<OrderBookSnapshot> {
  const url = new URL("/book", env.CLOB_HOST);
  url.searchParams.set("token_id", tokenId);

  const res = await fetchWithTimeout(url.toString(), undefined, 20_000);
  if (!res.ok) {
    throw new Error(`CLOB book ${tokenId.slice(0, 8)}…: HTTP ${res.status}`);
  }

  const data = (await res.json()) as ClobBookResponse;
  const bids = data.bids ?? data.buys ?? [];
  const asks = data.asks ?? data.sells ?? [];
  return buildBookSnapshot(bids, asks, data.last_trade_price);
}

export async function fetchPublicOrderBooks(
  upTokenId: string,
  downTokenId: string,
): Promise<{ upBook: OrderBookSnapshot; downBook: OrderBookSnapshot }> {
  try {
    const [upBook, downBook] = await Promise.all([
      fetchPublicOrderBook(upTokenId),
      fetchPublicOrderBook(downTokenId),
    ]);
    return { upBook, downBook };
  } catch (err) {
    throw new Error(formatFetchError(err));
  }
}
