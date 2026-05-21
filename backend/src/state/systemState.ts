import { env } from "../config/env.js";
import { resetSettlementState } from "../settlement/settlementGuard.js";
import type {
  BotState,
  ConnectivityState,
  LastClosedWindowState,
  MarketState,
  OrderRecord,
  PnlState,
  PositionState,
  SystemSnapshot,
  VirtualAccountState,
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
  pairArb: null,
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

  virtualAccount: VirtualAccountState = {
    balanceUsd: env.VIRTUAL_STARTING_BALANCE_USD,
    startingBalanceUsd: env.VIRTUAL_STARTING_BALANCE_USD,
  };

  connectivity: ConnectivityState = { ...emptyConnectivity };
  lastClosedWindow: LastClosedWindowState | null = null;
  windowsCompleted = 0;

  getSnapshot(): SystemSnapshot {
    return {
      market: structuredClone(this.market),
      bot: structuredClone(this.bot),
      orders: structuredClone(this.orders),
      position: structuredClone(this.position),
      pnl: structuredClone(this.pnl),
      virtualAccount: structuredClone(this.virtualAccount),
      connectivity: structuredClone(this.connectivity),
      lastClosedWindow: structuredClone(this.lastClosedWindow),
      windowsCompleted: this.windowsCompleted,
    };
  }

  resetVirtualBalance(): void {
    this.virtualAccount = {
      balanceUsd: env.VIRTUAL_STARTING_BALANCE_USD,
      startingBalanceUsd: env.VIRTUAL_STARTING_BALANCE_USD,
    };
    this.pnl = {
      realized: 0,
      unrealized: 0,
      daily: 0,
      updatedAt: new Date().toISOString(),
    };
    this.position = {
      upShares: 0,
      downShares: 0,
      exposureUsd: 0,
      windowId: null,
    };
    this.lastClosedWindow = null;
    this.windowsCompleted = 0;
    resetSettlementState();
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

  updateOrder(orderId: string, partial: Partial<OrderRecord>): void {
    this.orders = this.orders.map((o) =>
      o.id === orderId ? { ...o, ...partial } : o,
    );
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

  patchVirtualAccount(partial: Partial<VirtualAccountState>): void {
    this.virtualAccount = { ...this.virtualAccount, ...partial };
  }
}

export const systemState = new SystemStateStore();
