import { env } from "../config/env.js";
import { fetchWithTimeout, formatFetchError } from "../net/initNetwork.js";
import type { ActiveMarket } from "../types/index.js";
import { getManualMarket } from "./manualMarket.js";

interface GammaMarket {
  conditionId: string;
  question: string;
  slug: string;
  endDate: string;
  clobTokenIds?: string;
  active?: boolean;
  closed?: boolean;
}

function parseTokenIds(raw: string | undefined): [string, string] | null {
  if (!raw) return null;
  try {
    const ids = JSON.parse(raw) as string[];
    if (ids.length >= 2) return [ids[0]!, ids[1]!];
  } catch {
    const parts = raw.split(",").map((s) => s.trim());
    if (parts.length >= 2) return [parts[0]!, parts[1]!];
  }
  return null;
}

function inferWindowMinutes(question: string, slug: string): number {
  const text = `${question} ${slug}`.toLowerCase();
  if (/\b5\s*m|\b5m|5-min|5 minute/.test(text)) return 5;
  if (/\b15\s*m|\b15m|15-min|15 minute/.test(text)) return 15;
  return 5;
}

export async function findActiveBtcUpDownMarket(): Promise<ActiveMarket | null> {
  const manual = getManualMarket();
  if (manual) return manual;

  const url = new URL("/public-search", env.GAMMA_API_URL);
  url.searchParams.set("q", env.BTC_UPDOWN_SEARCH);
  url.searchParams.set("limit_per_type", "20");

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchWithTimeout(url.toString(), undefined, 30_000);
      if (!res.ok) {
        throw new Error(`Gamma search failed: HTTP ${res.status}`);
      }
      return parseGammaResponse(await res.json());
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw new Error(`Gamma API unreachable: ${formatFetchError(lastErr)}`);
}

function parseGammaResponse(data: {
  events?: { markets?: GammaMarket[] }[];
}): ActiveMarket | null {
  const markets: GammaMarket[] = [];
  for (const event of data.events ?? []) {
    for (const m of event.markets ?? []) {
      markets.push(m);
    }
  }

  const now = Date.now();
  const candidates = markets
    .filter((m) => m.active && !m.closed)
    .filter((m) => /btc|bitcoin/i.test(`${m.question} ${m.slug}`))
    .filter((m) => /up|down|higher|lower/i.test(`${m.question} ${m.slug}`))
    .map((m) => {
      const tokens = parseTokenIds(m.clobTokenIds);
      const end = new Date(m.endDate).getTime();
      return { m, tokens, end };
    })
    .filter((x) => x.tokens && x.end > now)
    .sort((a, b) => a.end - b.end);

  const pick = candidates[0];
  if (!pick?.tokens) return null;

  const [upTokenId, downTokenId] = pick.tokens;
  return {
    conditionId: pick.m.conditionId,
    question: pick.m.question,
    slug: pick.m.slug,
    windowMinutes: inferWindowMinutes(pick.m.question, pick.m.slug),
    endDate: pick.m.endDate,
    upTokenId,
    downTokenId,
  };
}
