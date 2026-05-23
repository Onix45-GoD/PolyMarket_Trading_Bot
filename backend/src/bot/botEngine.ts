import { env } from "../config/env.js";

import { evaluatePairArb } from "./pairArb.js";

import { executePairArbDecision, resetPairArbTradeState } from "./pairArbTrade.js";

import { systemState } from "../state/systemState.js";

import { appendJsonl } from "../storage/jsonlWriter.js";

import {

  cancelAllOpenLiveOrders,

  resetLiveOrderWatchState,

} from "../execution/liveOrderCancel.js";

import { clearLiveOrders } from "../execution/liveOrderTracker.js";

import {

  getRuntimeBotMode,

  isVirtualMode,

  loadPersistedBotMode,

  setBotMode,

} from "./botMode.js";

import type { BotStatus, PairArbState } from "../types/index.js";



const TICK_MS = env.BOT_TICK_MS;

let timer: ReturnType<typeof setInterval> | null = null;

let loggedTicksActive = false;



export { setBotMode, getRuntimeBotMode };



export function setBotStatus(status: BotStatus): void {

  systemState.patchBot({ status });

}



export function setBotEnabled(enabled: boolean): void {

  systemState.patchBot({ enabled });

}



function stopForDailyLoss(): void {

  setBotEnabled(false);

  setBotStatus("stopped");

  console.log(

    `[bot] STOP — max daily loss (daily=${systemState.activeSession().pnl.daily.toFixed(2)} limit=-${env.MAX_DAILY_LOSS_USD})`,

  );

}



async function tick(): Promise<void> {

  const { status, enabled } = systemState.bot;

  const active = status === "running" && enabled;

  if (!active) {

    loggedTicksActive = false;

    return;

  }



  if (systemState.activeSession().pnl.daily <= -env.MAX_DAILY_LOSS_USD) {

    stopForDailyLoss();

    return;

  }



  const mode = getRuntimeBotMode();

  if (!loggedTicksActive) {

    loggedTicksActive = true;

    console.log(

      `[bot] pair-arb active (status=${status}, mode=${mode}, ${isVirtualMode(mode) ? "PAPER" : "LIVE"}, tick ${TICK_MS}ms, slip=${env.SLIPPAGE}, maxPerTrade=${env.MAX_PAIR_ORDER_SIZE}, buyCooldown=${env.PAIR_BUY_COOLDOWN_MS}ms)`,

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



  await appendJsonl(

    "pair_arb",

    {

      windowId: market.market?.conditionId,

      ...pairArb,

    },

    systemState.activeMode(),

  );



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



export async function bootBotEngine(): Promise<void> {

  const mode = await loadPersistedBotMode();

  setBotMode(mode);



  const autoStart = env.BOT_ENABLED;

  systemState.patchBot({

    enabled: autoStart,

    status: autoStart ? "running" : "stopped",

  });

  ensureTickTimer();

  if (autoStart) {

    console.log(

      `[bot] AUTO-START from BOT_ENABLED=true → status=running mode=${mode}`,

    );

  } else {

    console.log(

      `[bot] boot: idle (BOT_ENABLED=false) — click Start in UI or POST /api/bot/start`,

    );

    console.log(

      `[bot] boot: status=stopped mode=${mode} (timer armed, no trades until started)`,

    );

  }

}



export function startBotEngine(): void {

  resetPairArbTradeState();

  ensureTickTimer();

  const mode = getRuntimeBotMode();

  console.log(

    `[bot] engine started via API → status=${systemState.bot.status} enabled=${systemState.bot.enabled} mode=${mode} (${isVirtualMode(mode) ? "PAPER" : "LIVE"})`,

  );

}



export async function stopBotEngineAsync(): Promise<void> {

  if (timer) clearInterval(timer);

  timer = null;

  loggedTicksActive = false;

  resetPairArbTradeState();

  if (!isVirtualMode(getRuntimeBotMode())) {

    await cancelAllOpenLiveOrders("bot_stop");

  }

  clearLiveOrders();

  resetLiveOrderWatchState();

  systemState.patchBot({ status: "stopped" });

  console.log(

    `[bot] engine stopped (mode=${getRuntimeBotMode()}, shutdown or stop)`,

  );

}



export function stopBotEngine(): void {

  stopBotEngineAsync().catch((err) => {

    console.warn(

      "[bot] stop cleanup:",

      err instanceof Error ? err.message : err,

    );

    systemState.patchBot({ status: "stopped" });

  });

}

