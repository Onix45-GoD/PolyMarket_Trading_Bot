import { zeroHash } from "viem";
import type { DepositWalletCall } from "@polymarket/builder-relayer-client";
import { env } from "../config/env.js";
import { fetchWithTimeout } from "../net/initNetwork.js";
import { refreshLiveCollateralBalance } from "../polymarket/clobBalance.js";
import { getRelayClient, hasRelayRedeemSupport } from "../polymarket/relayClient.js";
import {
  createTradingWalletClient,
  getTradingWalletAddress,
} from "../polymarket/walletViem.js";
import type { ActiveMarket } from "../types/index.js";
import { buildCtfRedeemCalldata, buildCtfRedeemTransaction } from "./ctfRedeem.js";
import { isMarketReadyToRedeem } from "./windowResolution.js";

const CTF_REDEEM_ABI = [
  {
    name: "redeemPositions",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "indexSets", type: "uint256[]" },
    ],
    outputs: [],
  },
] as const;

export interface RedeemResult {
  ok: boolean;
  txHash?: string;
  method?: "relayer" | "deposit_wallet" | "eoa";
  error?: string;
  balanceBeforeUsd?: number;
  balanceAfterUsd?: number;
}

async function fetchRedeemableSize(
  user: string,
  conditionId: string,
): Promise<number> {
  const url = new URL("https://data-api.polymarket.com/positions");
  url.searchParams.set("user", user);
  url.searchParams.set("market", conditionId);
  url.searchParams.set("redeemable", "true");
  url.searchParams.set("sizeThreshold", "0.01");

  try {
    const res = await fetchWithTimeout(url.toString(), undefined, 20_000);
    if (!res.ok) return 0;
    const rows = (await res.json()) as { size?: number; redeemable?: boolean }[];
    if (!Array.isArray(rows)) return 0;
    return rows
      .filter((r) => r.redeemable !== false)
      .reduce((sum, r) => sum + (Number(r.size) || 0), 0);
  } catch {
    return 0;
  }
}

async function redeemViaRelayer(
  conditionId: string,
): Promise<RedeemResult> {
  const relay = await getRelayClient();
  if (!relay) {
    return {
      ok: false,
      error: "relayer_not_configured (set POLY_API_KEY/SECRET/PASSPHRASE for gasless redeem)",
    };
  }

  const txn = buildCtfRedeemTransaction(conditionId);
  const before = await refreshLiveCollateralBalance();
  console.log(
    `[redeem] relayer execute → CTF redeem condition=${conditionId.slice(0, 14)}…`,
  );
  const resp = await relay.execute([txn], "redeem");
  const confirmed = await resp.wait();
  const after = await refreshLiveCollateralBalance();

  if (!confirmed || confirmed.state?.includes("FAILED")) {
    return {
      ok: false,
      error: `relayer_failed:${confirmed?.state ?? "unknown"}`,
      method: "relayer",
      balanceBeforeUsd: before.balanceUsd,
      balanceAfterUsd: after.balanceUsd,
    };
  }

  return {
    ok: true,
    txHash: confirmed.transactionHash,
    method: "relayer",
    balanceBeforeUsd: before.balanceUsd,
    balanceAfterUsd: after.balanceUsd,
  };
}

