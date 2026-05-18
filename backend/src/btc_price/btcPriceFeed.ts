import WebSocket from "ws";
import { env } from "../config/env.js";
import { fetchWithTimeout, formatFetchError } from "../net/initNetwork.js";
import { systemState } from "../state/systemState.js";

const STALE_MS = 15_000;
const REST_FALLBACK_MS = 10_000;

let ws: WebSocket | null = null;
let startPrice: number | null = null;
let windowId: string | null = null;
let staleTimer: ReturnType<typeof setInterval> | null = null;
let restTimer: ReturnType<typeof setInterval> | null = null;
let lastWsMessageAt = 0;

function updateBtc(price: number): void {
  const market = systemState.market.market;
  if (market && market.conditionId !== windowId) {
    windowId = market.conditionId;
    startPrice = price;
  }

  const distancePct =
    startPrice && startPrice > 0
      ? ((price - startPrice) / startPrice) * 100
      : null;

  systemState.patchMarket({
    btc: {
      price,
      startPrice,
      distancePct,
      updatedAt: new Date().toISOString(),
      stale: false,
    },
  });
}

async function fetchBtcFromRest(): Promise<void> {
  try {
    const res = await fetchWithTimeout(
      "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
      undefined,
      15_000,
    );
    if (!res.ok) return;
    const data = (await res.json()) as { price?: string };
    const p = Number(data.price);
    if (Number.isFinite(p) && p > 0) updateBtc(p);
  } catch (err) {
    if (Date.now() - lastWsMessageAt > STALE_MS) {
      console.warn("[btc] REST fallback failed:", formatFetchError(err));
    }
  }
}

export function startBtcPriceFeed(): void {
  if (ws) return;

  const connect = () => {
    ws = new WebSocket(env.BTC_PRICE_WS_URL);

    ws.on("open", () => {
      lastWsMessageAt = Date.now();
    });

    ws.on("message", (data) => {
      lastWsMessageAt = Date.now();
      try {
        const msg = JSON.parse(data.toString()) as { p?: string; c?: string };
        const p = Number(msg.p ?? msg.c);
        if (Number.isFinite(p) && p > 0) updateBtc(p);
      } catch {
        /* ignore */
      }
    });

    ws.on("close", () => {
      ws = null;
      setTimeout(connect, 3000);
    });

    ws.on("error", () => ws?.close());
  };

  connect();
  fetchBtcFromRest();

  restTimer = setInterval(() => {
    if (Date.now() - lastWsMessageAt > STALE_MS) {
      fetchBtcFromRest();
    }
  }, REST_FALLBACK_MS);

  staleTimer = setInterval(() => {
    const btc = systemState.market.btc;
    const age = Date.now() - new Date(btc.updatedAt).getTime();
    if (age > STALE_MS) {
      systemState.patchMarket({
        btc: { ...btc, stale: true },
      });
    }
  }, 5000);
}

export function stopBtcPriceFeed(): void {
  ws?.close();
  ws = null;
  if (staleTimer) clearInterval(staleTimer);
  staleTimer = null;
  if (restTimer) clearInterval(restTimer);
  restTimer = null;
}
