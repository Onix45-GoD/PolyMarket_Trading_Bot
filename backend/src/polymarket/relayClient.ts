import {
  RelayClient,
  RelayerTxType,
} from "@polymarket/builder-relayer-client";
import type { BuilderApiKeyCreds } from "@polymarket/builder-signing-sdk";
import { env } from "../config/env.js";
import { createTradingWalletClient } from "./walletViem.js";

let relayClient: RelayClient | null = null;

function hasBuilderRelayerCreds(): boolean {
  return Boolean(
    env.POLY_API_KEY?.trim() &&
      env.POLY_API_SECRET?.trim() &&
      env.POLY_API_PASSPHRASE?.trim(),
  );
}

function relayTxTypeForSignature(): RelayerTxType {
  if (env.SIGNATURE_TYPE === 2) return RelayerTxType.SAFE;
  return RelayerTxType.PROXY;
}

/** Gasless relayer (Safe/proxy). Requires builder API key + secret + passphrase. */
export async function getRelayClient(): Promise<RelayClient | null> {
  if (relayClient) return relayClient;
  if (!hasBuilderRelayerCreds()) return null;

  const wallet = createTradingWalletClient();
  if (!wallet) return null;

  const builderCreds: BuilderApiKeyCreds = {
    key: env.POLY_API_KEY!,
    secret: env.POLY_API_SECRET!,
    passphrase: env.POLY_API_PASSPHRASE!,
  };
  const { BuilderConfig } = await import("@polymarket/builder-signing-sdk");
  const builderConfig = new BuilderConfig({ localBuilderCreds: builderCreds });

  relayClient = new RelayClient(
    env.RELAYER_URL,
    env.CHAIN_ID,
    wallet,
    builderConfig as unknown as ConstructorParameters<typeof RelayClient>[3],
    relayTxTypeForSignature(),
  );
  return relayClient;
}

export function hasRelayRedeemSupport(): boolean {
  return hasBuilderRelayerCreds();
}
