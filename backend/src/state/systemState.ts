import { env } from "../config/env.js";
import {
  historyModeFromBotMode,
  historyModeFromSimulated,
  type HistoryMode,
} from "../storage/historyMode.js";
import { resetSettlementState } from "../settlement/settlementGuard.js";
import type { BotMode } from "../bot/botMode.js";
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

function emptyPosition(): PositionState {
  return {
    upShares: 0,
    downShares: 0,
    exposureUsd: 0,
    windowId: null,
  };
}

function emptyPnl(): PnlState {
  return {
    realized: 0,
    unrealized: 0,
    daily: 0,
    updatedAt: new Date().toISOString(),
  };
}

/** Per-mode trading history (orders, position, P/L, settlements). */
interface ModeTradingState {
  orders: OrderRecord[];
  position: PositionState;
  pnl: PnlState;
  lastClosedWindow: LastClosedWindowState | null;
  windowsCompleted: number;
}

function emptyModeTradingState(): ModeTradingState {
  return {
    orders: [],
    position: emptyPosition(),
    pnl: emptyPnl(),
    lastClosedWindow: null,
    windowsCompleted: 0,
  };
}

class SystemStateStore {
  market: MarketState = { ...emptyMarket };
  bot: BotState = { ...emptyBot };

  /** Paper (dry-run) session — separate from live. */
  paper: ModeTradingState = emptyModeTradingState();

  /** Live (real CLOB) session — separate from paper. */
  live: ModeTradingState = emptyModeTradingState();

  virtualAccount: VirtualAccountState = {
    balanceUsd: env.VIRTUAL_STARTING_BALANCE_USD,
    startingBalanceUsd: env.VIRTUAL_STARTING_BALANCE_USD,
  };

  connectivity: ConnectivityState = { ...emptyConnectivity };

  private session(mode: HistoryMode): ModeTradingState {
    return mode === "paper" ? this.paper : this.live;
  }

  activeMode(): HistoryMode {
    return historyModeFromBotMode(this.bot.mode as BotMode);
  }

  activeSession(): ModeTradingState {
    return this.session(this.activeMode());
  }

  getSnapshot(): SystemSnapshot {
    const active = this.activeSession();
    return {
      market: structuredClone(this.market),
      bot: structuredClone(this.bot),
      orders: structuredClone(active.orders),
      position: structuredClone(active.position),
      pnl: structuredClone(active.pnl),
      virtualAccount: structuredClone(this.virtualAccount),
      connectivity: structuredClone(this.connectivity),
      lastClosedWindow: structuredClone(active.lastClosedWindow),
      windowsCompleted: active.windowsCompleted,
    };
  }

  getOrders(mode?: HistoryMode): OrderRecord[] {
    return this.session(mode ?? this.activeMode()).orders;
  }

  resetVirtualBalance(): void {
    this.virtualAccount = {
      balanceUsd: env.VIRTUAL_STARTING_BALANCE_USD,
      startingBalanceUsd: env.VIRTUAL_STARTING_BALANCE_USD,
    };
    this.paper = emptyModeTradingState();
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
    const mode = historyModeFromSimulated(order.simulated);
    const s = this.session(mode);
    s.orders = [order, ...s.orders].slice(0, 200);
  }

  updateOrder(orderId: string, partial: Partial<OrderRecord>): void {
    for (const mode of ["paper", "live"] as const) {
      const s = this.session(mode);
      if (!s.orders.some((o) => o.id === orderId)) continue;
      s.orders = s.orders.map((o) =>
        o.id === orderId ? { ...o, ...partial } : o,
      );
      return;
    }
  }

  patchPosition(
    partial: Partial<PositionState>,
    mode: HistoryMode = this.activeMode(),
  ): void {
    const s = this.session(mode);
    s.position = { ...s.position, ...partial };
  }

  patchPnl(
    partial: Partial<PnlState>,
    mode: HistoryMode = this.activeMode(),
  ): void {
    const s = this.session(mode);
    s.pnl = {
      ...s.pnl,
      ...partial,
      updatedAt: new Date().toISOString(),
    };
  }

  patchVirtualAccount(partial: Partial<VirtualAccountState>): void {
    this.virtualAccount = { ...this.virtualAccount, ...partial };
  }

  setLastClosedWindow(
    value: LastClosedWindowState | null,
    mode: HistoryMode = "paper",
  ): void {
    this.session(mode).lastClosedWindow = value
      ? structuredClone(value)
      : null;
  }

  incrementWindowsCompleted(mode: HistoryMode = "paper"): void {
    this.session(mode).windowsCompleted += 1;
  }
}

export const systemState = new SystemStateStore();
