import { env } from "../config/env.js";
import { calculateSignal } from "./confidenceCalculator.js";
import { evaluateRisk } from "../risk/riskManager.js";
import { executeSignal } from "../execution/executionEngine.js";
import { systemState } from "../state/systemState.js";
import { appendJsonl } from "../storage/jsonlWriter.js";
import type { BotStatus } from "../types/index.js";

const TICK_MS = 3000;
let timer: ReturnType<typeof setInterval> | null = null;
let lastTradeAt = 0;
const COOLDOWN_MS = 30_000;


export function setBotStatus(status: BotStatus): void {
  systemState.patchBot({ status });
}

export function setBotEnabled(enabled: boolean): void {
  systemState.patchBot({ enabled });
}

let botMode: "dry-run" | "live" = env.BOT_MODE;

export function getBotModeRuntime(): "dry-run" | "live" {
  return botMode;
}

export function setBotMode(mode: "dry-run" | "live"): void {
  botMode = mode;
  systemState.patchBot({ mode });
}

async function tick(): Promise<void> {
  if (systemState.bot.status !== "running" || !systemState.bot.enabled) {
    return;
  }

  const market = systemState.market;
  const signal = calculateSignal(market);
  systemState.patchBot({
    currentSignal: signal,
    lastTickAt: new Date().toISOString(),
    error: null,
  });

  await appendJsonl("signals", {
    windowId: market.market?.conditionId,
    signal,
  });

  const risk = evaluateRisk(signal, market);
  if (!risk.approved) return;

  if (Date.now() - lastTradeAt < COOLDOWN_MS) return;

  const simulated = botMode === "dry-run";
  const order = await executeSignal(signal, simulated);
  if (order) lastTradeAt = Date.now();
}

export function startBotEngine(): void {
  systemState.patchBot({
    mode: env.BOT_MODE,
    enabled: env.BOT_ENABLED,
    status: env.BOT_ENABLED ? "running" : "stopped",
  });

  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      systemState.patchBot({ error: msg });
      appendJsonl("errors", { message: msg, context: "bot_tick" });
    });
  }, TICK_MS);
}

export function stopBotEngine(): void {
  if (timer) clearInterval(timer);
  timer = null;
  systemState.patchBot({ status: "stopped" });
}
