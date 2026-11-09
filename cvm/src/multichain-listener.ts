import { getDerivedForeignAccounts } from "./chainsig.js";

export interface DepositIntent {
  intentId: string;
  accountId: string;
  targetChain: "base" | "ethereum" | "arbitrum" | "solana";
  derivedAddress: string;
  expectedAmount: string; // in ETH or SOL units e.g. "0.001"
  stakeNear: number;
  roundId: number;
  ciphertext: string;
  commit: string;
  status: "pending_deposit" | "confirming" | "bet_deployed" | "failed";
  txHash?: string;
  confirmations?: number;
  nearTxHash?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MultichainConfig {
  baseRpcUrl: string;
  ethRpcUrl: string;
  requiredConfirmations: number;
}

export class MultichainListener {
  private intents: Map<string, DepositIntent> = new Map();
  private processedTxHashes: Set<string> = new Set();
  private config: MultichainConfig;
  private isPolling = false;
  private pollInterval: any = null;

  constructor(config?: Partial<MultichainConfig>) {
    this.config = {
      baseRpcUrl: config?.baseRpcUrl || process.env.BASE_RPC_URL || "https://sepolia.base.org",
      ethRpcUrl: config?.ethRpcUrl || process.env.ETH_RPC_URL || "https://rpc.sepolia.org",
      requiredConfirmations: config?.requiredConfirmations ?? 2,
    };
  }

