import type {
  BotState,
  ConnectivityState,
  MarketState,
  OrderRecord,
  PnlState,
  PositionState,
  SystemSnapshot,
} from "../types/index.js";

const emptyConnectivity: ConnectivityState = {
  gamma: "unknown",
  gammaError: null,
  clob: "unknown",
  clobError: null,
};

const emptyMarket: MarketState = {
  market: null,
  upBook: null,
  downBook: null,
  btc: {
    price: 0,
    startPrice: null,
    distancePct: null,
    updatedAt: new Date(0).toISOString(),
    stale: true,
  },
  connectivity: { ...emptyConnectivity },
  updatedAt: new Date().toISOString(),
};

const emptyBot: BotState = {
  status: "stopped",
  mode: "dry-run",
  enabled: false,
  currentSignal: null,
  lastTickAt: null,
  error: null,
};

class SystemStateStore {
  market: MarketState = { ...emptyMarket };
  bot: BotState = { ...emptyBot };
  orders: OrderRecord[] = [];
  position: PositionState = {
    upShares: 0,
    downShares: 0,
    exposureUsd: 0,
    windowId: null,
  };
  pnl: PnlState = {
    realized: 0,
    unrealized: 0,
    daily: 0,
    updatedAt: new Date().toISOString(),
  };

  connectivity: ConnectivityState = { ...emptyConnectivity };

  getSnapshot(): SystemSnapshot {
    return {
      market: structuredClone(this.market),
      bot: structuredClone(this.bot),
      orders: structuredClone(this.orders),
      position: structuredClone(this.position),
      pnl: structuredClone(this.pnl),
      connectivity: structuredClone(this.connectivity),
    };
  }

  patchMarket(partial: Partial<MarketState>): void {
    this.market = {
      ...this.market,
      ...partial,
      connectivity: partial.connectivity ?? this.market.connectivity,
      updatedAt: new Date().toISOString(),
    };
  }

  patchConnectivity(partial: Partial<ConnectivityState>): void {
    this.connectivity = { ...this.connectivity, ...partial };
    this.market.connectivity = { ...this.market.connectivity, ...partial };
  }

  patchBot(partial: Partial<BotState>): void {
    this.bot = { ...this.bot, ...partial };
  }

  addOrder(order: OrderRecord): void {
    this.orders = [order, ...this.orders].slice(0, 200);
  }

  patchPosition(partial: Partial<PositionState>): void {
    this.position = { ...this.position, ...partial };
  }

  patchPnl(partial: Partial<PnlState>): void {
    this.pnl = {
      ...this.pnl,
      ...partial,
      updatedAt: new Date().toISOString(),
    };
  }
}

export const systemState = new SystemStateStore();
