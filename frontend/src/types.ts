export type SignalSide = "UP" | "DOWN" | "NO_TRADE";
export type BotStatus = "stopped" | "running" | "paused";

export interface ConnectivityState {
  gamma: string;
  gammaError: string | null;
  clob: string;
  clobError: string | null;
}

export interface SystemSnapshot {
  connectivity?: ConnectivityState;
  market: {
    market: {
      conditionId: string;
      question: string;
      slug: string;
      windowMinutes: number;
      windowStartUnix: number;
      endDate: string;
      upTokenId: string;
      downTokenId: string;
    } | null;
    upBook: { bestBid: number | null; bestAsk: number | null; mid: number | null } | null;
    downBook: { bestBid: number | null; bestAsk: number | null; mid: number | null } | null;
    btc: {
      price: number;
      startPrice: number | null;
      distancePct: number | null;
      stale: boolean;
      updatedAt: string;
    };
    connectivity?: ConnectivityState;
  };
  bot: {
    status: string;
    mode: string;
    enabled: boolean;
    currentSignal: {
      side: SignalSide;
      confidence: number;
      votes: { strategy: string; side: SignalSide; score: number; reason: string }[];
    } | null;
    lastTickAt: string | null;
    error: string | null;
  };
  orders: {
    id: string;
    tokenId: string;
    side: string;
    price: number;
    size: number;
    status: string;
    simulated: boolean;
    createdAt: string;
  }[];
  position: { upShares: number; downShares: number; exposureUsd: number };
  pnl: { realized: number; unrealized: number; daily: number };
  virtualAccount: { balanceUsd: number; startingBalanceUsd: number };
}

export type TradingMoneyMode = "virtual" | "real";
