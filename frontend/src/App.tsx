import { useCallback, useEffect, useState } from "react";
import {
  botPause,
  botStart,
  botStop,
  cancelAllOrders,
  connectWs,
  fetchState,
  setBotMode,
} from "./api/client";
import type { SystemSnapshot } from "./types";

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export default function App() {
  const [snap, setSnap] = useState<SystemSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchState();
      setSnap(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    }
  }, []);

  useEffect(() => {
    refresh();
    const off = connectWs(setSnap);
    const id = setInterval(refresh, 10_000);
    return () => {
      off();
      clearInterval(id);
    };
  }, [refresh]);

  const m = snap?.market;
  const bot = snap?.bot;
  const conn = snap?.connectivity ?? m?.connectivity;

  const connError =
    conn?.gammaError ||
    conn?.clobError ||
    (conn?.gamma === "error" ? "Gamma API unreachable" : null);

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>BTC Up/Down Bot</h1>
          <p className="subtitle">Polymarket CLOB V2 · backend-owned trading</p>
        </div>
        <div className="header-actions">
          <span className={`pill status-${bot?.status ?? "stopped"}`}>
            {bot?.status ?? "—"} · {bot?.mode ?? "—"}
          </span>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {connError && (
        <div className="banner error">
          <strong>Backend connectivity</strong>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.9rem" }}>{connError}</p>
          <p className="muted" style={{ margin: "0.5rem 0 0" }}>
            VPN often blocks gamma-api.polymarket.com. Add HTTPS_PROXY to .env, or
            set MANUAL_UP_TOKEN_ID and MANUAL_DOWN_TOKEN_ID from Polymarket.
          </p>
        </div>
      )}

      <section className="grid stats">
        <article className="card">
          <h2>BTC</h2>
          <p className="big">${fmt(m?.btc.price)}</p>
          <p className="muted">
            Start {fmt(m?.btc.startPrice)} · Δ {fmt(m?.btc.distancePct, 3)}%
            {m?.btc.stale ? " · STALE" : ""}
          </p>
        </article>
        <article className="card">
          <h2>Signal</h2>
          <p className={`big signal-${bot?.currentSignal?.side ?? "NONE"}`}>
            {bot?.currentSignal?.side ?? "—"}
          </p>
          <p className="muted">
            Confidence {fmt((bot?.currentSignal?.confidence ?? 0) * 100, 0)}%
          </p>
        </article>
        <article className="card">
          <h2>UP / DOWN</h2>
          <p className="muted">UP mid {fmt(m?.upBook?.mid, 3)}</p>
          <p className="muted">DOWN mid {fmt(m?.downBook?.mid, 3)}</p>
        </article>
        <article className="card">
          <h2>Position</h2>
          <p className="muted">UP {snap?.position.upShares ?? 0} shares</p>
          <p className="muted">DOWN {snap?.position.downShares ?? 0} shares</p>
        </article>
      </section>

      <section className="card market-card">
        <h2>Active market</h2>
        {m?.market ? (
          <>
            <p className="market-title">{m.market.question}</p>
            <p className="muted">
              {m.market.windowMinutes}m window · ends{" "}
              {new Date(m.market.endDate).toLocaleString()}
            </p>
          </>
        ) : (
          <p className="muted">Searching for BTC up/down market…</p>
        )}
      </section>

      <section className="controls card">
        <h2>Bot controls</h2>
        <div className="btn-row">
          <button type="button" onClick={() => botStart().then(refresh)}>
            Start
          </button>
          <button type="button" className="secondary" onClick={() => botPause().then(refresh)}>
            Pause
          </button>
          <button type="button" className="secondary" onClick={() => botStop().then(refresh)}>
            Stop
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setBotMode("dry-run").then(refresh)}
          >
            Dry-run
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => setBotMode("live").then(refresh)}
          >
            Live
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => cancelAllOrders().then(refresh)}
          >
            Cancel all
          </button>
        </div>
        {bot?.error && <p className="error-text">{bot.error}</p>}
      </section>

      <section className="grid two-col">
        <article className="card">
          <h2>Strategy votes</h2>
          <ul className="votes">
            {(bot?.currentSignal?.votes ?? []).map((v) => (
              <li key={v.strategy}>
                <span>{v.strategy}</span>
                <span>{v.side}</span>
                <span>{fmt(v.score, 2)}</span>
              </li>
            ))}
          </ul>
        </article>
        <article className="card">
          <h2>Recent orders</h2>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Side</th>
                <th>Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(snap?.orders ?? []).slice(0, 12).map((o) => (
                <tr key={o.id}>
                  <td>{new Date(o.createdAt).toLocaleTimeString()}</td>
                  <td>{o.side}</td>
                  <td>{fmt(o.price, 3)}</td>
                  <td>{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </section>
    </div>
  );
}
