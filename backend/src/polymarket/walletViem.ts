import { createWalletClient, http, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { env } from "../config/env.js";

export function getTradingWalletAddress(): `0x${string}` | null {
  if (!env.PRIVATE_KEY) return null;
  const account = privateKeyToAccount(env.PRIVATE_KEY as `0x${string}`);
  const funder = env.DEPOSIT_WALLET_ADDRESS?.trim();
  return (funder || account.address) as `0x${string}`;
}

export function createTradingWalletClient(): WalletClient | null {
  if (!env.PRIVATE_KEY) return null;
  const account = privateKeyToAccount(env.PRIVATE_KEY as `0x${string}`);
  return createWalletClient({
    account,
    chain: polygon,
    transport: http(env.POLYGON_RPC_URL),
  });
}
