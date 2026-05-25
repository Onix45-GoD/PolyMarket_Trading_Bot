import { env } from "../config/env.js";
import type { ParsedOrderPost } from "./clobOrderResponse.js";
import { getTradingWalletAddress } from "./walletViem.js";

/** Grep backend logs with: [clob-req] */
export const CLOB_REQ_LOG_PREFIX = "[clob-req]";

export type ClobLeg = "UP" | "DOWN";

function shortToken(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Before sending a pair buy to Polymarket CLOB. */
export function logClobPairBuyStart(params: {
  pairId: string;
  slug: string;
  size: number;
  bidUp: number;
  bidDown: number;
  costUsd: number;
  orderType: string;
}): void {
  const wallet = getTradingWalletAddress();
  console.log(
    `${CLOB_REQ_LOG_PREFIX} ═══ SEND BUY_PAIR → ${env.CLOB_HOST} ═══`,
  );
  console.log(
    `${CLOB_REQ_LOG_PREFIX} pair=${params.pairId} market=${params.slug} wallet=${wallet ?? "—"} chain=${env.CHAIN_ID} sigType=${env.SIGNATURE_TYPE}`,
  );
  console.log(
    `${CLOB_REQ_LOG_PREFIX} size=${params.size} orderType=${params.orderType} cost≈$${params.costUsd.toFixed(2)} bidUp=${params.bidUp} bidDown=${params.bidDown}`,
  );
}

/** Immediately before createAndPostOrder for one leg. */
export function logClobOrderRequest(params: {
  action: "createAndPostOrder" | "createAndPostMarketOrder" | "cancelOrder" | "cancelOrders" | "cancelAll";
  leg?: ClobLeg | string;
  tokenID?: string;
  price?: number;
  size?: number;
  amount?: number;
  side?: string;
  orderType?: string;
  orderID?: string;
}): void {
  const leg = params.leg ? ` ${params.leg}` : "";
  const body: Record<string, unknown> = { action: params.action };
  if (params.tokenID) body.tokenID = shortToken(params.tokenID);
  if (params.price != null) body.price = params.price;
  if (params.size != null) body.size = params.size;
  if (params.amount != null) body.amount = params.amount;
  if (params.side) body.side = params.side;
  if (params.orderType) body.orderType = params.orderType;
  if (params.orderID) body.orderID = params.orderID.slice(0, 18) + "…";
  console.log(
    `${CLOB_REQ_LOG_PREFIX} → POST${leg} ${env.CLOB_HOST} ${safeJson(body)}`,
  );
}

/** After a successful HTTP/SDK round-trip with parsed body. */
export function logClobOrderResponse(params: {
  leg?: ClobLeg | string;
  parsed: ParsedOrderPost;
  elapsedMs: number;
}): void {
  const leg = params.leg ? ` ${params.leg}` : "";
  const p = params.parsed;
  const id = p.orderId ?? "MISSING";
  console.log(
    `${CLOB_REQ_LOG_PREFIX} ← POST${leg} ${params.elapsedMs}ms success=${p.success} orderId=${id} status=${p.status ?? "—"} err=${p.errorMsg ?? "—"}`,
  );
  if (!p.success && p.raw != null) {
    console.log(`${CLOB_REQ_LOG_PREFIX}   raw response: ${safeJson(p.raw)}`);
  }
}

/** SDK threw or network failed before a usable response. */
export function logClobOrderError(params: {
  leg?: ClobLeg | string;
  action: string;
  elapsedMs: number;
  err: unknown;
}): void {
  const leg = params.leg ? ` ${params.leg}` : "";
  const msg = params.err instanceof Error ? params.err.message : String(params.err);
  console.error(
    `${CLOB_REQ_LOG_PREFIX} ✗ ${params.action}${leg} ${params.elapsedMs}ms FAILED: ${msg}`,
  );
  if (params.err instanceof Error && params.err.stack) {
    console.error(`${CLOB_REQ_LOG_PREFIX}   ${params.err.stack.split("\n").slice(0, 3).join("\n   ")}`);
  }
}

/** cancelOrder / cancelAll result. */
export function formatClobRespBrief(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const s = safeJson(raw);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

export function logClobCancelResult(params: {
  action: "cancelOrder" | "cancelOrders" | "cancelAll";
  orderID?: string;
  ok: boolean;
  elapsedMs: number;
  detail?: string;
}): void {
  const target = params.orderID
    ? `orderID=${params.orderID.slice(0, 14)}…`
    : "all open orders";
  const level = params.ok ? console.log : console.warn;
  level(
    `${CLOB_REQ_LOG_PREFIX} ← ${params.action} ${params.elapsedMs}ms ok=${params.ok} ${target}${params.detail ? ` ${params.detail}` : ""}`,
  );
}
