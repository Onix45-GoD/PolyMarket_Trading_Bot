import { env } from "../config/env.js";
import { evaluatePairArb } from "./pairArb.js";
import { executePairArbDecision, resetPairArbTradeState } from "./pairArbTrade.js";
import { systemState } from "../state/systemState.js";
import { appendJsonl } from "../storage/jsonlWriter.js";
import type { BotMode } from "./botMode.js";
import type { BotStatus, PairArbState } from "../types/index.js";

const TICK_MS = env.BOT_TICK_MS;
let timer: ReturnType<typeof setInterval> | null = null;
let loggedTicksActive = false;

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

function stopForDailyLoss(): void {
  setBotEnabled(false);
  setBotStatus("stopped");
  console.log(
    `[bot] STOP — max daily loss (daily=${systemState.pnl.daily.toFixed(2)} limit=-${env.MAX_DAILY_LOSS_USD})`,
  );
}

async function tick(): Promise<void> {
  const { status, enabled } = systemState.bot;
  const active = status === "running" && enabled;
  if (!active) {
    loggedTicksActive = false;
    return;
  }

  if (systemState.pnl.daily <= -env.MAX_DAILY_LOSS_USD) {
    stopForDailyLoss();
    return;
  }

  if (!loggedTicksActive) {
    loggedTicksActive = true;
    console.log(
      `[bot] pair-arb active (status=${status}, mode=${botMode}, tick ${TICK_MS}ms, slip=${env.SLIPPAGE}, maxPerTrade=${env.MAX_PAIR_ORDER_SIZE}, buyCooldown=${env.PAIR_BUY_COOLDOWN_MS}ms)`,
    );
  }

  const market = systemState.market;
  const tickAt = new Date().toISOString();
  const decision = evaluatePairArb(
    market,
    systemState.virtualAccount.balanceUsd,
  );

  const pairArb: PairArbState = {
    action: decision.action,
    sum: decision.sum,
    buySum: decision.sum,
    askSum: decision.askSum,
    size: decision.size,
    reason: decision.reason,
    timestamp: tickAt,
  };

  systemState.patchBot({
    pairArb,
    lastTickAt: tickAt,
    error: null,
  });

  await appendJsonl("pair_arb", {
    windowId: market.market?.conditionId,
    ...pairArb,
  });

  await executePairArbDecision(decision, "tick");
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

export function bootBotEngine(): void {
  const autoStart = env.BOT_ENABLED;
  systemState.patchBot({
    mode: botMode,
    enabled: autoStart,
    status: autoStart ? "running" : "stopped",
  });
  ensureTickTimer();
  if (autoStart) {
    console.log(
      `[bot] AUTO-START from BOT_ENABLED=true → status=running mode=${botMode}`,
    );
  } else {
    console.log(
      `[bot] boot: idle (BOT_ENABLED=false) — click Start in UI or POST /api/bot/start`,
    );
    console.log(
      `[bot] boot: status=stopped mode=${botMode} (timer armed, no trades until started)`,
    );
  }
}

export function startBotEngine(): void {
  resetPairArbTradeState();
  ensureTickTimer();
  console.log(
    `[bot] engine started via API → status=${systemState.bot.status} enabled=${systemState.bot.enabled}`,
  );
}

export function stopBotEngine(): void {
  if (timer) clearInterval(timer);
  timer = null;
  loggedTicksActive = false;
  resetPairArbTradeState();
  systemState.patchBot({ status: "stopped" });
  console.log("[bot] engine stopped (shutdown or stop)");
}
