import express from "express";
import cors from "cors";
import { initNetwork } from "./net/initNetwork.js";
import { env } from "./config/env.js";

initNetwork();
import { apiRouter } from "./api/routes.js";
import { startWebSocketServer, stopWebSocketServer } from "./api/websocketServer.js";
import { startMarketDataService, stopMarketDataService } from "./market_data/marketDataService.js";
import { startBtcPriceFeed, stopBtcPriceFeed } from "./btc_price/btcPriceFeed.js";
import { bootBotEngine, stopBotEngine } from "./bot/botEngine.js";
import {
  startLiveOrderWatch,
  stopLiveOrderWatch,
} from "./execution/liveOrderCancel.js";

const app = express();
const allowedOrigins = env.FRONTEND_ORIGIN.split(",").map((o) => o.trim());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, allowedOrigins[0]);
      }
    },
  }),
);
app.use(express.json());
app.use("/api", apiRouter);

const server = app.listen(env.API_PORT, env.API_HOST, async () => {
  console.log(`[server] API listening http://${env.API_HOST}:${env.API_PORT}`);
  console.log("[server] starting WebSocket, BTC feed, market data…");
  startWebSocketServer();
  startBtcPriceFeed();
  await startMarketDataService();
  console.log("[server] market data ready — booting bot engine");
  await bootBotEngine();
  startLiveOrderWatch();
});

async function shutdown(): Promise<void> {
  stopLiveOrderWatch();
  stopBotEngine();
  stopMarketDataService();
  stopBtcPriceFeed();
  stopWebSocketServer();
  server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
