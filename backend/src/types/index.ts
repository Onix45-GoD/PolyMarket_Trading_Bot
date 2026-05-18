export type { BotMode } from "../bot/botMode.js";
import type { BotMode } from "../bot/botMode.js";
export type BotStatus = "stopped" | "running" | "paused";
export type SignalSide = "UP" | "DOWN" | "NO_TRADE";

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBookSnapshot {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  bestBid: number | null;
  bestAsk: number | null;
  mid: number | null;
  updatedAt: string;
}

export interface BtcPriceState {
  price: number;
  startPrice: number | null;
  distancePct: number | null;
  updatedAt: string;
  stale: boolean;
}

export interface ActiveMarket {
  conditionId: string;
  question: string;
  slug: string;
  windowMinutes: number;
  /** Unix seconds at window open (from slug suffix) */
  windowStartUnix: number;
  endDate: string;
  upTokenId: string;
  downTokenId: string;
}

export interface ConnectivityState {
  gamma: "ok" | "error" | "empty" | "manual" | "unknown";
  gammaError: string | null;
  clob: "ok" | "error" | "no_client" | "unknown";
  clobError: string | null;
}

export interface MarketState {
  market: ActiveMarket | null;
  upBook: OrderBookSnapshot | null;
  downBook: OrderBookSnapshot | null;
  btc: BtcPriceState;
  connectivity: ConnectivityState;
  updatedAt: string;
}

export interface StrategyVote {
  strategy: string;
  side: SignalSide;
  score: number;
  reason: string;
}

export interface BotSignal {
  side: SignalSide;
  confidence: number;
  votes: StrategyVote[];
  timestamp: string;
}

export interface BotState {
  status: BotStatus;
  mode: BotMode;
  enabled: boolean;
  currentSignal: BotSignal | null;
  lastTickAt: string | null;
  error: string | null;
}

export interface OrderRecord {
  id: string;
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  status: string;
  simulated: boolean;
  createdAt: string;
}

export interface PositionState {
  upShares: number;
  downShares: number;
  exposureUsd: number;
  windowId: string | null;
}

export interface PnlState {
  realized: number;
  unrealized: number;
  daily: number;
  updatedAt: string;
}

/** Simulated account balance (dry-run / virtual money only) */
export interface VirtualAccountState {
  balanceUsd: number;
  startingBalanceUsd: number;
}

export interface SystemSnapshot {
  market: MarketState;
  bot: BotState;
  orders: OrderRecord[];
  position: PositionState;
  pnl: PnlState;
  virtualAccount: VirtualAccountState;
  connectivity: ConnectivityState;
}

export type WsEventType =
  | "market.state"
  | "bot.status"
  | "bot.signal"
  | "orders.delta"
  | "position.update"
  | "pnl.update"
  | "error";

export interface WsMessage<T = unknown> {
  v: 1;
  type: WsEventType;
  ts: string;
  payload: T;
}
