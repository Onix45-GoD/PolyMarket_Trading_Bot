import { fmt } from "../utils/format";

export interface BookPrices {
  bestBid: number | null;
  bestAsk: number | null;
  mid: number | null;
}

interface Props {
  title: string;
  book: BookPrices | null | undefined;
  variant: "up" | "down";
  errorHint?: string | null;
}

export function TokenBookPrices({ title, book, variant, errorHint }: Props) {
  const spread =
    book?.bestBid != null && book?.bestAsk != null
      ? book.bestAsk - book.bestBid
      : null;

  const hasBid = book?.bestBid != null;
  const hasAsk = book?.bestAsk != null;

  return (
    <article className={`token-price-card token-${variant}`}>
      <h3>{title}</h3>
      <div className="bid-ask-grid">
        <div className={`bid-ask-cell bid ${hasBid ? "" : "empty"}`}>
          <span className="ba-label">Bid</span>
          <span className="ba-price">{fmt(book?.bestBid, 3)}</span>
          <span className="ba-hint">Sell at (bid)</span>
        </div>
        <div className={`bid-ask-cell ask ${hasAsk ? "" : "empty"}`}>
          <span className="ba-label">Ask</span>
          <span className="ba-price">{fmt(book?.bestAsk, 3)}</span>
          <span className="ba-hint">Buy at (ask)</span>
        </div>
      </div>
      <div className="ba-footer">
        <span>
          Mid <strong>{fmt(book?.mid, 3)}</strong>
        </span>
        <span>
          Spread <strong>{spread != null ? fmt(spread, 3) : "—"}</strong>
        </span>
      </div>
      {!hasBid && !hasAsk && (
        <p className="token-missing">{errorHint ?? "No book data yet"}</p>
      )}
      {hasBid && !hasAsk && (
        <p className="token-missing">Ask side empty — thin book</p>
      )}
      {!hasBid && hasAsk && (
        <p className="token-missing">Bid side empty — thin book</p>
      )}
    </article>
  );
}
