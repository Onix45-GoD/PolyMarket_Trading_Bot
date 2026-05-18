export type BotMode = "dry-run" | "live";

/** API/UI aliases: virtual/paper → dry-run, real → live */
export function normalizeBotMode(input: string): BotMode | null {
  const m = input.trim().toLowerCase();
  if (m === "dry-run" || m === "virtual" || m === "paper") return "dry-run";
  if (m === "live" || m === "real") return "live";
  return null;
}

export function isVirtualMode(mode: BotMode): boolean {
  return mode === "dry-run";
}

export function modeLabel(mode: BotMode): string {
  return isVirtualMode(mode) ? "Virtual money" : "Real money";
}
