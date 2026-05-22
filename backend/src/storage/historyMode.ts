import type { BotMode } from "../bot/botMode.js";
import { isVirtualMode } from "../bot/botMode.js";

export type HistoryMode = "paper" | "live";

export function historyModeFromSimulated(simulated: boolean): HistoryMode {
  return simulated ? "paper" : "live";
}

export function historyModeFromBotMode(mode: BotMode): HistoryMode {
  return isVirtualMode(mode) ? "paper" : "live";
}

/** Kinds stored per mode (separate .jsonl files). */
export const MODE_SCOPED_HISTORY_KINDS = [
  "orders",
  "fills",
  "settlements",
  "pair_arb",
] as const;

export type ModeScopedHistoryKind = (typeof MODE_SCOPED_HISTORY_KINDS)[number];

export function isModeScopedKind(
  kind: string,
): kind is ModeScopedHistoryKind {
  return (MODE_SCOPED_HISTORY_KINDS as readonly string[]).includes(kind);
}

export function historyFileName(
  kind: string,
  mode: HistoryMode,
): string {
  if (isModeScopedKind(kind)) {
    return `${kind}_${mode}.jsonl`;
  }
  return `${kind}.jsonl`;
}
