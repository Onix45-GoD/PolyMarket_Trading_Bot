import { env } from "../config/env.js";
import { fetchWithTimeout } from "../net/initNetwork.js";
import { fetchPublicOrderBooks } from "../market_data/publicOrderBook.js";
import type { ActiveMarket, OrderBookSnapshot } from "../types/index.js";
export type WindowWinner = "UP" | "DOWN";

interface GammaMarket {
  slug: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  closed?: boolean;
  umaResolutionStatus?: string;
}

function parseStringArray(raw: string | string[] | undefined): string[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : null;
  }
}

function parsePriceArray(raw: string | string[] | undefined): number[] | null {
  const arr = parseStringArray(raw);
  if (!arr) return null;
  const nums = arr.map(Number).filter((n) => Number.isFinite(n));
  return nums.length === arr.length ? nums : null;
}

export async function fetchGammaMarketBySlug(
  slug: string,
): Promise<GammaMarket | null> {
  const url = new URL(
    `/markets/slug/${encodeURIComponent(slug)}`,
    env.GAMMA_API_URL,
  );
  const res = await fetchWithTimeout(url.toString(), undefined, 30_000);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Gamma slug ${slug}: HTTP ${res.status}`);
  }
  const data = (await res.json()) as GammaMarket | GammaMarket[];
  const m = Array.isArray(data) ? data[0] : data;
  return m?.slug ? m : null;
}

/** Winner from Gamma outcomePrices (e.g. ["1","0"] after resolve). */
export function resolveWinnerFromGamma(
  gamma: GammaMarket,
): WindowWinner | null {
  const outcomes = parseStringArray(gamma.outcomes);
  const prices = parsePriceArray(gamma.outcomePrices);
  if (!outcomes || !prices || outcomes.length < 2 || prices.length < 2) {
    return null;
  }

  const upIdx = outcomes.findIndex((o) => /^(up|yes)$/i.test(o.trim()));
  const downIdx = outcomes.findIndex((o) => /^(down|no)$/i.test(o.trim()));
  if (upIdx < 0 || downIdx < 0) {
    return prices[0]! >= prices[1]! ? "UP" : "DOWN";
  }

  const upPrice = prices[upIdx]!;
  const downPrice = prices[downIdx]!;

  if (upPrice >= 0.9 && downPrice <= 0.1) return "UP";
  if (downPrice >= 0.9 && upPrice <= 0.1) return "DOWN";

  if (gamma.umaResolutionStatus === "resolved" || gamma.closed) {
    return upPrice >= downPrice ? "UP" : "DOWN";
  }

  if (Math.abs(upPrice - downPrice) < 0.2) {
    return null;
  }
  return upPrice > downPrice ? "UP" : "DOWN";
}

function bookSettlementPrice(book: OrderBookSnapshot): number | null {
  if (book.mid != null && Number.isFinite(book.mid)) return book.mid;
  if (book.bestBid != null && book.bestAsk != null) {
    return (book.bestBid + book.bestAsk) / 2;
  }
  if (book.bestBid != null) return book.bestBid;
  if (book.bestAsk != null) return book.bestAsk;
  return null;
}

/** Winner from CLOB: resolved side trades near $1, loser near $0. */
export function resolveWinnerFromBooks(
  upBook: OrderBookSnapshot,
  downBook: OrderBookSnapshot,
): WindowWinner | null {
  const upPx = bookSettlementPrice(upBook);
  const downPx = bookSettlementPrice(downBook);
  if (upPx == null || downPx == null) return null;

  if (upPx >= 0.75 && downPx <= 0.25) return "UP";
  if (downPx >= 0.75 && upPx <= 0.25) return "DOWN";

  if (Math.abs(upPx - downPx) < 0.2) return null;
  return upPx > downPx ? "UP" : "DOWN";
}

export type ResolutionSource = "gamma" | "clob" | "btc";

export interface WindowWinnerResult {
  winner: WindowWinner;
  source: ResolutionSource;
  upPrice: number | null;
  downPrice: number | null;
}

/** Gamma outcomePrices first, then CLOB books; BTC optional legacy fallback. */
export async function resolveWindowWinnerForMarket(
  market: ActiveMarket,
  btcStart: number | null,
  btcEnd: number | null,
): Promise<WindowWinnerResult | null> {
  try {
    const gamma = await fetchGammaMarketBySlug(market.slug);
    if (gamma) {
      const winner = resolveWinnerFromGamma(gamma);
      const prices = parsePriceArray(gamma.outcomePrices);
      const outcomes = parseStringArray(gamma.outcomes);
      if (winner && prices && outcomes) {
        const upIdx = outcomes.findIndex((o) => /^(up|yes)$/i.test(o.trim()));
        const downIdx = outcomes.findIndex((o) => /^(down|no)$/i.test(o.trim()));
        return {
          winner,
          source: "gamma",
          upPrice: upIdx >= 0 ? prices[upIdx]! : prices[0]!,
          downPrice: downIdx >= 0 ? prices[downIdx]! : prices[1]!,
        };
      }
    }
  } catch (err) {
    console.warn(
      `[settlement] Gamma lookup failed for ${market.slug}:`,
      err instanceof Error ? err.message : err,
    );
  }

  try {
    const { upBook, downBook } = await fetchPublicOrderBooks(
      market.upTokenId,
      market.downTokenId,
    );
    const winner = resolveWinnerFromBooks(upBook, downBook);
    if (winner) {
      return {
        winner,
        source: "clob",
        upPrice: bookSettlementPrice(upBook),
        downPrice: bookSettlementPrice(downBook),
      };
    }
  } catch (err) {
    console.warn(
      `[settlement] CLOB lookup failed for ${market.slug}:`,
      err instanceof Error ? err.message : err,
    );
  }

  if (
    btcStart != null &&
    btcEnd != null &&
    Number.isFinite(btcStart) &&
    Number.isFinite(btcEnd) &&
    btcStart > 0
  ) {
    return {
      winner: btcEnd >= btcStart ? "UP" : "DOWN",
      source: "btc",
      upPrice: null,
      downPrice: null,
    };
  }

  return null;
}

/** True when Gamma shows the market closed/resolved with a clear winner. */
export async function isMarketReadyToRedeem(slug: string): Promise<boolean> {
  try {
    const gamma = await fetchGammaMarketBySlug(slug);
    if (!gamma) return false;
    const closed =
      gamma.closed === true || gamma.umaResolutionStatus === "resolved";
    if (!closed) return false;
    return resolveWinnerFromGamma(gamma) !== null;
  } catch {
    return false;
  }
}
