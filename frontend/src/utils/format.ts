export function fmt(
  n: number | null | undefined,
  digits = 2,
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function fmtUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(digits)}`;
}

export function shortAddr(addr: string | null | undefined): string {
  if (!addr) return "—";
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function botStatusLabel(status: string | undefined): string {
  switch (status) {
    case "running":
      return "RUNNING";
    case "paused":
      return "PAUSED";
    case "stopped":
      return "STOPPED";
    default:
      return "UNKNOWN";
  }
}
