import dns from "node:dns";
import { Agent, ProxyAgent, setGlobalDispatcher } from "undici";
import { env } from "../config/env.js";

let initialized = false;

/** Route Node fetch() through VPN/proxy when HTTPS_PROXY is set in .env */
export function initNetwork(): void {
  if (initialized) return;
  initialized = true;

  // Windows + TUN VPN (Clash etc.): prefer IPv4; avoids flaky IPv6 routes
  dns.setDefaultResultOrder("ipv4first");

  const proxy = env.HTTPS_PROXY || env.HTTP_PROXY;
  const agent = proxy
    ? new ProxyAgent({
        uri: proxy,
        requestTls: { timeout: 30_000 },
        proxyTls: { timeout: 30_000 },
      })
    : new Agent({
        connect: { timeout: 30_000 },
        headersTimeout: 60_000,
        bodyTimeout: 60_000,
      });

  setGlobalDispatcher(agent);

  if (proxy) {
    console.log(`[net] Proxy enabled: ${proxy}`);
  } else {
    console.log("[net] Direct connection (IPv4 preferred, 30s connect timeout)");
  }
}

export function formatFetchError(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause as NodeJS.ErrnoException | undefined;
    if (cause?.code === "ECONNRESET") {
      return "Connection reset (ECONNRESET). With TUN VPN, Node may fail while PowerShell works — try Clash HTTP proxy: HTTPS_PROXY=http://127.0.0.1:7890";
    }
    if (cause?.message?.includes("Connect Timeout")) {
      return `Connect timeout to Polymarket — VPN may be slow; retrying. (${cause.message})`;
    }
    if (cause?.message) return `${err.message}: ${cause.message}`;
    return err.message;
  }
  return String(err);
}

export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = 30_000,
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      "User-Agent": "btc-updown-bot/0.1",
      Accept: "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}
