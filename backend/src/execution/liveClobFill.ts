import type { TrackedLiveOrder } from "./liveOrderTracker.js";

export function clobOrderStatus(raw: unknown): string {
  return String((raw as { status?: string })?.status ?? "").toUpperCase();
}

export function clobFillState(raw: unknown): { matched: number; size: number } {
  const o = raw as {
    size_matched?: string | number;
    sizeMatched?: string | number;
    original_size?: string | number;
    originalSize?: string | number;
    size?: string | number;
  };
  return {
    matched: Number(o.size_matched ?? o.sizeMatched ?? 0),
    size: Number(o.original_size ?? o.originalSize ?? o.size ?? 0),
  };
}

export function isClobFilled(raw: unknown): boolean {
  const status = clobOrderStatus(raw);
  if (
    status.includes("MATCHED") ||
    status.includes("FILLED") ||
    status.includes("EXECUTED")
  ) {
    return true;
  }
  const { matched, size } = clobFillState(raw);
  return size > 0 && matched >= size * 0.999;
}

export function isClobCancelled(raw: unknown): boolean {
  return clobOrderStatus(raw).includes("CANCEL");
}

export async function syncTrackedFillSize(
  legs: TrackedLiveOrder[],
): Promise<void> {
  const { getClobClient } = await import("../polymarket/clobClient.js");
  const clob = await getClobClient();
  if (!clob) return;

  for (const tracked of legs) {
    try {
      const raw = await clob.getOrder(tracked.orderId);
      if (isClobCancelled(raw)) {
        tracked.filledSize = 0;
        continue;
      }
      tracked.filledSize = clobFillState(raw).matched;
    } catch {
      /* ignore */
    }
  }
}