async function redeemViaDepositWallet(
  conditionId: string,
): Promise<RedeemResult> {
  const relay = await getRelayClient();
  const wallet = createTradingWalletClient();
  if (!relay || !wallet) {
    return { ok: false, error: "deposit_wallet_relayer_unavailable" };
  }

  const depositWallet =
    (env.DEPOSIT_WALLET_ADDRESS?.trim() as `0x${string}`) ||
    (await relay.deriveDepositWalletAddress());
  const cfg = await import("@polymarket/clob-client-v2").then((m) =>
    m.getContractConfig(env.CHAIN_ID),
  );
  const calldata = buildCtfRedeemCalldata(conditionId);
  const call: DepositWalletCall = {
    target: cfg.conditionalTokens,
    value: "0",
    data: calldata,
  };
  const deadline = String(Math.floor(Date.now() / 1000) + 600);
  const before = await refreshLiveCollateralBalance();

  console.log(
    `[redeem] deposit wallet batch → ${depositWallet.slice(0, 10)}… condition=${conditionId.slice(0, 14)}…`,
  );
  const resp = await relay.executeDepositWalletBatch(
    [call],
    depositWallet,
    deadline,
  );
  const confirmed = await resp.wait();
  const after = await refreshLiveCollateralBalance();

  if (!confirmed || confirmed.state?.includes("FAILED")) {
    return {
      ok: false,
      error: `deposit_wallet_failed:${confirmed?.state ?? "unknown"}`,
      method: "deposit_wallet",
      balanceBeforeUsd: before.balanceUsd,
      balanceAfterUsd: after.balanceUsd,
    };
  }

  return {
    ok: true,
    txHash: confirmed.transactionHash,
    method: "deposit_wallet",
    balanceBeforeUsd: before.balanceUsd,
    balanceAfterUsd: after.balanceUsd,
  };
}

async function redeemViaEoa(conditionId: string): Promise<RedeemResult> {
  const wallet = createTradingWalletClient();
  const funder = getTradingWalletAddress();
  if (!wallet || !funder) {
    return { ok: false, error: "no_wallet" };
  }

  const account = wallet.account;
  if (!account || account.address.toLowerCase() !== funder.toLowerCase()) {
    return {
      ok: false,
      error: "eoa_redeem_only_when_funder_is_signer (use relayer for proxy/deposit wallet)",
    };
  }

  const cfg = await import("@polymarket/clob-client-v2").then((m) =>
    m.getContractConfig(env.CHAIN_ID),
  );
  const before = await refreshLiveCollateralBalance();
  console.log(`[redeem] EOA on-chain redeem condition=${conditionId.slice(0, 14)}…`);

  const hash = await wallet.writeContract({
    address: cfg.conditionalTokens as `0x${string}`,
    abi: CTF_REDEEM_ABI,
    functionName: "redeemPositions",
    args: [
      cfg.collateral as `0x${string}`,
      zeroHash,
      conditionId as `0x${string}`,
      [1n, 2n],
    ],
    chain: wallet.chain,
    account,
  });

  const after = await refreshLiveCollateralBalance();
  return {
    ok: true,
    txHash: hash,
    method: "eoa",
    balanceBeforeUsd: before.balanceUsd,
    balanceAfterUsd: after.balanceUsd,
  };
}

/** Redeem all winning tokens for a resolved condition → pUSD/USDC in trading wallet. */
export async function redeemLiveCondition(
  market: ActiveMarket,
): Promise<RedeemResult> {
  const ready = await isMarketReadyToRedeem(market.slug);
  if (!ready) {
    return { ok: false, error: "market_not_resolved" };
  }

  const funder = getTradingWalletAddress();
  if (!funder) {
    return { ok: false, error: "no_trading_wallet" };
  }

  const redeemableSize = await fetchRedeemableSize(
    funder,
    market.conditionId,
  );
  if (redeemableSize < 0.01) {
    console.log(
      `[redeem] ${market.slug} — no redeemable positions on data-api (size=${redeemableSize})`,
    );
    return { ok: true, error: "nothing_to_redeem" };
  }

  console.log(
    `[redeem] ${market.slug} redeemable≈${redeemableSize.toFixed(2)} shares (wallet ${funder.slice(0, 10)}…)`,
  );

  if (env.SIGNATURE_TYPE === 3 && hasRelayRedeemSupport()) {
    return redeemViaDepositWallet(market.conditionId);
  }
  if (hasRelayRedeemSupport()) {
    return redeemViaRelayer(market.conditionId);
  }
  return redeemViaEoa(market.conditionId);
}
