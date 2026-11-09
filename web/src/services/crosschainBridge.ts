import { CONFIG } from "../config";
import { getDerivedForeignAccounts, DerivedForeignAccounts } from "./chainSig";

export interface DepositIntent {
  intentId: string;
  accountId: string;
  targetChain: "base" | "ethereum" | "arbitrum" | "solana";
  derivedAddress: string;
  expectedAmount: string;
  stakeNear: number;
  roundId?: number;
  status: "pending_deposit" | "confirming" | "bet_deployed" | "failed";
  txHash?: string;
  confirmations?: number;
  nearTxHash?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export class CrossChainBridgeService {
  private keeperUrl: string;

  constructor() {
    this.keeperUrl = CONFIG.KEEPER_URL || "https://amstr-keeper.fly.dev";
  }

  /**
   * Get all derived foreign deposit addresses for an account
   */
  public getDerivedAddresses(accountId: string): DerivedForeignAccounts {
    return getDerivedForeignAccounts(accountId);
  }

  /**
   * Register a new cross-chain deposit intent on the CVM keeper
   */
  public async createDepositIntent(params: {
    accountId: string;
    targetChain: "base" | "ethereum" | "arbitrum" | "solana";
    stakeNear: number;
    roundId?: number;
    ciphertext?: string;
    commit?: string;
    expectedAmount?: string;
  }): Promise<DepositIntent> {
    const res = await fetch(`${this.keeperUrl}/multichain/deposit-intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      // Fallback: create local intent object if keeper offline
      const addresses = getDerivedForeignAccounts(params.accountId);
      let derivedAddress = addresses.base;
      if (params.targetChain === "ethereum") derivedAddress = addresses.ethereum;
      if (params.targetChain === "arbitrum") derivedAddress = addresses.arbitrum;
      if (params.targetChain === "solana") derivedAddress = addresses.solana;

      return {
        intentId: `local_${Date.now()}`,
        accountId: params.accountId,
        targetChain: params.targetChain,
        derivedAddress,
        expectedAmount: params.expectedAmount || "0.001",
        stakeNear: params.stakeNear,
        roundId: params.roundId,
        status: "pending_deposit",
        confirmations: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    return data.intent;
  }

  /**
   * Query status of a deposit intent
   */
  public async getDepositIntentStatus(intentId: string): Promise<DepositIntent | null> {
    try {
      const res = await fetch(`${this.keeperUrl}/multichain/intent/${intentId}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.intent || null;
    } catch {
      return null;
    }
  }

  /**
   * Manually submit a foreign txHash to expedite verification and deployment
   */
  public async submitForeignTxHash(intentId: string, txHash: string): Promise<DepositIntent> {
    const res = await fetch(`${this.keeperUrl}/multichain/verify-tx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intentId, txHash }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Failed to verify transaction");
    }
    return data.intent;
  }
}

export const crossChainBridge = new CrossChainBridgeService();
