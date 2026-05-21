import { env } from "../config/env.js";
import { calculateSignal } from "./confidenceCalculator.js";
import { evaluateRisk } from "../risk/riskManager.js";
import { executeSignal } from "../execution/executionEngine.js";
import { systemState } from "../state/systemState.js";
import { appendJsonl } from "../storage/jsonlWriter.js";
import type { BotMode } from "./botMode.js";
import { isVirtualMode } from "./botMode.js";
import type { BotStatus, MarketState } from "../types/index.js";

const TICK_MS = 3000;

function fmtTokenPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(4);
}

function formatTickPrices(market: MarketState): string {
  const up =
    market.upBook?.mid ??
    market.upBook?.bestAsk ??
    market.upBook?.bestBid;
  const down =
    market.downBook?.mid ??
    market.downBook?.bestAsk ??
    market.downBook?.bestBid;
  const parts = [`up=${fmtTokenPrice(up)}`, `down=${fmtTokenPrice(down)}`];
  const btc = market.btc.price;
  if (btc > 0 && Number.isFinite(btc)) {
    parts.push(`btc=$${btc.toFixed(2)}`);
  }
  return parts.join(" ");
}
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
  const { status, enabled } = systemState.bot;
  const active = status === "running" && enabled;
  if (!active) {
    loggedTicksActive = false;
    return;
  }

  if (!loggedTicksActive) {
    loggedTicksActive = true;
    console.log(
      `[bot] trading active (status=${status}, mode=${botMode}, tick every ${TICK_MS}ms)`,
    );
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
  const marketSlug = market.market?.slug ?? "no-market";
  const prices = formatTickPrices(market);
  if (!risk.approved) {
    console.log(
      `[bot] tick ${tickAt} market=${marketSlug} ${prices} signal=${signal.side} conf=${signal.confidence.toFixed(2)} → skip (${risk.reason})`,
    );
    return;
  }

  if (Date.now() - lastTradeAt < COOLDOWN_MS) return;

  console.log(
    `[bot] tick ${tickAt} market=${marketSlug} ${prices} signal=${signal.side} conf=${signal.confidence.toFixed(2)} → placing order (mode=${botMode})`,
  );

  const simulated = isVirtualMode(botMode);
  const order = await executeSignal(signal, simulated);
  if (order) {
    lastTradeAt = Date.now();
    console.log(
      `[bot] order ${order.status} ${signal.side} @ ${order.price} x${order.size} simulated=${simulated}`,
    );
  } else {
    console.log(
      `[bot] tick ${tickAt} market=${marketSlug} ${prices} → execute returned no order`,
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

/** Ensures timer is running; does not reset enabled/status (use API start/stop for that) */
export function startBotEngine(): void {
  ensureTickTimer();
  console.log(
    `[bot] engine started via API → status=${systemState.bot.status} enabled=${systemState.bot.enabled}`,
  );
}

export function stopBotEngine(): void {
  if (timer) clearInterval(timer);
  timer = null;
  loggedTicksActive = false;
  systemState.patchBot({ status: "stopped" });
  console.log("[bot] engine stopped (shutdown or stop)");
}
