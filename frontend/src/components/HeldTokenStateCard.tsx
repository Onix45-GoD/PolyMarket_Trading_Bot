import { fmt, fmtQty, fmtUsd } from "../utils/format";
import type { HeldLegState } from "../utils/heldTokenState";

function shortToken(id: string | null): string {
  if (!id) return "—";
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function statusLabel(status: string | null): string {
  if (!status) return "—";
  return status.replace(/_/g, " ");
}

export function HeldTokenStateCard({
  title,
  state,
  variant,
}: {
  title: string;
  state: HeldLegState;
  variant: "up" | "down";
}) {
  const hasShares = state.shares >= 0.001;

  return (
    <article className={`held-token-card token-${variant}`}>
      <h3>{title}</h3>
      <div className="held-token-grid">
        <div className="held-token-stat">
          <span className="lbl">Shares held</span>
          <span className="held-val">{fmtQty(state.shares)}</span>
        </div>
        <div className="held-token-stat">
          <span className="lbl">Avg buy price</span>
          <span className="held-val">
            {state.avgBuyPrice != null ? fmt(state.avgBuyPrice, 3) : "—"}
          </span>
        </div>
        <div className="held-token-stat">
          <span className="lbl">Cost basis</span>
          <span className="held-val">
            {state.costUsd != null && state.costUsd > 0
              ? fmtUsd(state.costUsd)
              : "—"}
          </span>
        </div>
        <div className="held-token-stat">
          <span className="lbl">Last order</span>
          <span className="held-val held-status">
            {statusLabel(state.lastOrderStatus)}
          </span>
        </div>
      </div>
      <p className="held-token-meta">
        Token <code>{shortToken(state.tokenId)}</code>
        {state.lastOrderAt && (
          <>
            {" "}
            · updated {new Date(state.lastOrderAt).toLocaleTimeString()}
          </>
        )}
      </p>
      {!hasShares && (
        <p className="held-token-empty">No {state.leg} shares bought this session</p>
      )}
    </article>
  );
}
