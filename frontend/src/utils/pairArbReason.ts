export type PairArbAction = "IDLE" | "BUY_PAIR";

export function pairArbActionLabel(
  action: PairArbAction | string | undefined,
): string {
  switch (action) {
    case "BUY_PAIR":
      return "BUY";
    case "IDLE":
    default:
      return "WAIT";
  }
}

/** Short label for the pair-arb sidebar (backend sends verbose codes). */
export function formatPairArbReason(
  raw: string | null | undefined,
  opts?: { botRunning: boolean },
): string {
  if (!opts?.botRunning) {
    return "Bot stopped";
  }
  if (!raw) {
    return "—";
  }

  switch (raw) {
    case "no_market":
      return "No market";
    case "incomplete_books":
      return "Books loading";
    case "no_sum":
      return "No prices";
    case "buy_size_zero_or_no_balance":
      return "Buy blocked";
  }

  if (raw.includes("no_buy_")) {
    return "No buy signal";
  }
  if (raw.endsWith("_buy")) {
    return "Buy signal";
  }

  return raw.replace(/_/g, " ");
}
