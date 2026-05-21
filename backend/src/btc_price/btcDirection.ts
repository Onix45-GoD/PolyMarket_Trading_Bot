import type { BtcPriceState } from "../types/index.js";

export type BtcDirection = "UP" | "DOWN" | "FLAT";

const THRESHOLD_RATIO = 0.0001;

/** BTC vs window start: above → UP, below → DOWN, near start → FLAT. */
export function getBtcDirection(btc: BtcPriceState): BtcDirection | null {
  if (btc.stale || !btc.startPrice || btc.startPrice <= 0 || btc.price <= 0) {
    return null;
  }
  const threshold = btc.startPrice * THRESHOLD_RATIO;
  const diff = btc.price - btc.startPrice;
  if (Math.abs(diff) <= threshold) return "FLAT";
  return diff > 0 ? "UP" : "DOWN";
}

/** True when direction moved from one side of start to the other (not FLAT). */
export function btcDirectionFlipped(
  previous: BtcDirection | null,
  current: BtcDirection | null,
): boolean {
  if (!previous || !current) return false;
  if (previous === "FLAT" || current === "FLAT") return false;
  return previous !== current;
}
