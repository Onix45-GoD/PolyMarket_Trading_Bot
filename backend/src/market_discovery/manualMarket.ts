import { env } from "../config/env.js";
import type { ActiveMarket } from "../types/index.js";

/** Use when Gamma API is unreachable (VPN/geo). Set MANUAL_* in .env */
export function getManualMarket(): ActiveMarket | null {
  const up = env.MANUAL_UP_TOKEN_ID?.trim();
  const down = env.MANUAL_DOWN_TOKEN_ID?.trim();
  if (!up || !down) return null;

  const end =
    env.MANUAL_MARKET_END_DATE?.trim() ||
    new Date(Date.now() + 5 * 60_000).toISOString();

  return {
    conditionId: env.MANUAL_CONDITION_ID?.trim() || "manual",
    question:
      env.MANUAL_MARKET_QUESTION?.trim() || "BTC Up/Down (manual config)",
    slug: "manual",
    windowMinutes: env.MANUAL_WINDOW_MINUTES ?? 5,
    endDate: end,
    upTokenId: up,
    downTokenId: down,
  };
}
