import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";
import { systemState } from "../state/systemState.js";

export type BotMode = "dry-run" | "live";

const RUNTIME_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../.runtime",
);
const MODE_FILE = join(RUNTIME_DIR, "bot-mode.json");

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

/** Single source of truth for paper vs live execution. */
export function getRuntimeBotMode(): BotMode {
  const m = systemState.bot.mode;
  if (m === "dry-run" || m === "live") return m;
  return env.BOT_MODE;
}

/** Load mode saved by UI (survives tsx watch restarts). Falls back to .env BOT_MODE. */
export async function loadPersistedBotMode(): Promise<BotMode> {
  try {
    const raw = await readFile(MODE_FILE, "utf8");
    const parsed = JSON.parse(raw) as { mode?: string };
    if (typeof parsed.mode === "string") {
      const normalized = normalizeBotMode(parsed.mode);
      if (normalized) return normalized;
    }
  } catch {
    /* no file yet */
  }
  return env.BOT_MODE;
}

export function setBotMode(mode: BotMode): void {
  systemState.patchBot({ mode });
  void persistBotMode(mode);
  console.log(
    `[bot] mode → ${mode} (${isVirtualMode(mode) ? "PAPER — simulated fills" : "LIVE — real CLOB orders"})`,
  );
}

async function persistBotMode(mode: BotMode): Promise<void> {
  try {
    await mkdir(RUNTIME_DIR, { recursive: true });
    await writeFile(
      MODE_FILE,
      JSON.stringify({ mode, updatedAt: new Date().toISOString() }, null, 2),
    );
  } catch (err) {
    console.warn(
      "[bot] could not persist mode:",
      err instanceof Error ? err.message : err,
    );
  }
}
