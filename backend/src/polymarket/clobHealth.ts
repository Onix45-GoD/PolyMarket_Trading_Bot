import { env } from "../config/env.js";
import { fetchWithTimeout, formatFetchError } from "../net/initNetwork.js";
import { getClobClient } from "./clobClient.js";

export interface ClobHealthReport {
  host: string;
  public: { ok: boolean; serverTime?: number; error?: string };
  auth: {
    configured: boolean;
    ok: boolean;
    apiKeyDerived?: boolean;
    error?: string;
  };
}

export async function checkClobHealth(): Promise<ClobHealthReport> {
  const report: ClobHealthReport = {
    host: env.CLOB_HOST,
    public: { ok: false },
    auth: { configured: Boolean(env.PRIVATE_KEY), ok: false },
  };

  try {
    const clob = await getClobClient();
    if (clob) {
      await clob.getOk();
      const serverTime = await clob.getServerTime();
      report.public = { ok: true, serverTime };
      report.auth = { configured: true, ok: true, apiKeyDerived: true };
      return report;
    }
  } catch {
    /* fall through to unauthenticated public check */
  }

  try {
    const res = await fetchWithTimeout(`${env.CLOB_HOST}/time`, undefined, 15_000);
    if (res.ok) {
      const body = (await res.json()) as number | { serverTime?: number };
      const serverTime =
        typeof body === "number" ? body : (body.serverTime ?? undefined);
      report.public = { ok: true, serverTime };
    } else {
      report.public = {
        ok: false,
        error: `HTTP ${res.status}`,
      };
    }
  } catch (err) {
    report.public = { ok: false, error: formatFetchError(err) };
  }

  if (!env.PRIVATE_KEY) {
    report.auth = {
      configured: false,
      ok: false,
      error: "PRIVATE_KEY not set in .env",
    };
    return report;
  }

  try {
    const clob = await getClobClient();
    if (!clob) {
      report.auth = {
        configured: true,
        ok: false,
        error: "Failed to initialize ClobClient",
      };
      return report;
    }
    await clob.getApiKeys();
    report.auth = { configured: true, ok: true, apiKeyDerived: true };
  } catch (err) {
    report.auth = {
      configured: true,
      ok: false,
      error: formatFetchError(err),
    };
  }

  return report;
}
