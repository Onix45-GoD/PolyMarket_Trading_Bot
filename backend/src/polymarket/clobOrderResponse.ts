/** Parse POST /order response from @polymarket/clob-client-v2 (shape varies). */
export interface ParsedOrderPost {
  orderId: string | null;
  success: boolean;
  errorMsg: string | null;
  status: string | null;
  raw: unknown;
}

export function parseOrderPostResponse(raw: unknown): ParsedOrderPost {
  if (raw == null || typeof raw !== "object") {
    return {
      orderId: null,
      success: false,
      errorMsg: "empty_clob_response",
      status: null,
      raw,
    };
  }

  const o = raw as Record<string, unknown>;

  if ("error" in o && o.error != null) {
    return {
      orderId: null,
      success: false,
      errorMsg: String(o.error),
      status: null,
      raw,
    };
  }

  const orderId =
    (typeof o.orderID === "string" && o.orderID) ||
    (typeof o.orderId === "string" && o.orderId) ||
    (typeof o.id === "string" && o.id) ||
    null;

  const errorMsg =
    typeof o.errorMsg === "string" && o.errorMsg.length > 0
      ? o.errorMsg
      : null;
  const status = typeof o.status === "string" ? o.status : null;
  const successFlag = o.success;
  const success =
    orderId != null &&
    orderId.length > 0 &&
    !orderId.startsWith("local-") &&
    successFlag !== false &&
    !errorMsg;

  return {
    orderId,
    success,
    errorMsg,
    status,
    raw,
  };
}

export function isLocalPlaceholderOrderId(id: string): boolean {
  return id.startsWith("local-");
}
