import { env } from "../config/env.js";
import { calculateSignal } from "./confidenceCalculator.js";
import { evaluateRisk } from "../risk/riskManager.js";
import { executeSignal } from "../execution/executionEngine.js";
import { systemState } from "../state/systemState.js";
import { appendJsonl } from "../storage/jsonlWriter.js";
import type { BotMode } from "./botMode.js";
import { isVirtualMode } from "./botMode.js";
import type { BotStatus } from "../types/index.js";

const TICK_MS = 3000;
let timer: ReturnType<typeof setInterval> | null = null;
let lastTradeAt = 0;
let loggedTicksActive = false;
const COOLDOWN_MS = 30_000;


export function setBotStatus(status: BotStatus): void {
  systemState.patchBot({ status });
}

export function setBotEnabled(enabled: boolean): void {
  systemState.patchBot({ enabled });
}

let botMode: BotMode = env.BOT_MODE;

export function getBotModeRuntime(): BotMode {
  return botMode;
}

export function setBotMode(mode: BotMode): void {
  botMode = mode;
  systemState.patchBot({ mode });
}

async function tick(): Promise<void> {
  const active =
    systemState.bot.status === "running" && systemState.bot.enabled;
  if (!active) {
    loggedTicksActive = false;
    return;
  }

  if (!loggedTicksActive) {
    loggedTicksActive = true;
    console.log("[bot] ticking (running, evaluating signals every 3s)");
  }

  const market = systemState.market;
  const signal = calculateSignal(market);
  const tickAt = new Date().toISOString();
  systemState.patchBot({
    currentSignal: signal,
    lastTickAt: tickAt,
    error: null,
  });

  await appendJsonl("signals", {
    windowId: market.market?.conditionId,
    signal,
  });

  const risk = evaluateRisk(signal, market);
  if (!risk.approved) {
    if (Math.random() < 0.05) {
      console.log(`[bot] tick: no trade (${risk.reason}) signal=${signal.side}`);
    }
    return;
  }

  if (Date.now() - lastTradeAt < COOLDOWN_MS) return;

  const simulated = isVirtualMode(botMode);
  const order = await executeSignal(signal, simulated);
  if (order) {
    lastTradeAt = Date.now();
    console.log(
      `[bot] order ${order.status} ${signal.side} @ ${order.price} x${order.size}`,
    );
  }
}

function ensureTickTimer(): void {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      systemState.patchBot({ error: msg });
      appendJsonl("errors", { message: msg, context: "bot_tick" });
    });
  }, TICK_MS);
  console.log(`[bot] tick timer started (every ${TICK_MS}ms)`);
}

/** Called once at server boot — applies BOT_ENABLED from .env */
export function bootBotEngine(): void {
  systemState.patchBot({
    mode: botMode,
    enabled: env.BOT_ENABLED,
    status: env.BOT_ENABLED ? "running" : "stopped",
  });
  ensureTickTimer();
  console.log(
    `[bot] boot: status=${systemState.bot.status} enabled=${systemState.bot.enabled} mode=${botMode}`,
  );
}

/** Ensures timer is running; does not reset enabled/status (use API start/stop for that) */
export function startBotEngine(): void {
  ensureTickTimer();
}

export function stopBotEngine(): void {
  if (timer) clearInterval(timer);
  timer = null;
  systemState.patchBot({ status: "stopped" });
}