  /**
   * Register a new cross-chain deposit intent
   */
  public registerDepositIntent(params: {
    accountId: string;
    targetChain: "base" | "ethereum" | "arbitrum" | "solana";
    stakeNear: number;
    roundId: number;
    ciphertext: string;
    commit: string;
    expectedAmount?: string;
  }): DepositIntent {
    const addresses = getDerivedForeignAccounts(params.accountId);
    let derivedAddress = addresses.base;
    if (params.targetChain === "ethereum") derivedAddress = addresses.ethereum;
    if (params.targetChain === "arbitrum") derivedAddress = addresses.arbitrum;
    if (params.targetChain === "solana") derivedAddress = addresses.solana;

    const intentId = `intent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const intent: DepositIntent = {
      intentId,
      accountId: params.accountId,
      targetChain: params.targetChain,
      derivedAddress,
      expectedAmount: params.expectedAmount || "0.001",
      stakeNear: params.stakeNear,
      roundId: params.roundId,
      ciphertext: params.ciphertext,
      commit: params.commit,
      status: "pending_deposit",
      confirmations: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.intents.set(intentId, intent);
    return intent;
  }

  /**
   * Get deposit intent by ID
   */
  public getIntent(intentId: string): DepositIntent | null {
    return this.intents.get(intentId) || null;
  }

  /**
   * List all intents for an account
   */
  public getIntentsForAccount(accountId: string): DepositIntent[] {
    return Array.from(this.intents.values()).filter((i) => i.accountId === accountId);
  }

  /**
   * Verify an incoming foreign transaction and trigger deployment callback
   */
  public async verifyAndProcessTx(
    intentId: string,
    txHash: string,
    deployBetCallback: (intent: DepositIntent) => Promise<string>
  ): Promise<DepositIntent> {
    const intent = this.intents.get(intentId);
    if (!intent) {
      throw new Error(`Deposit intent ${intentId} not found`);
    }

    if (this.processedTxHashes.has(txHash)) {
      if (intent.status === "bet_deployed") {
        return intent;
      }
      intent.status = "failed";
      intent.error = `Replay prevented: transaction ${txHash} has already been processed for another intent.`;
      intent.updatedAt = Date.now();
      throw new Error(`Double-spend prevented: transaction ${txHash} has already been processed.`);
    }

    intent.txHash = txHash;
    intent.status = "confirming";
    intent.updatedAt = Date.now();

    try {
      // 1. Query full transaction to verify value transferred
      const tx = await this.queryEvmTransaction(txHash, intent.targetChain);
      if (!tx) {
        intent.confirmations = 0;
        return intent;
      }

      // Verify transferred value satisfies expected deposit
      const expectedWei = BigInt(Math.floor(parseFloat(intent.expectedAmount) * 1e6)) * 10n ** 12n;
      const actualWei = BigInt(tx.value || "0x0");
      if (actualWei < expectedWei) {
        intent.status = "failed";
        intent.error = `Insufficient deposit: received ${actualWei.toString()} Wei, required at least ${expectedWei.toString()} Wei`;
        intent.updatedAt = Date.now();
        return intent;
      }

      // 2. Query foreign chain RPC for receipt
      const receipt = await this.queryEvmReceipt(txHash, intent.targetChain);
      
      if (!receipt) {
        // Transaction broadcasted but not mined yet
        intent.confirmations = 0;
        return intent;
      }

      if (receipt.status === "0x0" || receipt.status === 0) {
        intent.status = "failed";
        intent.error = "Foreign chain transaction reverted";
        intent.updatedAt = Date.now();
        return intent;
      }

      // Verify recipient matches user's derived address
      const toAddr = (receipt.to || tx.to || "").toLowerCase();
      if (toAddr !== intent.derivedAddress.toLowerCase()) {
        intent.status = "failed";
        intent.error = `Transaction recipient ${toAddr} does not match derived address ${intent.derivedAddress}`;
        intent.updatedAt = Date.now();
        return intent;
      }

      // Calculate confirmations
      const currentBlock = await this.queryEvmBlockNumber(intent.targetChain);
      const txBlock = typeof receipt.blockNumber === "string" 
        ? parseInt(receipt.blockNumber, 16) 
        : receipt.blockNumber;

      const confs = Math.max(1, currentBlock - txBlock + 1);
      intent.confirmations = confs;

      if (confs >= this.config.requiredConfirmations) {
        // Execute NEAR deploy on behalf of the player
        console.log(`[Multichain Listener] Foreign deposit verified (${confs} confs, value: ${actualWei.toString()} Wei). Placing NEAR bet for ${intent.accountId}...`);
        const nearTx = await deployBetCallback(intent);
        intent.status = "bet_deployed";
        intent.nearTxHash = nearTx;
        this.processedTxHashes.add(txHash);
      }

      intent.updatedAt = Date.now();
      return intent;
    } catch (err: any) {
      console.warn(`[Multichain Listener] Verification notice for ${txHash}:`, err.message);
      intent.error = err.message;
      intent.updatedAt = Date.now();
      return intent;
    }
  }

  private async queryEvmTransaction(txHash: string, targetChain: string): Promise<any> {
    const rpcUrl = targetChain === "ethereum" ? this.config.ethRpcUrl : this.config.baseRpcUrl;
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 10,
          method: "eth_getTransactionByHash",
          params: [txHash],
        }),
      });
      const data = (await res.json()) as any;
      return data.result;
    } catch (err) {
      console.warn(`Could not reach RPC ${rpcUrl} for tx:`, err);
      return null;
    }
  }

  private async queryEvmReceipt(txHash: string, targetChain: string): Promise<any> {
    const rpcUrl = targetChain === "ethereum" ? this.config.ethRpcUrl : this.config.baseRpcUrl;
    try {
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
      const data = (await res.json()) as any;
      return data.result;
    } catch (err) {
      console.warn(`Could not reach RPC ${rpcUrl}:`, err);
      return null;
    }
  }

  private async queryEvmBlockNumber(targetChain: string): Promise<number> {
    const rpcUrl = targetChain === "ethereum" ? this.config.ethRpcUrl : this.config.baseRpcUrl;
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "eth_blockNumber",
          params: [],
        }),
      });
      const data = (await res.json()) as any;
      return parseInt(data.result || "0x0", 16);
    } catch {
      return 1000;
    }
  }
}

export const multichainListener = new MultichainListener();
