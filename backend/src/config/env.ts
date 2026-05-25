import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Repo root .env (common when using npm run dev from project root)
config({ path: resolve(__dirname, "../../../.env") });
// backend/.env overrides root
config({ path: resolve(__dirname, "../../.env") });

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
  /** Max matched shares per single pair buy (not a per-window cap; you can buy again) */
  MAX_PAIR_ORDER_SIZE: z.coerce.number().default(100),
  /** Min milliseconds between successful pair buys in the same window */
  PAIR_BUY_COOLDOWN_MS: z.coerce.number().default(2000),
  MAX_DAILY_LOSS_USD: z.coerce.number().default(50),
  /** Buy when buySum (UP ask + DOWN ask) <= 1 - SLIPPAGE */
  SLIPPAGE: z.coerce.number().default(0.02),
  /** Bot tick interval (ms) */
  BOT_TICK_MS: z.coerce.number().default(1000),
  /** CLOB order book refresh interval (ms) */
  MARKET_POLL_MS: z.coerce.number().default(2000),
  /** Live: cancel unfilled limit orders after this many ms */
  LIVE_ORDER_CANCEL_MS: z.coerce.number().default(1500),
  /** Live: poll open orders for fill/cancel rules */
  LIVE_ORDER_WATCH_MS: z.coerce.number().default(500),
  /** Live: cancel all open orders when market ends within this many seconds */
  LIVE_EXPIRY_CANCEL_SEC: z.coerce.number().default(30),
  /** Live: skip new pair buys while previous pair orders are still open */
  LIVE_BLOCK_WHILE_OPEN: z
    .string()
    .transform((v) => v !== "false" && v !== "0")
    .default("true"),
  /** Live: GTC (resting) or FOK (fill entire size now or cancel) */
  LIVE_ORDER_TYPE: z.enum(["FOK", "GTC"]).default("FOK"),
  /** Live: ms to wait after submit for both legs to fully fill */
  LIVE_PAIR_CONFIRM_MS: z.coerce.number().default(1500),
  /** Live: market-sell a single filled leg if pair aborts unbalanced */
  LIVE_UNWIND_ONE_LEG: z
    .string()
    .transform((v) => v !== "false" && v !== "0")
    .default("true"),
  /** Starting balance for virtual (dry-run) trading */
  VIRTUAL_STARTING_BALANCE_USD: z.coerce.number().default(1000),
  GAMMA_API_URL: z.string().default("https://gamma-api.polymarket.com"),
  /** Polymarket slug prefix, e.g. btc-updown-5m-{unix_window_start} */
  BTC_UPDOWN_SLUG_PREFIX: z.string().default("btc-updown-5m"),
  BTC_MARKET_WINDOW_MINUTES: z.coerce.number().default(5),
  HTTPS_PROXY: z.string().optional(),
  HTTP_PROXY: z.string().optional(),
  MANUAL_CONDITION_ID: z.string().optional(),
  MANUAL_UP_TOKEN_ID: z.string().optional(),
  MANUAL_DOWN_TOKEN_ID: z.string().optional(),
  MANUAL_MARKET_QUESTION: z.string().optional(),
  MANUAL_MARKET_END_DATE: z.string().optional(),
  MANUAL_WINDOW_MINUTES: z.coerce.number().default(5),
  POLYGON_RPC_URL: z.string().default("https://polygon-rpc.com"),
  RELAYER_URL: z.string().default("https://relayer-v2.polymarket.com/"),
  /** Wait after window end before first live redeem attempt */
  LIVE_REDEEM_DELAY_MS: z.coerce.number().default(15_000),
  /** Poll interval while waiting for Gamma resolution + redeem */
  LIVE_REDEEM_POLL_MS: z.coerce.number().default(10_000),
  /** Max time to keep retrying redeem for a closed window */
  LIVE_REDEEM_MAX_WAIT_MS: z.coerce.number().default(600_000),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
