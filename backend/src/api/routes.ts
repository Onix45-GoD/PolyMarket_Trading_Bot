import { Router } from "express";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { systemState } from "../state/systemState.js";
import {
  setBotEnabled,
  setBotMode,
  setBotStatus,
  startBotEngine,
} from "../bot/botEngine.js";
import { env } from "../config/env.js";
import { getClobClient } from "../polymarket/clobClient.js";
import { checkClobHealth } from "../polymarket/clobHealth.js";

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
  setBotEnabled(true);
  setBotStatus("running");
  startBotEngine();
  res.json(systemState.bot);
});

apiRouter.post("/bot/pause", (_req, res) => {
  setBotStatus("paused");
  res.json(systemState.bot);
});

apiRouter.post("/bot/stop", (_req, res) => {
  setBotEnabled(false);
  setBotStatus("stopped");
  res.json(systemState.bot);
});

apiRouter.post("/bot/mode", (req, res) => {
  const mode = req.body?.mode;
  if (mode !== "dry-run" && mode !== "live") {
    res.status(400).json({ error: "mode must be dry-run or live" });
    return;
  }
  setBotMode(mode);
  res.json(systemState.bot);
});

apiRouter.get("/orders", (_req, res) => {
  res.json(systemState.orders);
});

apiRouter.get("/position", (_req, res) => {
  res.json(systemState.position);
});

apiRouter.get("/pnl", (_req, res) => {
  res.json(systemState.pnl);
});

apiRouter.get("/history/:kind", async (req, res) => {
  const kind = req.params.kind;
  const file = join(HISTORY_DIR, `${kind}.jsonl`);
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
  const clob = await getClobClient();
  if (!clob) {
    res.status(503).json({ error: "CLOB client not configured" });
    return;
  }
  try {
    await clob.cancelAll();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

apiRouter.get("/config", (_req, res) => {
  res.json({
    botMode: env.BOT_MODE,
    maxOrderSizeUsd: env.MAX_ORDER_SIZE_USD,
    maxDailyLossUsd: env.MAX_DAILY_LOSS_USD,
    minConfidence: env.MIN_CONFIDENCE,
    clobConfigured: Boolean(env.PRIVATE_KEY),
  });
});
