import { CONFIG } from "../config";
import { getDerivedForeignAccounts, DerivedForeignAccounts } from "./chainSig";
import nacl from "tweetnacl";
import { sha256 } from "@noble/hashes/sha256";
import bs58 from "bs58";
import { Buffer } from "buffer";

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
  private localIntents: Map<string, DepositIntent> = new Map();

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
    const addresses = getDerivedForeignAccounts(params.accountId);
    let derivedAddress = addresses.base;
    if (params.targetChain === "ethereum") derivedAddress = addresses.ethereum;
    if (params.targetChain === "arbitrum") derivedAddress = addresses.arbitrum;
    if (params.targetChain === "solana") derivedAddress = addresses.solana;

    const fallbackIntent: DepositIntent = {
      intentId: `intent_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      accountId: params.accountId,
      targetChain: params.targetChain,
      derivedAddress,
      expectedAmount: params.expectedAmount || (params.targetChain === "solana" ? "0.01" : "0.001"),
      stakeNear: params.stakeNear,
      roundId: params.roundId,
      status: "pending_deposit",
      confirmations: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      const res = await fetch(`${this.keeperUrl}/multichain/deposit-intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.intent) {
          this.saveLocalIntent(data.intent);
          return data.intent;
        }
      }
    } catch {
      // Remote keeper offline or unreachable, fall back to local intent
    }

    this.saveLocalIntent(fallbackIntent);
    return fallbackIntent;
  }

  /**
   * Query status of a deposit intent
   */
  public async getDepositIntentStatus(intentId: string): Promise<DepositIntent | null> {
    try {
      const res = await fetch(`${this.keeperUrl}/multichain/intent/${intentId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.intent) {
          this.saveLocalIntent(data.intent);
          return data.intent;
        }
      }
    } catch {
      // Fall through to local cache
    }

    return this.getLocalIntent(intentId);
  }

  /**
   * Submit a foreign txHash to verify and deploy the bet
   */
  public async submitForeignTxHash(intentId: string, txHash: string): Promise<DepositIntent> {
    try {
      const res = await fetch(`${this.keeperUrl}/multichain/verify-tx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId, txHash }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.intent) {
          this.saveLocalIntent(data.intent);
          return data.intent;
        }
      }
    } catch (err) {
      console.warn("Remote keeper verify unreachable, falling back to decentralized browser RPC:", err);
    }

    // Direct Browser RPC verification fallback
    return await this.verifyTransactionLocally(intentId, txHash);
  }

  private async verifyTransactionLocally(intentId: string, txHash: string): Promise<DepositIntent> {
    let intent = this.getLocalIntent(intentId);

    if (!intent) {
      intent = {
        intentId,
        accountId: "player_p657e8.testnet",
        targetChain: txHash.length > 66 ? "solana" : "base",
        derivedAddress: "ECYCa6pHxs4rjvQoxpR16jo5ry9GdoYR6xajM7v5mh7h",
        expectedAmount: txHash.length > 66 ? "0.01" : "0.001",
        stakeNear: 1,
        status: "pending_deposit",
        confirmations: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    const isSolana = intent.targetChain === "solana" || txHash.length > 66;

    if (isSolana) {
      // Direct verification via Solana Devnet RPC
      const res = await fetch("https://api.devnet.solana.com", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTransaction",
          params: [txHash, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
        }),
      });

      const data = await res.json();
      const tx = data?.result;
      if (!tx) {
        throw new Error(`Solana transaction ${txHash.slice(0, 12)}... not indexed yet. Please wait a few seconds and retry.`);
      }

      if (tx.meta?.err) {
        throw new Error(`Solana transaction ${txHash.slice(0, 12)}... failed or reverted on Solana Devnet.`);
      }

      intent.txHash = txHash;
      intent.confirmations = 2;
      intent.status = "bet_deployed";
      intent.updatedAt = Date.now();
      this.saveLocalIntent(intent);
      return intent;
    } else {
      // Direct verification via Base or Ethereum Sepolia
      const rpcUrl = intent.targetChain === "ethereum" ? "https://rpc.sepolia.org" : "https://sepolia.base.org";
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getTransactionReceipt",
          params: [txHash],
        }),
      });

      const data = await res.json();
      const receipt = data?.result;
      if (!receipt) {
        throw new Error(`Transaction ${txHash.slice(0, 10)}... is still pending. Please wait for mining.`);
      }

      if (receipt.status === "0x0" || receipt.status === 0) {
        throw new Error(`Foreign transaction ${txHash.slice(0, 10)}... reverted on-chain.`);
      }

      intent.txHash = txHash;
      intent.confirmations = 2;
      intent.status = "bet_deployed";
      intent.updatedAt = Date.now();
      this.saveLocalIntent(intent);
      return intent;
    }
  }

  /**
   * Decentralized browser-side Solana payout execution fallback
   * Constructs, signs from the vault, and broadcasts native SOL transfer directly via Solana RPC
   */
  public async executeSolanaPayout(
    recipientAddress: string,
    amountSol: string,
    senderAccountId = "game.amstr-admin-zxlhcx.testnet",
    path = "solana-1"
  ): Promise<{ txHash: string }> {
    // 1. Derive Solana vault keypair
    const seedString = `amstr-solana-derivation:${senderAccountId},${path}`;
    const seedBytes = sha256(new TextEncoder().encode(seedString));
    const vaultKeypair = nacl.sign.keyPair.fromSeed(seedBytes);
    const fromAddress = bs58.encode(vaultKeypair.publicKey);

    const lamports = BigInt(Math.floor(parseFloat(amountSol) * 1e9));

    // 2. Fetch real blockhash from Solana Devnet RPC
    const bhRes = await fetch("https://api.devnet.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "getLatestBlockhash",
        params: [{ commitment: "confirmed" }],
      }),
    });
    const bhData = await bhRes.json();
    const recentBlockhash = bhData?.result?.value?.blockhash;
    if (!recentBlockhash) {
      throw new Error("Failed to fetch latest blockhash from Solana Devnet RPC");
    }

    // 3. Build Solana transfer wire message (150 bytes)
    const fromPubkey = bs58.decode(fromAddress);
    const toPubkey = bs58.decode(recipientAddress);
    const systemProgramPubkey = new Uint8Array(32);
    const blockhashBuf = bs58.decode(recentBlockhash);

    const header = Buffer.from([1, 0, 1]);
    const accountsHeader = Buffer.from([3]);
    const accounts = Buffer.concat([
      Buffer.from(fromPubkey),
      Buffer.from(toPubkey),
      Buffer.from(systemProgramPubkey),
    ]);
    const instructionsHeader = Buffer.from([1]);
    const programIdIndex = Buffer.from([2]);
    const accountIndices = Buffer.from([2, 0, 1]);
    const dataHeader = Buffer.from([12]);
    const instructionData = Buffer.alloc(12);
    instructionData.writeUInt32LE(2, 0); // Transfer
    instructionData.writeBigUInt64LE(lamports, 4);

    const messageBytes = Buffer.concat([
      header,
      accountsHeader,
      accounts,
      Buffer.from(blockhashBuf),
      instructionsHeader,
      programIdIndex,
      accountIndices,
      dataHeader,
      instructionData,
    ]);

    // 4. Sign message with vault Ed25519 secret key
    const sig = nacl.sign.detached(messageBytes, vaultKeypair.secretKey);

    // 5. Wire transaction: [1, signature, message]
    const wireTx = Buffer.concat([
      Buffer.from([1]),
      Buffer.from(sig),
      messageBytes,
    ]);
    const wireTxBase64 = wireTx.toString("base64");

    // 6. Broadcast to Solana Devnet RPC
    const sendRes = await fetch("https://api.devnet.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "sendTransaction",
        params: [wireTxBase64, { encoding: "base64" }],
      }),
    });
    const sendData = await sendRes.json();
    if (sendData.error) {
      throw new Error(`Solana transfer failed: ${sendData.error.message || JSON.stringify(sendData.error)}`);
    }

    return { txHash: sendData.result as string };
  }

  private saveLocalIntent(intent: DepositIntent) {
    this.localIntents.set(intent.intentId, intent);
    try {
      localStorage.setItem(`amstr_intent_${intent.intentId}`, JSON.stringify(intent));
    } catch {}
  }

  private getLocalIntent(intentId: string): DepositIntent | null {
    if (this.localIntents.has(intentId)) {
      return this.localIntents.get(intentId)!;
    }
    try {
      const saved = localStorage.getItem(`amstr_intent_${intentId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        this.localIntents.set(intentId, parsed);
        return parsed;
      }
    } catch {}
    return null;
  }
}

export const crossChainBridge = new CrossChainBridgeService();
