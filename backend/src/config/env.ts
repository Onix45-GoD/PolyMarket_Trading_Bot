import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });
config({ path: resolve(__dirname, "../.env") });

const envSchema = z.object({
  CLOB_HOST: z.string().default("https://clob.polymarket.com"),
  CHAIN_ID: z.coerce.number().default(137),
  PRIVATE_KEY: z.string().optional(),
  DEPOSIT_WALLET_ADDRESS: z.string().optional(),
  SIGNATURE_TYPE: z.coerce.number().default(3),
  POLY_API_KEY: z.string().optional(),
  POLY_API_SECRET: z.string().optional(),
  POLY_API_PASSPHRASE: z.string().optional(),
  POLY_BUILDER_CODE: z.string().optional(),
  BTC_PRICE_WS_URL: z
    .string()
    .default("wss://stream.binance.com:9443/ws/btcusdt@trade"),
  API_PORT: z.coerce.number().default(3001),
  WS_PORT: z.coerce.number().default(3002),
  FRONTEND_ORIGIN: z
    .string()
    .default("http://localhost:5173,http://127.0.0.1:5173"),
  API_HOST: z.string().default("0.0.0.0"),
  BOT_MODE: z.enum(["dry-run", "live"]).default("dry-run"),
  BOT_ENABLED: z
    .string()
    .transform((v) => v === "true" || v === "1")
    .default("false"),
  MAX_ORDER_SIZE_USD: z.coerce.number().default(10),
  MAX_DAILY_LOSS_USD: z.coerce.number().default(50),
  MIN_CONFIDENCE: z.coerce.number().default(0.6),
  GAMMA_API_URL: z.string().default("https://gamma-api.polymarket.com"),
  BTC_UPDOWN_SEARCH: z.string().default("btc up down"),
  HTTPS_PROXY: z.string().optional(),
  HTTP_PROXY: z.string().optional(),
  MANUAL_CONDITION_ID: z.string().optional(),
  MANUAL_UP_TOKEN_ID: z.string().optional(),
  MANUAL_DOWN_TOKEN_ID: z.string().optional(),
  MANUAL_MARKET_QUESTION: z.string().optional(),
  MANUAL_MARKET_END_DATE: z.string().optional(),
  MANUAL_WINDOW_MINUTES: z.coerce.number().default(5),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
