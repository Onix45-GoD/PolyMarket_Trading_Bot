import express from "express";
import cors from "cors";
import { initNetwork } from "./net/initNetwork.js";
import { env } from "./config/env.js";

initNetwork();
import { apiRouter } from "./api/routes.js";
import { startWebSocketServer, stopWebSocketServer } from "./api/websocketServer.js";
import { startMarketDataService, stopMarketDataService } from "./market_data/marketDataService.js";
import { startBtcPriceFeed, stopBtcPriceFeed } from "./btc_price/btcPriceFeed.js";
import { startBotEngine, stopBotEngine } from "./bot/botEngine.js";

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
  console.log(`[api] http://${env.API_HOST}:${env.API_PORT}`);
  startWebSocketServer();
  startBtcPriceFeed();
  await startMarketDataService();
  startBotEngine();
});

async function shutdown(): Promise<void> {
  stopBotEngine();
  stopMarketDataService();
  stopBtcPriceFeed();
  stopWebSocketServer();
  server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
