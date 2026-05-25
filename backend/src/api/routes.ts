import { Router } from "express";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { systemState } from "../state/systemState.js";
import { normalizeBotMode, isVirtualMode, type BotMode } from "../bot/botMode.js";
import {
  setBotEnabled,
  setBotMode,
  setBotStatus,
  startBotEngine,
  stopBotEngineAsync,
} from "../bot/botEngine.js";
import { getOpenLiveOrders } from "../execution/liveOrderTracker.js";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config/env.js";
import { refreshLiveCollateralBalance } from "../polymarket/clobBalance.js";
import { getClobClient } from "../polymarket/clobClient.js";
import { checkClobHealth } from "../polymarket/clobHealth.js";
import {
  historyFileName,
  historyModeFromBotMode,
  type HistoryMode,
} from "../storage/historyMode.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_DIR = join(__dirname, "../../history");

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/** Test reachability of CLOB_HOST + wallet auth (L1/L2) */
apiRouter.get("/clob/status", async (_req, res) => {
  const report = await checkClobHealth();
  const ok = report.public.ok && (!report.auth.configured || report.auth.ok);
  res.status(ok ? 200 : 503).json(report);
});

apiRouter.get("/state", (_req, res) => {
  res.json(systemState.getSnapshot());
});

apiRouter.get("/market", (_req, res) => {
  res.json(systemState.market);
});

apiRouter.get("/bot", (_req, res) => {
  res.json(systemState.bot);
});

apiRouter.post("/bot/start", (_req, res) => {
  console.log("[ui] POST /api/bot/start — Start button");
  setBotEnabled(true);
  setBotStatus("running");
  startBotEngine();
  const bot = systemState.bot;
  const paper = isVirtualMode(bot.mode as BotMode);
  console.log(
    `[ui] bot START ok → status=${bot.status} enabled=${bot.enabled} mode=${bot.mode} (${paper ? "PAPER trades" : "LIVE CLOB trades"})`,
  );
  res.json(bot);
});

apiRouter.post("/bot/pause", (_req, res) => {
  console.log("[ui] POST /api/bot/pause — Pause button");
  setBotEnabled(false);
  setBotStatus("paused");
  const bot = systemState.bot;
  console.log(`[ui] bot PAUSE ok → status=${bot.status} enabled=${bot.enabled}`);
  res.json(bot);
});

apiRouter.post("/bot/stop", async (_req, res) => {
  console.log("[ui] POST /api/bot/stop — Stop button");
  try {
    setBotEnabled(false);
    await stopBotEngineAsync();
    const bot = systemState.bot;
    console.log(
      `[ui] bot STOP ok → status=${bot.status} enabled=${bot.enabled} mode=${bot.mode}`,
    );
    res.json(bot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ui] bot STOP failed:", msg);
    res.status(500).json({ error: msg });
  }
});

apiRouter.post("/bot/mode", async (req, res) => {
  console.log("[ui] POST /api/bot/mode — Paper/Live button", req.body);
  const raw = req.body?.mode;
  if (typeof raw !== "string") {
    res.status(400).json({
      error: "mode required: virtual | real (or dry-run | live)",
    });
    return;
  }
  const mode = normalizeBotMode(raw);
  if (!mode) {
    res.status(400).json({
      error: "mode must be virtual, real, dry-run, or live",
    });
    return;
  }

  const wasActive =
    systemState.bot.enabled || systemState.bot.status === "running";
  try {
    if (wasActive) {
      setBotEnabled(false);
      await stopBotEngineAsync();
      console.log("[ui] bot stopped before mode change");
    }

    setBotMode(mode);
    if (!isVirtualMode(mode) && env.PRIVATE_KEY) {
      await refreshLiveCollateralBalance().catch(() => {});
    }
    const bot = systemState.bot;
    console.log(
      `[ui] bot MODE ok → ${bot.mode} (${isVirtualMode(mode) ? "PAPER — next trades simulated" : "LIVE — next trades on CLOB"})`,
    );
    res.json(bot);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ui] bot MODE failed:", msg);
    res.status(500).json({ error: msg });
  }
});

apiRouter.post("/bot/reset-virtual-balance", (_req, res) => {
  console.log("[ui] POST /api/bot/reset-virtual-balance — Reset paper balance");
  const before = systemState.virtualAccount.balanceUsd;
  systemState.resetVirtualBalance();
  console.log(
    `[ui] paper balance reset $${before.toFixed(2)} → $${systemState.virtualAccount.balanceUsd.toFixed(2)}`,
  );
  res.json(systemState.virtualAccount);
});

