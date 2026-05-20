import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AppConfig,
  botStart,
  botStop,
  cancelAllOrders,
  connectWs,
  fetchConfig,
  fetchHistory,
  fetchState,
  resetVirtualBalance,
  setBotMode,
} from "./api/client";
import type { BotStatus, SystemSnapshot, TradingMoneyMode } from "./types";
import { TokenBookPrices } from "./components/TokenBookPrices";
import { botStatusLabel, fmt, fmtUsd, shortAddr } from "./utils/format";
import {
  history24hSummary,
  pairCost,
  pnlIfSideWins,
  windowProgress,
} from "./utils/metrics";

export default function App() {
  const [snap, setSnap] = useState<SystemSnapshot | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uptimeSec, setUptimeSec] = useState(0);
  const [sessionStart] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const [data, cfg] = await Promise.all([fetchState(), fetchConfig()]);
      setSnap(data);
      setConfig(cfg);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, []);

  useEffect(() => {
    refresh();
    const off = connectWs(setSnap);
    const poll = setInterval(refresh, 5000);
    const uptime = setInterval(() => {
      setUptimeSec(Math.floor((Date.now() - sessionStart) / 1000));
    }, 1000);
    return () => {
      off();
      clearInterval(poll);
      clearInterval(uptime);
    };
  }, [refresh, sessionStart]);

  const m = snap?.market;
  const bot = snap?.bot;
  const conn = snap?.connectivity ?? m?.connectivity;
  const isVirtual = bot?.mode === "dry-run";
  const botStatus = (bot?.status ?? "stopped") as BotStatus;
  const isRunning = botStatus === "running" && Boolean(bot?.enabled);
  const market = m?.market;
  const win = windowProgress(market ?? null);
  const pc = pairCost(snap);
  const virtualBal = snap?.virtualAccount;
  const totalValue = isVirtual
    ? (virtualBal?.balanceUsd ?? 0) + (snap?.position.exposureUsd ?? 0)
    : (snap?.position.exposureUsd ?? 0);

  const connError =
    conn?.gammaError ||
    conn?.clobError ||
    (conn?.gamma === "error" ? "Gamma API unreachable" : null);

  const upShares = snap?.position.upShares ?? 0;
  const downShares = snap?.position.downShares ?? 0;
  const unmatched = Math.abs(upShares - downShares);
  const matched = Math.min(upShares, downShares);
  const matchedProfit =
    pc != null && matched > 0 ? matched * (1 - pc) : null;

  const histSummary = useMemo(
    () => history24hSummary(snap?.orders ?? []),
    [snap?.orders],
  );

  const handleBotStart = async () => {
    try {
      const botState = await botStart();
      console.log(
        "[bot] Bot started — status=%s enabled=%s mode=%s",
        botState.status,
        botState.enabled,
        botState.mode,
      );
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[bot] Start failed:", msg);
      setError(msg);
    }
  };

  const handleBotStop = async () => {
    try {
      const botState = await botStop();
      console.log(
        "[bot] Bot stopped — status=%s enabled=%s",
        botState.status,
        botState.enabled,
      );
      await refresh();
    } catch (e) {
      console.error("[bot] Stop failed:", e);
    }
  };

  const handleBotModeChange = async (mode: TradingMoneyMode) => {
    const switchingToPaper = mode === "virtual";
    if (switchingToPaper === isVirtual) return;

    try {
      if (isRunning) {
        await botStop();
        console.log("[bot] Stopped before switching to %s mode", mode);
      }
      await setBotMode(mode);
      console.log("[bot] Mode set to %s", mode);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[bot] Mode change failed:", msg);
      setError(msg);
    }
  };

  const downloadJson = async () => {
    const orders = snap?.orders ?? (await fetchHistory("orders", 500));
    const blob = new Blob([JSON.stringify(orders, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trading-history-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const signal = bot?.currentSignal;
  const pnlUp = pnlIfSideWins(snap, "UP");
  const pnlDown = pnlIfSideWins(snap, "DOWN");

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="dash-title-block">
          <h1>BTC Up/Down Bot</h1>
          <p className="dash-subtitle">
            5-minute BTC up/down · Polymarket CLOB V2
          </p>
        </div>
        <div className="dash-header-right">
          <div className="badge-row">
            <span className={`badge badge-${botStatus}`}>
              {botStatusLabel(botStatus)}
            </span>
            <span className={`badge ${isVirtual ? "badge-paper" : "badge-live"}`}>
              {isVirtual ? "PAPER" : "LIVE"}
            </span>
          </div>
          <div className="header-btns">
            <button type="button" className="btn-outline" onClick={downloadJson}>
              Download JSON
            </button>
          </div>
        </div>
      </header>

      {(error || connError) && (
        <div className="alert alert-error">
          {error || connError}
        </div>
      )}

      <div className="dash-layout">
        <aside className="sidebar">
          <section className="side-card wallet-bar">
            <h3>Wallet</h3>
            <div className="wallet-addrs">
              <div>
                <span className="lbl">PUBLIC WALLET (METAMASK)</span>
                <code>{shortAddr(config?.publicWallet)}</code>
              </div>
              <div>
                <span className="lbl">PROXY WALLET (POLYMARKET)</span>
                <code>{shortAddr(config?.proxyWallet)}</code>
              </div>
              <div>
                <span className="lbl">UPTIME</span>
                <span>{uptimeSec}s</span>
              </div>
            </div>
            <div className="wallet-total">
              <span className="lbl">TOTAL VALUE (USDC + POSITIONS)</span>
              <span className="total-num">{fmtUsd(totalValue)}</span>
            </div>
            <div className="wallet-cards">
              <article>
                <span className="lbl">
                  {isVirtual ? "PAPER BALANCE" : "POLYMARKET USDC"}
                </span>
                <span className="wallet-amt">
                  {fmtUsd(isVirtual ? virtualBal?.balanceUsd : totalValue)}
                </span>
              </article>
              <article>
                <span className="lbl">METAMASK WALLET</span>
                <span className="wallet-amt">{fmtUsd(isVirtual ? 0 : 0)}</span>
              </article>
            </div>
          </section>

          <section className="side-card">
            <h3>Mandatory purchase signal</h3>
            <select className="select-market" value={market?.conditionId ?? ""} disabled>
              <option>
                {market?.question ?? "Searching for BTC up/down market…"}
              </option>
            </select>
          </section>

          <section className="side-card signal-wait">
            <h3>Waiting for signal</h3>
            <p className={`signal-side signal-${signal?.side ?? "NONE"}`}>
              {signal?.side ?? "NO_TRADE"}
            </p>
            <dl className="signal-dl">
              <div>
                <dt>UP mid</dt>
                <dd>{fmt(m?.upBook?.mid, 3)}</dd>
              </div>
              <div>
                <dt>DOWN mid</dt>
                <dd>{fmt(m?.downBook?.mid, 3)}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{fmt((signal?.confidence ?? 0) * 100, 0)}%</dd>
              </div>
              <div>
                <dt>Spot</dt>
                <dd>${fmt(m?.btc.price)}</dd>
              </div>
              <div>
                <dt>Open</dt>
                <dd>${fmt(m?.btc.startPrice)}</dd>
              </div>
              <div>
                <dt>Gap</dt>
                <dd>{fmt(m?.btc.distancePct, 3)}%</dd>
              </div>
            </dl>
          </section>

          <section className="side-card side-controls">
            <h3>Bot</h3>
            <div className="btn-row-compact">
              <button
                type="button"
                disabled={isRunning}
                title={isRunning ? "Bot already running" : "Start bot"}
                onClick={handleBotStart}
              >
                Start
              </button>
              <button
                type="button"
                className="secondary"
                disabled={botStatus === "stopped"}
                onClick={handleBotStop}
              >
                Stop
              </button>
            </div>
            <div className="btn-row-compact">
              <button
                type="button"
                className={isVirtual ? "mode-on" : "secondary"}
                disabled={isVirtual}
                title={isVirtual ? "Already in paper mode" : "Switch to paper (stops bot)"}
                onClick={() => handleBotModeChange("virtual")}
              >
                Paper
              </button>
              <button
                type="button"
                className={!isVirtual ? "mode-live-on" : "secondary"}
                disabled={!isVirtual}
                title={!isVirtual ? "Already in live mode" : "Switch to live (stops bot)"}
                onClick={() => handleBotModeChange("real")}
              >
                Live
              </button>
            </div>
            {isVirtual && (
              <button
                type="button"
                className="secondary full"
                onClick={() => resetVirtualBalance().then(refresh)}
              >
                Reset paper balance
              </button>
            )}
            {!isVirtual && (
              <button
                type="button"
                className="danger full"
                onClick={() => cancelAllOrders().then(refresh)}
              >
                Cancel all orders
              </button>
            )}
          </section>
        </aside>

        <main className="main-panel">
          <section className="window-bar">
            <div className="window-bar-top">
              <span>
                Window ({market?.windowMinutes ?? 5}m){" "}
                <code className="slug">{market?.slug ?? "—"}</code>
              </span>
              <span className="window-remaining">
                {win.remainingSec}s remaining — ends {win.endLabel}
              </span>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${win.pct}%` }}
              />
            </div>
          </section>

          <section className="token-prices-row">
            <TokenBookPrices
              title="UP token"
              book={m?.upBook}
              variant="up"
              errorHint={conn?.clobError}
            />
            <TokenBookPrices
              title="DOWN token"
              book={m?.downBook}
              variant="down"
              errorHint={conn?.clobError}
            />
          </section>

          <section className="metric-row four">
            <article className="metric-card">
              <span className="lbl">PAIR COST</span>
              <span className="val">{fmt(pc, 3)}</span>
              <span className="val-sub">
                Ask sum{" "}
                {fmt(
                  m?.upBook?.bestAsk != null && m?.downBook?.bestAsk != null
                    ? m.upBook.bestAsk + m.downBook.bestAsk
                    : null,
                  3,
                )}
              </span>
            </article>
            <article className="metric-card">
              <span className="lbl">MATCHED PROFIT</span>
              <span className="val val-green">
                {matchedProfit != null ? fmtUsd(matchedProfit) : "—"}
              </span>
            </article>
            <article className="metric-card">
              <span className="lbl">UNMATCHED EXPOSURE</span>
              <span className="val">
                {unmatched === 0 ? "Balanced" : `${unmatched} sh`}
              </span>
            </article>
            <article className="metric-card">
              <span className="lbl">TRACKED QTY UP / DOWN</span>
              <span className="val">
                {upShares} / {downShares}
              </span>
            </article>
          </section>

          <section className="pnl-row">
            <article className="pnl-card">
              <h3>AFTER PNL IF UP (GROSS)</h3>
              <p className="pnl-big val-green">{fmtUsd(pnlUp)}</p>
              <p className="pnl-sub">
                UP shares {upShares} · exposure {fmtUsd(snap?.position.exposureUsd)}
              </p>
            </article>
            <article className="pnl-card">
              <h3>AFTER PNL IF DOWN (GROSS)</h3>
              <p className="pnl-big val-down">{fmtUsd(pnlDown)}</p>
              <p className="pnl-sub">
                DOWN shares {downShares} · mid {fmt(m?.downBook?.mid, 3)}
              </p>
            </article>
          </section>

          <section className="metric-row five">
            <article className="metric-card sm">
              <span className="lbl">LAST CLOSED — REALIZED P/L</span>
              <span className="val">{fmtUsd(snap?.pnl.realized)}</span>
            </article>
            <article className="metric-card sm">
              <span className="lbl">WINNER (LAST CLOSED)</span>
              <span className="val">Pending</span>
            </article>
            <article className="metric-card sm">
              <span className="lbl">CUMULATIVE P/L</span>
              <span className="val">{fmtUsd(snap?.pnl.daily)}</span>
            </article>
            <article className="metric-card sm">
              <span className="lbl">WINDOWS COMPLETED</span>
              <span className="val">—</span>
            </article>
            <article className="metric-card sm">
              <span className="lbl">PENDING / FAILURES</span>
              <span className="val">
                {(snap?.orders ?? []).filter((o) => o.status.includes("FAIL")).length}
              </span>
            </article>
          </section>

          <section className="history-section">
            <div className="history-head">
              <h2>
                {isVirtual ? "PAPER TRADING" : "LIVE TRADING"} — TRADING HISTORY
              </h2>
              <div className="history-stats">
                <span>
                  SIMULATED BALANCE {fmtUsd(virtualBal?.balanceUsd)}
                </span>
                <span>24h Windows —</span>
                <span>Orders {histSummary.orders}</span>
                <span>Spent {fmtUsd(histSummary.spent)}</span>
                <span>Net {fmtUsd(histSummary.net)}</span>
              </div>
            </div>
            <div className="table-wrap">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Side</th>
                    <th>Price</th>
                    <th>Size</th>
                    <th>Status</th>
                    <th>Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {(snap?.orders ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="empty-row">
                        No orders yet — start the bot in paper mode to simulate
                      </td>
                    </tr>
                  ) : (
                    (snap?.orders ?? []).slice(0, 20).map((o) => (
                      <tr key={o.id}>
                        <td>{new Date(o.createdAt).toLocaleString()}</td>
                        <td>{o.side}</td>
                        <td>{fmt(o.price, 3)}</td>
                        <td>{o.size}</td>
                        <td>{o.status}</td>
                        <td>{o.simulated ? "Paper" : "Live"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
