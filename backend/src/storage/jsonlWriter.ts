import { appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_DIR = join(__dirname, "../../history");

const files: Record<string, string> = {
  transactions: "transactions.jsonl",
  orders: "orders.jsonl",
  fills: "fills.jsonl",
  signals: "signals.jsonl",
  market_snapshots: "market_snapshots.jsonl",
  positions: "positions.jsonl",
  pnl: "pnl.jsonl",
  errors: "errors.jsonl",
};

export async function appendJsonl(
  kind: keyof typeof files,
  payload: unknown,
): Promise<void> {
  await mkdir(HISTORY_DIR, { recursive: true });
  const line =
    JSON.stringify({ ts: new Date().toISOString(), ...payload as object }) +
    "\n";
  await appendFile(join(HISTORY_DIR, files[kind]), line, "utf8");
}
