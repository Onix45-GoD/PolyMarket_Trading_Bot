import { ClobClient } from "@polymarket/clob-client-v2";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { env } from "../config/env.js";

let client: ClobClient | null = null;

export async function getClobClient(): Promise<ClobClient | null> {
  if (client) return client;
  if (!env.PRIVATE_KEY) {
    console.warn("[clob] PRIVATE_KEY not set — read-only mode");
    return null;
  }

  const account = privateKeyToAccount(env.PRIVATE_KEY as `0x${string}`);
  const signer = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });

  const base = {
    host: env.CLOB_HOST,
    chain: env.CHAIN_ID as 137,
    signer,
    signatureType: env.SIGNATURE_TYPE as 0 | 1 | 2 | 3,
    funderAddress: env.DEPOSIT_WALLET_ADDRESS || account.address,
  };

  let creds =
    env.POLY_API_KEY && env.POLY_API_SECRET && env.POLY_API_PASSPHRASE
      ? {
          key: env.POLY_API_KEY,
          secret: env.POLY_API_SECRET,
          passphrase: env.POLY_API_PASSPHRASE,
        }
      : undefined;

  const temp = new ClobClient(base);
  if (!creds) {
    creds = await temp.createOrDeriveApiKey();
    console.log("[clob] Derived API credentials");
  }

  client = new ClobClient({
    ...base,
    creds,
    ...(env.POLY_BUILDER_CODE
      ? { builderConfig: { builderCode: env.POLY_BUILDER_CODE } }
      : {}),
  });

  return client;
}

export function resetClobClient(): void {
  client = null;
}
