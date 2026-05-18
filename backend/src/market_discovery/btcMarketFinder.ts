import { env } from "../config/env.js";
import { fetchWithTimeout, formatFetchError } from "../net/initNetwork.js";
import type { ActiveMarket } from "../types/index.js";
import { getManualMarket } from "./manualMarket.js";

interface GammaMarket {
  conditionId: string;
  question: string;
  slug: string;
  endDate: string;
  clobTokenIds?: string | string[];
  outcomes?: string | string[];
  active?: boolean;
  closed?: boolean;
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

export function alignedWindowStart(
  unixSec: number,
  windowMinutes: number,
): number {
  const step = windowMinutes * 60;
  return Math.floor(unixSec / step) * step;
}

export function buildBtcUpDownSlug(windowStartUnix: number): string {
  return `${env.BTC_UPDOWN_SLUG_PREFIX}-${windowStartUnix}`;
}

function windowStartFromSlug(slug: string): number | null {
  const prefix = `${env.BTC_UPDOWN_SLUG_PREFIX}-`;
  if (!slug.startsWith(prefix)) return null;
  const n = Number(slug.slice(prefix.length));
  return Number.isFinite(n) ? n : null;
}

function mapUpDownTokens(m: GammaMarket): { upTokenId: string; downTokenId: string } | null {
  const ids = parseStringArray(m.clobTokenIds);
  if (!ids || ids.length < 2) return null;

  const outcomes = parseStringArray(m.outcomes);
  if (outcomes && outcomes.length >= 2) {
    const upIdx = outcomes.findIndex((o) => /^(up|yes)$/i.test(o.trim()));
    const downIdx = outcomes.findIndex((o) => /^(down|no)$/i.test(o.trim()));
    if (upIdx >= 0 && downIdx >= 0) {
      return { upTokenId: ids[upIdx]!, downTokenId: ids[downIdx]! };
    }
  }

  return { upTokenId: ids[0]!, downTokenId: ids[1]! };
}

async function fetchMarketBySlug(slug: string): Promise<GammaMarket | null> {
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
  return m?.conditionId ? m : null;
}

function toActiveMarket(m: GammaMarket): ActiveMarket | null {
  if (!m.active || m.closed) return null;

  const end = new Date(m.endDate).getTime();
  if (!Number.isFinite(end) || end <= Date.now()) return null;

  const prefix = env.BTC_UPDOWN_SLUG_PREFIX;
  if (m.slug !== prefix && !m.slug.startsWith(`${prefix}-`)) return null;

  const tokens = mapUpDownTokens(m);
  if (!tokens) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const windowMinutes = env.BTC_MARKET_WINDOW_MINUTES;
  const windowStartUnix =
    windowStartFromSlug(m.slug) ?? alignedWindowStart(nowSec, windowMinutes);

  return {
    conditionId: m.conditionId,
    question: m.question,
    slug: m.slug,
    windowMinutes,
    windowStartUnix,
    endDate: m.endDate,
    upTokenId: tokens.upTokenId,
    downTokenId: tokens.downTokenId,
  };
}

function rankCandidate(active: ActiveMarket, nowSec: number): number {
  const step = active.windowMinutes * 60;
  const ws = active.windowStartUnix;
  if (ws <= nowSec && nowSec < ws + step) return 0;
  if (ws > nowSec && ws - nowSec <= 90) return 1;
  if (ws < nowSec && nowSec < ws + step + 30) return 2;
  return 3;
}

function pickBest(candidates: ActiveMarket[]): ActiveMarket | null {
  if (candidates.length === 0) return null;
  const nowSec = Math.floor(Date.now() / 1000);

  return candidates
    .slice()
    .sort((a, b) => {
      const rank = rankCandidate(a, nowSec) - rankCandidate(b, nowSec);
      if (rank !== 0) return rank;
      return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
    })[0]!;
}

export async function findActiveBtcUpDownMarket(): Promise<ActiveMarket | null> {
  const manual = getManualMarket();
  if (manual) return manual;

  const windowMinutes = env.BTC_MARKET_WINDOW_MINUTES;
  const step = windowMinutes * 60;
  const nowSec = Math.floor(Date.now() / 1000);
  const cur = alignedWindowStart(nowSec, windowMinutes);

  const slugs = [cur, cur + step, cur - step].map((t) => buildBtcUpDownSlug(t));

  let lastErr: unknown;
  const found: ActiveMarket[] = [];

  for (const slug of slugs) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await fetchMarketBySlug(slug);
        if (raw) {
          const active = toActiveMarket(raw);
          if (active) found.push(active);
        }
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }
  }

  const pick = pickBest(found);
  if (pick) return pick;

  if (lastErr && found.length === 0) {
    throw new Error(`Gamma API unreachable: ${formatFetchError(lastErr)}`);
  }

  return null;
}
