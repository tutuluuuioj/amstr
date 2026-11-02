export interface RpcConfig {
  endpoints: string[];
  maxRetries?: number;
  baseDelayMs?: number;
  baseBackoffMs?: number;
}

export class ResilientRpcClient {
  private readonly endpoints: string[];
  private currentIndex: number = 0;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(config: RpcConfig) {
    if (!config.endpoints || config.endpoints.length < 2) {
      throw new Error("ResilientRpcClient requires at least 2 distinct RPC endpoints for failover");
    }
    this.endpoints = config.endpoints;
    this.maxRetries = config.maxRetries ?? 5;
    this.baseDelayMs = config.baseBackoffMs ?? config.baseDelayMs ?? 400;
  }

  public static defaultTestnet(): ResilientRpcClient {
    return new ResilientRpcClient({
      endpoints: [
        "https://rpc.testnet.near.org",
        "https://testnet.neardata.xyz/v1/node",
        "https://near-testnet.api.pagoda.co/rpc/v1",
      ],
    });
  }

  public get currentEndpoint(): string {
    return this.endpoints[this.currentIndex];
  }

  public rotateEndpoint(): string {
    const prev = this.endpoints[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
    const next = this.endpoints[this.currentIndex];
    console.warn(`[RPC Failover] Switched provider from ${prev} to ${next}`);
    return next;
  }

  /**
   * Resilient JSON-RPC call with exponential backoff, jitter, and multi-provider failover.
   */
  public async jsonRpcCall(method: string, params: any): Promise<any> {
    let attempt = 0;
    let delay = this.baseDelayMs;

    while (attempt < this.maxRetries) {
      attempt++;
      const endpoint = this.currentEndpoint;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: `cvm_${Date.now()}_${attempt}`,
            method,
            params,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status === 429 || response.status >= 500) {
          console.warn(`[RPC Rate Limit / Server Error] ${endpoint} returned HTTP ${response.status}. Attempt ${attempt}/${this.maxRetries}`);
          this.rotateEndpoint();
        } else {
          const json = (await response.json()) as any;
          if (json.error) {
            const errStr = JSON.stringify(json.error);
            if (errStr.includes("Rate limit") || errStr.includes("Too many requests")) {
              console.warn(`[RPC Body Rate Limit] ${endpoint}: ${errStr}`);
              this.rotateEndpoint();
            } else {
              return json;
            }
          } else {
            return json;
          }
        }
      } catch (err: any) {
        console.warn(`[RPC Network Error] Failed connecting to ${endpoint}: ${err.message}. Attempt ${attempt}/${this.maxRetries}`);
        this.rotateEndpoint();
      }

      // Exponential backoff with randomized jitter
      const jitter = Math.floor(Math.random() * 200);
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
      delay = Math.min(delay * 2, 4000);
    }

    throw new Error(`All ${this.endpoints.length} RPC providers failed after ${this.maxRetries} retries`);
  }

  /**
   * Queries latest NEAR block height
   */
  public async getBlockHeight(): Promise<bigint> {
    const res = await this.jsonRpcCall("block", { finality: "final" });
    const height = res?.result?.header?.height ?? res?.result?.sync_info?.latest_block_height;
    if (height === undefined || height === null) {
      throw new Error(`Failed to fetch block height from RPC: ${JSON.stringify(res)}`);
    }
    return BigInt(height);
  }

  /**
   * Executes a read-only smart contract view call
   */
  public async viewFunction<T>(
    contractId: string,
    methodName: string,
    args: Record<string, any> = {}
  ): Promise<T> {
    const argsBase64 = Buffer.from(JSON.stringify(args)).toString("base64");
    const res = await this.jsonRpcCall("query", {
      request_type: "call_function",
      finality: "optimistic",
      account_id: contractId,
      method_name: methodName,
      args_base64: argsBase64,
    });

    if (res.error) {
      throw new Error(`View call ${methodName} error: ${JSON.stringify(res.error)}`);
    }

    const resultBytes = Buffer.from(res.result.result);
    if (resultBytes.length === 0) {
      return null as T;
    }
    return JSON.parse(resultBytes.toString("utf-8")) as T;
  }
}
