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
import { HeldTokenStateCard } from "./components/HeldTokenStateCard";
import { TokenBookPrices } from "./components/TokenBookPrices";
import { botStatusLabel, fmt, fmtQty, fmtUsd, shortAddr } from "./utils/format";
import {
  formatPairArbReason,
  pairArbActionLabel,
} from "./utils/pairArbReason";
import { computeHeldTokenStates } from "./utils/heldTokenState";
import { history24hSummary, pairPositionMetrics, windowProgress } from "./utils/metrics";
import { groupOrdersForDisplay } from "./utils/groupPairOrders";

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
  const heldTokens = useMemo(() => computeHeldTokenStates(snap), [snap]);
  const virtualBal = snap?.virtualAccount;
  const liveUsdc = snap?.liveCollateral;
  const liveCash = liveUsdc?.ok ? (liveUsdc.balanceUsd ?? 0) : null;
  const positionCost = snap?.position.exposureUsd ?? 0;
  const totalValue = isVirtual
    ? (virtualBal?.balanceUsd ?? 0) + positionCost
    : liveCash != null
      ? liveCash + positionCost
      : positionCost;

  const connError =
    conn?.gammaError ||
    conn?.clobError ||
    (conn?.gamma === "error" ? "Gamma API unreachable" : null);

  const upShares = snap?.position.upShares ?? 0;
  const downShares = snap?.position.downShares ?? 0;
  const pairPos = useMemo(() => pairPositionMetrics(snap), [snap]);
  const matched = pairPos?.matched ?? 0;

  const histSummary = useMemo(
    () => history24hSummary(snap?.orders ?? []),
    [snap?.orders],
  );

  const displayOrders = useMemo(
    () => groupOrdersForDisplay(snap?.orders ?? []),
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

    console.log("[ui] Paper/Live button → mode=%s", mode);
    try {
      if (isRunning) {
        await botStop();
        console.log("[ui] Stopped bot before mode switch → %s", mode);
      }
      const botState = await setBotMode(mode);
      console.log(
        "[ui] Mode is now %s (%s)",
        botState.mode,
        botState.mode === "dry-run" ? "paper" : "live",
      );
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[ui] Mode change failed:", msg);
      setError(msg);
    }
  };

  const handleResetVirtualBalance = async () => {
    console.log("[ui] Reset paper balance button clicked");
    try {
      const acct = await resetVirtualBalance();
      console.log("[ui] Paper balance reset → $%s", acct.balanceUsd);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[ui] Reset paper balance failed:", msg);
      setError(msg);
    }
  };

  const handleCancelAllOrders = async () => {
    console.log("[ui] Cancel all orders button clicked (live mode)");
    try {
      const result = await cancelAllOrders();
      console.log(
        "[ui] Cancel all orders done — tracked=%s, marked=%s",
        result.trackedCancelled ?? 0,
        result.ordersMarkedCancelled ?? 0,
      );
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[ui] Cancel all orders failed:", msg);
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

  const pairArb = bot?.pairArb;
  const pairArbReason = formatPairArbReason(pairArb?.reason, {
    botRunning: isRunning,
  });
  const pairBuyQty =
    m?.upBook?.bestBidSize != null && m?.downBook?.bestBidSize != null
      ? Math.min(m.upBook.bestBidSize, m.downBook.bestBidSize)
      : null;
  const lastClosed = snap?.lastClosedWindow;

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
                  {isVirtual ? "PAPER BALANCE" : "POLYMARKET USDC (CLOB)"}
                </span>
                <span className="wallet-amt">
                  {isVirtual
                    ? fmtUsd(virtualBal?.balanceUsd)
                    : liveCash != null
                      ? fmtUsd(liveCash)
                      : "—"}
                </span>
                {!isVirtual && liveUsdc && !liveUsdc.ok && liveUsdc.error && (
                  <span className="lbl" style={{ color: "var(--warn, #c90)" }}>
                    {liveUsdc.error}
                  </span>
                )}
              </article>
              <article>
                <span className="lbl">
                  {isVirtual ? "METAMASK WALLET" : "OPEN POSITION (COST)"}
                </span>
                <span className="wallet-amt">
                  {fmtUsd(isVirtual ? 0 : positionCost)}
                </span>
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
            <h3>Pair arb</h3>
            <p className={`signal-side signal-${pairArb?.action ?? "IDLE"}`}>
              {pairArbActionLabel(pairArb?.action)}
            </p>
            <dl className="signal-dl">
              <div>
                <dt>Buy sum (ask)</dt>
                <dd>{fmt(pairArb?.buySum, 4)}</dd>
              </div>
              <div>
                <dt>Bid sum</dt>
                <dd>{fmt(pairArb?.askSum, 4)}</dd>
              </div>
              <div>
                <dt>Pair buy qty (ask)</dt>
                <dd>{fmtQty(pairBuyQty)} sh</dd>
              </div>
              <div>
                <dt>Next size</dt>
                <dd>{pairArb?.size ?? 0} sh</dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd className="reason-dd" title={pairArb?.reason ?? undefined}>
                  {pairArbReason}
                </dd>
              </div>
              <div>
                <dt>UP / DOWN held</dt>
                <dd>
                  {upShares} / {downShares}
                </dd>
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
                onClick={handleResetVirtualBalance}
              >
                Reset paper balance
              </button>
            )}
            {!isVirtual && (
              <button
                type="button"
                className="danger full"
                onClick={handleCancelAllOrders}
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

          <section className="held-token-row">
            <HeldTokenStateCard
              title="UP token — your position"
              state={heldTokens.up}
              variant="up"
            />
            <HeldTokenStateCard
              title="DOWN token — your position"
              state={heldTokens.down}
              variant="down"
            />
          </section>

          <section className="pnl-row pnl-row-single">
            <article className="pnl-card">
              <h3>SETTLEMENT P/L (PAIR — $1 PER WINNING SHARE)</h3>
              {pairPos && matched > 0 && pairPos.balanced ? (
                <>
                  <p
                    className={`pnl-big ${
                      (pairPos.settlementPnl ?? 0) >= 0 ? "val-green" : "val-down"
                    }`}
                  >
                    {fmtUsd(pairPos.settlementPnl)}
                  </p>
                  <p className="pnl-sub">
                    Same profit whether UP or DOWN wins · matched {matched} sh
                    · avg buy sum {fmt(pairPos.avgBuySum, 3)} · cost{" "}
                    {fmtUsd(pairPos.exposureUsd)}
                  </p>
                </>
              ) : pairPos && matched > 0 && !pairPos.balanced ? (
                <>
                  <p className="pnl-big val-warn">Unbalanced pair</p>
                  <p className="pnl-sub">
                    Matched {matched} sh · extra{" "}
                    {pairPos.unmatched} sh on{" "}
                    {upShares > downShares ? "UP" : "DOWN"} · cost{" "}
                    {fmtUsd(pairPos.exposureUsd)}
                  </p>
                  <p className="pnl-sub">
                    If UP wins {fmtUsd(pairPos.pnlIfUpWins)} · If DOWN wins{" "}
                    {fmtUsd(pairPos.pnlIfDownWins)}
                  </p>
                </>
              ) : (
                <>
                  <p className="pnl-big">{fmtUsd(pairPos?.settlementPnl ?? 0)}</p>
                  <p className="pnl-sub">
                    No open pair · buy UP+DOWN together when ask sum ≤ threshold
                  </p>
                </>
              )}
            </article>
          </section>

          <section className="metric-row five">
            <article className="metric-card sm">
              <span className="lbl">LAST CLOSED — REALIZED P/L</span>
              <span className="val">
                {lastClosed != null ? fmtUsd(lastClosed.profitUsd) : "—"}
              </span>
            </article>
            <article className="metric-card sm">
              <span className="lbl">WINNER (LAST CLOSED)</span>
              <span className="val">{lastClosed?.winner ?? "—"}</span>
            </article>
            <article className="metric-card sm">
              <span className="lbl">CUMULATIVE P/L</span>
              <span className="val">{fmtUsd(snap?.pnl.realized)}</span>
            </article>
            <article className="metric-card sm">
              <span className="lbl">WINDOWS COMPLETED</span>
              <span className="val">{snap?.windowsCompleted ?? 0}</span>
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
                {isVirtual && (
                  <span>
                    SIMULATED BALANCE {fmtUsd(virtualBal?.balanceUsd)}
                  </span>
                )}
                <span>Windows {snap?.windowsCompleted ?? 0}</span>
                <span>
                  Benefit (last window){" "}
                  {lastClosed != null ? (
                    <span
                      className={
                        lastClosed.profitUsd >= 0 ? "hist-benefit-pos" : "hist-benefit-neg"
                      }
                    >
                      {fmtUsd(lastClosed.profitUsd)}
                    </span>
                  ) : (
                    "—"
                  )}
                  {lastClosed != null ? ` · ${lastClosed.winner} won` : ""}
                </span>
                <span>Orders {histSummary.orders}</span>
              </div>
            </div>
            <div className="table-wrap">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Leg</th>
                    <th>Side</th>
                    <th>Price</th>
                    <th>Size</th>
                    <th>Benefit</th>
                    <th>Status</th>
                    <th>Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {displayOrders.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="empty-row">
                        No orders yet — start the bot in paper mode to simulate
                      </td>
                    </tr>
                  ) : (
                    displayOrders.slice(0, 20).map((o) => (
                      <tr key={o.key}>
                        <td>{new Date(o.createdAt).toLocaleString()}</td>
                        <td>{o.leg}</td>
                        <td>{o.side}</td>
                        <td
                          title={
                            o.leg === "PAIR" && o.upPrice != null && o.downPrice != null
                              ? `UP ${fmt(o.upPrice, 3)} + DOWN ${fmt(o.downPrice, 3)}`
                              : undefined
                          }
                        >
                          {fmt(o.price, 3)}
                        </td>
                        <td>{o.size}</td>
                        <td
                          className={
                            o.benefitUsd != null
                              ? o.benefitUsd >= 0
                                ? "hist-benefit-pos"
                                : "hist-benefit-neg"
                              : undefined
                          }
                          title={
                            o.benefitUsd != null
                              ? o.leg === "PAIR"
                                ? `At settlement: ${o.size} sh × $1 − cost ${fmtUsd(o.costUsd)}`
                                : `If ${o.leg} wins: payout $${o.size} − cost ${fmtUsd(o.costUsd)}`
                              : undefined
                          }
                        >
                          {o.benefitUsd != null ? fmtUsd(o.benefitUsd) : "—"}
                        </td>
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
