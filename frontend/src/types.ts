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
    upBook: {
      bestBid: number | null;
      bestAsk: number | null;
      bestBidSize: number | null;
      bestAskSize: number | null;
      mid: number | null;
    } | null;
    downBook: {
      bestBid: number | null;
      bestAsk: number | null;
      bestBidSize: number | null;
      bestAskSize: number | null;
      mid: number | null;
    } | null;
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
    pairArb: {
      action: "IDLE" | "BUY_PAIR";
      sum: number | null;
      buySum: number | null;
      askSum: number | null;
      size: number;
      reason: string;
      timestamp: string;
    } | null;
    lastTickAt: string | null;
    error: string | null;
  };
  orders: {
    id: string;
    tokenId: string;
    leg: "UP" | "DOWN";
    pairId: string;
    side: string;
    price: number;
    size: number;
    status: string;
    simulated: boolean;
    createdAt: string;
  }[];
  position: {
    upShares: number;
    downShares: number;
    exposureUsd: number;
    windowId?: string | null;
  };
  pnl: { realized: number; unrealized: number; daily: number };
  virtualAccount: { balanceUsd: number; startingBalanceUsd: number };
  lastClosedWindow: {
    windowId: string;
    slug: string;
    winner: "UP" | "DOWN";
    upShares: number;
    downShares: number;
    payoutUsd: number;
    costUsd: number;
    profitUsd: number;
    btcStart: number | null;
    btcEnd: number | null;
    closedAt: string;
    resolutionSource?: "gamma" | "clob" | "btc";
    upPrice?: number | null;
    downPrice?: number | null;
  } | null;
  windowsCompleted: number;
}

export type TradingMoneyMode = "virtual" | "real";
