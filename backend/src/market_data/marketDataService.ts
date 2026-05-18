import { getClobClient } from "../polymarket/clobClient.js";
import { findActiveBtcUpDownMarket } from "../market_discovery/btcMarketFinder.js";
import { getManualMarket } from "../market_discovery/manualMarket.js";
import { formatFetchError } from "../net/initNetwork.js";
import { buildBookSnapshot } from "./orderbookLoader.js";
import { systemState } from "../state/systemState.js";
import { appendJsonl } from "../storage/jsonlWriter.js";

const POLL_MS = 2000;
const MIN_DISCOVERY_MS = 5000;
const MAX_DISCOVERY_BACKOFF_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let discoveryBackoffMs = MIN_DISCOVERY_MS;
let lastDiscoveryAttempt = 0;
let lastErrorLogAt = 0;

async function refreshBooks(): Promise<void> {
  const market = systemState.market.market;
  if (!market) return;

  const clob = await getClobClient();
  if (!clob) {
    systemState.patchConnectivity({
      clob: "no_client",
      clobError: "PRIVATE_KEY not set — order books need CLOB client",
    });
    return;
  }

  try {
    const [upRaw, downRaw] = await Promise.all([
      clob.getOrderBook(market.upTokenId),
      clob.getOrderBook(market.downTokenId),
    ]);

    const upBook = buildBookSnapshot(upRaw.bids ?? [], upRaw.asks ?? []);
    const downBook = buildBookSnapshot(downRaw.bids ?? [], downRaw.asks ?? []);

    systemState.patchMarket({ upBook, downBook });
    systemState.patchConnectivity({ clob: "ok", clobError: null });

    await appendJsonl("market_snapshots", {
      windowId: market.conditionId,
      upBook,
      downBook,
      btc: systemState.market.btc,
    });
  } catch (err) {
    const msg = formatFetchError(err);
    systemState.patchConnectivity({ clob: "error", clobError: msg });
    throw err;
  }
}

async function refreshMarket(): Promise<void> {
  const now = Date.now();
  if (now - lastDiscoveryAttempt < discoveryBackoffMs) return;
  lastDiscoveryAttempt = now;

  const manual = getManualMarket();
  if (manual) {
    const prev = systemState.market.market?.conditionId;
    systemState.patchMarket({ market: manual });
    systemState.patchConnectivity({
      gamma: "manual",
      gammaError: null,
    });
    if (prev !== manual.conditionId) {
      console.log(`[market] Using manual config: ${manual.question}`);
    }
    discoveryBackoffMs = MIN_DISCOVERY_MS;
    return;
  }

  try {
    const found = await findActiveBtcUpDownMarket();
    if (found) {
      const prev = systemState.market.market?.conditionId;
      systemState.patchMarket({ market: found });
      systemState.patchConnectivity({ gamma: "ok", gammaError: null });
      if (prev !== found.conditionId) {
        console.log(`[market] Active: ${found.question}`);
      }
    } else {
      systemState.patchConnectivity({
        gamma: "empty",
        gammaError: "No active BTC up/down market found",
      });
    }
    discoveryBackoffMs = MIN_DISCOVERY_MS;
  } catch (err) {
    const msg = formatFetchError(err);
    systemState.patchConnectivity({ gamma: "error", gammaError: msg });
    discoveryBackoffMs = Math.min(
      discoveryBackoffMs * 2,
      MAX_DISCOVERY_BACKOFF_MS,
    );

    if (now - lastErrorLogAt > 30_000) {
      console.error(`[market] ${msg}`);
      console.error(
        "[market] Tip: set HTTPS_PROXY in .env, or MANUAL_UP_TOKEN_ID / MANUAL_DOWN_TOKEN_ID",
      );
      lastErrorLogAt = now;
    }
  }
}

export async function startMarketDataService(): Promise<void> {
  await refreshMarket();
  await refreshBooks().catch(() => {});

  timer = setInterval(async () => {
    await refreshMarket();
    await refreshBooks().catch((e) => {
      const now = Date.now();
      if (now - lastErrorLogAt > 30_000) {
        console.error("[market] book refresh:", formatFetchError(e));
        lastErrorLogAt = now;
      }
    });
  }, POLL_MS);
}

export function stopMarketDataService(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
