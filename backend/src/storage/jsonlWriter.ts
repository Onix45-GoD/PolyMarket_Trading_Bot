import { appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  historyFileName,
  type HistoryMode,
  type ModeScopedHistoryKind,
} from "./historyMode.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_DIR = join(__dirname, "../../history");

/** Shared across modes (not split). */
const sharedKinds = {
  market_snapshots: "market_snapshots.jsonl",
  errors: "errors.jsonl",
  transactions: "transactions.jsonl",
  signals: "signals.jsonl",
  positions: "positions.jsonl",
  pnl: "pnl.jsonl",
} as const;

export type SharedHistoryKind = keyof typeof sharedKinds;

export type HistoryKind = ModeScopedHistoryKind | SharedHistoryKind;

export async function appendJsonl(
  kind: HistoryKind,
  payload: unknown,
  mode?: HistoryMode,
): Promise<void> {
  await mkdir(HISTORY_DIR, { recursive: true });
  const file =
    kind in sharedKinds
      ? sharedKinds[kind as SharedHistoryKind]
      : historyFileName(kind, mode ?? "paper");
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      ...(mode ? { mode } : {}),
      ...(payload as object),
    }) + "\n";
  await appendFile(join(HISTORY_DIR, file), line, "utf8");
}
