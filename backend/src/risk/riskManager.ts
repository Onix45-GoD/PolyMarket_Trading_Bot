import type { PairArbAction } from "../types/index.js";

export interface RiskResult {
  approved: boolean;
  reason: string;
}

/** Pre-trade checks for pair arb (daily loss stop handled in botEngine). */
export function evaluatePairRisk(action: PairArbAction): RiskResult {
  if (action === "IDLE") {
    return { approved: false, reason: "idle" };
  }
  return { approved: true, reason: "ok" };
}
