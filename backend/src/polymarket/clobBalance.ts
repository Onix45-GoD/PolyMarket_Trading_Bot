import { AssetType } from "@polymarket/clob-client-v2";
import { getClobClient } from "./clobClient.js";

/** USDC collateral balance for the Polymarket trading (proxy) account. */
export async function getLiveCollateralBalanceUsd(): Promise<{
  ok: boolean;
  balanceUsd: number;
  error?: string;
}> {
  const clob = await getClobClient();
  if (!clob) {
    return { ok: false, balanceUsd: 0, error: "no_clob_client" };
  }

  try {
    const res = await clob.getBalanceAllowance({
      asset_type: AssetType.COLLATERAL,
    });
    const raw = Number(res.balance ?? 0);
    // Polymarket returns collateral in USDC atomic units (6 decimals).
    const balanceUsd = raw / 1_000_000;
    return { ok: true, balanceUsd };
  } catch (err) {
    return {
      ok: false,
      balanceUsd: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
