/**
 * Backend hosts for API + WebSocket.
 * Set in project root .env (see envDir in vite.config.ts) when using VPN:
 *   VITE_API_HOST=http://127.0.0.1:3001
 *   VITE_WS_HOST=ws://127.0.0.1:3002
 */
const apiHost = import.meta.env.VITE_API_HOST as string | undefined;
const wsHost = import.meta.env.VITE_WS_HOST as string | undefined;

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Full base URL for REST, e.g. http://127.0.0.1:3001/api */
export const API_BASE = apiHost ? `${trimSlash(apiHost)}/api` : "/api";

/** WebSocket URL, e.g. ws://127.0.0.1:3002 */
export function getWsUrl(): string {
  if (wsHost) return wsHost;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.hostname;
  const port = import.meta.env.VITE_WS_PORT ?? "3002";
  return `${protocol}//${host}:${port}`;
}
