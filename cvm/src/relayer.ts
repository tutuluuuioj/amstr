import { connect, keyStores, KeyPair, transactions, utils } from "near-api-js";

export interface RelayerConfig {
  networkId: string;
  nodeUrl: string;
  relayerAccountId: string;
  relayerPrivateKey: string;
  whitelistedContracts: string[];
  maxCallsPerHourPerAccount?: number;
}

export interface RelayerStatus {
  status: "active" | "degraded" | "offline";
  relayerAccountId: string;
  networkId: string;
  whitelistedContracts: string[];
  totalCallsProcessed: number;
  totalGasSponsoredTGas: number;
  rateLimitPerHour: number;
}

export class GaslessRelayerService {
  private keyStore: keyStores.InMemoryKeyStore;
  private config: RelayerConfig;
  private callHistory: Map<string, number[]> = new Map();
  private totalCallsProcessed = 0;
  private totalGasSponsoredTGas = 0;

  constructor(config: RelayerConfig) {
    this.config = {
      maxCallsPerHourPerAccount: 30,
      ...config,
    };
    this.keyStore = new keyStores.InMemoryKeyStore();
  }

  public async init(): Promise<void> {
    if (!this.config.relayerPrivateKey) {
      throw new Error("Relayer private key is required to initialize GaslessRelayerService");
    }
    const keyPair = KeyPair.fromString(this.config.relayerPrivateKey as any);
    await this.keyStore.setKey(this.config.networkId, this.config.relayerAccountId, keyPair);
    console.log(`[Gasless Relayer] Initialized for ${this.config.relayerAccountId} on ${this.config.networkId}`);
  }

  /**
   * Check sliding-window rate limit for account
   */
  public checkRateLimit(accountId: string): boolean {
    const now = Date.now();
    const oneHourAgo = now - 3600 * 1000;
    const history = (this.callHistory.get(accountId) || []).filter((ts) => ts > oneHourAgo);

    if (history.length >= (this.config.maxCallsPerHourPerAccount || 30)) {
      return false;
    }

    history.push(now);
    this.callHistory.set(accountId, history);
    return true;
  }

  /**
   * Relay an action to a whitelisted contract and sponsor gas
   */
  public async relayFunctionCall(params: {
    senderAccountId: string;
    contractId: string;
    methodName: string;
    args: Record<string, any>;
    attachedDepositYocto?: string;
    gasTGas?: number;
  }): Promise<{ success: boolean; txHash?: string; error?: string }> {
    const { senderAccountId, contractId, methodName, args, attachedDepositYocto = "0", gasTGas = 100 } = params;

    // 1. Whitelist validation
    const isWhitelisted = this.config.whitelistedContracts.some(
      (c) => c.toLowerCase() === contractId.toLowerCase()
    );
    if (!isWhitelisted) {
      return { success: false, error: `Contract ${contractId} is not whitelisted for gas sponsorship.` };
    }

    // 2. Method whitelist validation
    const allowedMethods = ["deploy", "claim", "storage_deposit"];
    if (!allowedMethods.includes(methodName)) {
      return { success: false, error: `Method ${methodName} is not permitted for gasless execution.` };
    }

    // 3. Rate limiting check
    if (!this.checkRateLimit(senderAccountId)) {
      return {
        success: false,
        error: `Rate limit exceeded: Max ${this.config.maxCallsPerHourPerAccount} sponsored transactions per hour.`,
      };
    }

    try {
      const near = await connect({
        networkId: this.config.networkId,
        nodeUrl: this.config.nodeUrl,
        keyStore: this.keyStore,
      });

      const relayerAccount = await near.account(this.config.relayerAccountId);

      // Gas calculation: gasTGas in TGas (10^12 gas units)
      const gasUnits = BigInt(gasTGas) * 1_000_000_000_000n;
      const depositUnits = BigInt(attachedDepositYocto);

      console.log(`[Relayer] Sponsoring tx for ${senderAccountId} -> ${contractId}.${methodName}`);

      const outcome = await relayerAccount.functionCall({
        contractId,
        methodName,
        args: {
          ...args,
          // If contract supports delegated callers, include senderAccountId
          delegated_sender: senderAccountId,
        },
        gas: gasUnits,
        attachedDeposit: depositUnits as any,
      });

      this.totalCallsProcessed += 1;
      this.totalGasSponsoredTGas += gasTGas;

      const txHash = outcome.transaction.hash;
      return { success: true, txHash };
    } catch (err: any) {
      console.warn(`[Relayer] Execution error:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Relay NEP-366 DelegateAction (Standard NEP-366 Meta Transaction)
   */
  public async relaySignedDelegate(
    signedDelegateBytes: Uint8Array | Buffer
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const near = await connect({
        networkId: this.config.networkId,
        nodeUrl: this.config.nodeUrl,
        keyStore: this.keyStore,
      });

      // Deserialize NEP-366 action
      const decoded = (transactions as any).decodeSignedDelegateAction
        ? (transactions as any).decodeSignedDelegateAction(signedDelegateBytes)
        : null;

      const relayerAccount = await near.account(this.config.relayerAccountId);

      let outcome: any;
      if (decoded && typeof (transactions as any).actionCreators?.relay === "function") {
        const relayAction = (transactions as any).actionCreators.relay(decoded);
        outcome = await (relayerAccount as any).signAndSendTransaction({
          receiverId: decoded.delegateAction.senderId,
          actions: [relayAction],
        });
      } else {
        // Fallback: direct broadcast of the signed meta payload to RPC
        const result = await (near.connection.provider as any).sendJsonRpc("broadcast_tx_commit", [
          Buffer.from(signedDelegateBytes).toString("base64"),
        ]);
        outcome = result;
      }

      this.totalCallsProcessed += 1;
      this.totalGasSponsoredTGas += 150;

      const txHash = outcome?.transaction?.hash || outcome?.transaction_outcome?.id || "relayed";
      return { success: true, txHash };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get current relayer operational status
   */
  public getStatus(): RelayerStatus {
    return {
      status: "active",
      relayerAccountId: this.config.relayerAccountId,
      networkId: this.config.networkId,
      whitelistedContracts: this.config.whitelistedContracts,
      totalCallsProcessed: this.totalCallsProcessed,
      totalGasSponsoredTGas: this.totalGasSponsoredTGas,
      rateLimitPerHour: this.config.maxCallsPerHourPerAccount || 30,
    };
  }
}
