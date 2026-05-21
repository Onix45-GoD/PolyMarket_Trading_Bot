import type { LastClosedWindowState } from "../types/index.js";

/** Already paid out this window (prevents duplicate balance credits). */
const settledWindowIds = new Set<string>();

/** In-flight settlement per window (parallel callers await the same run). */
const settlingByWindowId = new Map<
  string,
  Promise<LastClosedWindowState | null>
>();

export function resetSettlementState(): void {
  settledWindowIds.clear();
  settlingByWindowId.clear();
}

export function isWindowAlreadySettled(windowId: string): boolean {
  return settledWindowIds.has(windowId);
}

export function markWindowSettled(windowId: string): void {
  settledWindowIds.add(windowId);
}

export function getInFlightSettlement(
  windowId: string,
): Promise<LastClosedWindowState | null> | undefined {
  return settlingByWindowId.get(windowId);
}

export function trackInFlightSettlement(
  windowId: string,
  promise: Promise<LastClosedWindowState | null>,
): void {
  settlingByWindowId.set(windowId, promise);
}

export function clearInFlightSettlement(windowId: string): void {
  settlingByWindowId.delete(windowId);
}