apiRouter.get("/orders", (_req, res) => {
  res.json(systemState.getOrders());
});

apiRouter.get("/position", (_req, res) => {
  res.json(systemState.activeSession().position);
});

apiRouter.get("/pnl", (_req, res) => {
  res.json(systemState.activeSession().pnl);
});

apiRouter.get("/history/:kind", async (req, res) => {
  const kind = req.params.kind;
  const modeQuery = req.query.mode;
  const mode: HistoryMode =
    modeQuery === "paper" || modeQuery === "live"
      ? modeQuery
      : historyModeFromBotMode(systemState.bot.mode as BotMode);
  const file = join(HISTORY_DIR, historyFileName(kind, mode));
  try {
    const raw = await readFile(file, "utf8");
    const lines = raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const limit = Number(req.query.limit ?? 100);
    res.json(lines.slice(-limit).reverse());
  } catch {
    res.json([]);
  }
});

apiRouter.post("/orders/cancel-all", async (_req, res) => {
  const at = new Date().toISOString();
  const mode = systemState.bot.mode;
  const trackedBefore = getOpenLiveOrders().length;
  console.log(
    `[ui] ${at} POST /api/orders/cancel-all — Cancel all orders (mode=${mode}, tracked=${trackedBefore})`,
  );

  const clob = await getClobClient();
  if (!clob) {
    console.error("[ui] cancel-all FAILED — CLOB client not configured (PRIVATE_KEY?)");
    res.status(503).json({ error: "CLOB client not configured" });
    return;
  }

  try {
    const { cancelAllOpenLiveOrders } = await import(
      "../execution/liveOrderCancel.js",
    );
    const { clearLiveOrders } = await import("../execution/liveOrderTracker.js");

    let trackerResult = { tracked: 0, cancelled: 0 };
    if (!isVirtualMode(mode as BotMode)) {
      trackerResult = await cancelAllOpenLiveOrders("manual");
    } else {
      console.log("[ui] cancel-all — paper mode: skip tracker (no live orders)");
    }

    console.log("[ui] cancel-all — calling CLOB cancelAll()…");
    const clobResp = await clob.cancelAll();
    clearLiveOrders();

    const openOrders = systemState
      .getOrders("live")
      .filter((o) => o.status === "LIVE_SUBMITTED");
    for (const o of openOrders) {
      systemState.updateOrder(o.id, { status: "LIVE_CANCELLED_MANUAL" });
    }

    console.log(
      `[ui] cancel-all OK — tracker=${trackerResult.cancelled}, clob.cancelAll done, marked ${openOrders.length} LIVE_SUBMITTED → LIVE_CANCELLED_MANUAL`,
    );
    if (clobResp != null && typeof clobResp === "object") {
      console.log("[ui] cancel-all CLOB response:", JSON.stringify(clobResp));
    }

    res.json({
      ok: true,
      mode,
      trackedCancelled: trackerResult.cancelled,
      ordersMarkedCancelled: openOrders.length,
      clob: clobResp ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ui] cancel-all FAILED:", msg);
    res.status(500).json({ error: msg });
  }
});

/** Live Polymarket USDC (CLOB collateral) for proxy/funder wallet */
apiRouter.get("/wallet/live-usdc", async (_req, res) => {
  const read = await refreshLiveCollateralBalance();
  res.json({
    ...systemState.liveCollateral,
    balanceUsd: read.ok ? read.balanceUsd : null,
    ok: read.ok,
    error: read.error ?? null,
  });
});

apiRouter.get("/config", (_req, res) => {
  let publicWallet: string | null = null;
  if (env.PRIVATE_KEY) {
    try {
      publicWallet = privateKeyToAccount(
        env.PRIVATE_KEY as `0x${string}`,
      ).address;
    } catch {
      publicWallet = null;
    }
  }
  const proxyWallet =
    env.DEPOSIT_WALLET_ADDRESS?.trim() || publicWallet || null;

  res.json({
    botMode: systemState.bot.mode,
    envDefaultBotMode: env.BOT_MODE,
    virtualStartingBalanceUsd: env.VIRTUAL_STARTING_BALANCE_USD,
    maxPairOrderSize: env.MAX_PAIR_ORDER_SIZE,
    maxDailyLossUsd: env.MAX_DAILY_LOSS_USD,
    slippage: env.SLIPPAGE,
    botTickMs: env.BOT_TICK_MS,
    marketPollMs: env.MARKET_POLL_MS,
    clobConfigured: Boolean(env.PRIVATE_KEY),
    publicWallet,
    proxyWallet,
  });
});
