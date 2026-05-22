import { getContractConfig } from "@polymarket/clob-client-v2";
import { encodeFunctionData, zeroHash, type Hex } from "viem";
import type { Transaction } from "@polymarket/builder-relayer-client";
import { env } from "../config/env.js";

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

function normalizeConditionId(conditionId: string): Hex {
  const raw = conditionId.trim().toLowerCase();
  const hex = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (hex.length !== 66) {
    throw new Error(`invalid conditionId length: ${conditionId}`);
  }
  return hex as Hex;
}

/** Binary market: redeem both index sets; only the winning side pays out. */
export function buildCtfRedeemCalldata(conditionId: string): Hex {
  const cfg = getContractConfig(env.CHAIN_ID);
  return encodeFunctionData({
    abi: CTF_REDEEM_ABI,
    functionName: "redeemPositions",
    args: [
      cfg.collateral as `0x${string}`,
      zeroHash,
      normalizeConditionId(conditionId),
      [1n, 2n],
    ],
  });
}

export function buildCtfRedeemTransaction(conditionId: string): Transaction {
  const cfg = getContractConfig(env.CHAIN_ID);
  return {
    to: cfg.conditionalTokens,
    data: buildCtfRedeemCalldata(conditionId),
    value: "0",
  };
}
