import { CONFIG } from "../config";

export interface RoundView {
  round_id: number;
  status: "Open" | "Revealing" | "Settled" | "Refunded";
  open_height: number;
  close_height: number;
  settle_height: number | null;
  seed_commit: number[];
  chain_entropy: number[] | null;
  winning_tile: number | null;
  per_tile_totals: string[]; // exact U128 string
  total_net: string;
  total_gross: string;
  entry_count: number;
  revealed_count: number;
  refund_cursor: number;
  wildcat_winner: string | null;
  wildcat_amstr: string;
  jackpot_shard_hit: boolean;
  jackpot_vein_hit: boolean;
  jackpot_core_hit: boolean;
  jackpot_near_won: string;
  jackpot_amstr_won: string;
}

export interface EntryView {
  account_id: string;
  gross_stake: string;
  net_stake: string;
  commit: number[];
  ciphertext: number[];
  mask: number | null;
  salt: number[] | null;
  is_valid: boolean;
  claimed: boolean;
  refunded: boolean;
}

export interface CvmKeyView {
  pubkey: string;
  x25519_pub: number[];
  code_hash: string;
  registered_at: number;
}

export interface ConfigView {
  fee_bps: number;
  buyback_bps: number;
  jackpot_bps: number;
  treasury_bps: number;
  referral_bps: number;
  min_stake: string;
  max_stake: string;
  max_players: number;
  deposit_window_blocks: number;
  refund_timeout_blocks: number;
  carryover_cap: string;
  paused: boolean;
  allow_mock_cvm: boolean;
}

export interface JackpotPoolView {
  near_balance: string;
  amstr_balance: string;
  cap_near: string;
  cap_amstr: string;
  odds: number;
}

export interface TreasuryInfoView {
  nearBalance: string;
  oraclePrice: string;
  capBps: number;
  devWithdrawn: string;
}

export interface AttestationReport {
  quote_hex?: string;
  code_hash: string;
  ed25519_pubkey: string;
  x25519_pubkey: string;
  report_data?: string;
  is_hardware_tdx: boolean;
  generated_at?: number;
}

class NearRpcClient {
  private currentEndpointIndex = 0;

  private async postRpc(method: string, params: any): Promise<any> {
    const endpoints = CONFIG.RPC_ENDPOINTS;
    let lastError: any = null;

    for (let attempt = 0; attempt < endpoints.length; attempt++) {
      const endpoint = endpoints[(this.currentEndpointIndex + attempt) % endpoints.length];
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: `amstr-web-${Date.now()}`,
            method,
            params,
          }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const json = await res.json();
        if (json.error) {
          throw new Error(json.error.data || json.error.message || JSON.stringify(json.error));
        }

        this.currentEndpointIndex = (this.currentEndpointIndex + attempt) % endpoints.length;
        return json.result;
      } catch (err: any) {
        lastError = err;
        console.warn(`RPC endpoint ${endpoint} failed: ${err.message}. Rotating...`);
      }
    }

    throw new Error(
      `All NEAR RPC endpoints failed: ${lastError?.message || "Unknown error"}. Check network connection.`
    );
  }

  public async callViewFunction<T>(contractId: string, methodName: string, args: Record<string, any> = {}): Promise<T> {
    const argsBase64 = btoa(JSON.stringify(args));
    const result = await this.postRpc("query", {
      request_type: "call_function",
      finality: "optimistic",
      account_id: contractId,
      method_name: methodName,
      args_base64: argsBase64,
    });

    if (!result || !result.result) {
      throw new Error(`Empty response for ${methodName} on ${contractId}`);
    }

    const bytes = new Uint8Array(result.result);
    const decoded = new TextDecoder().decode(bytes);
    return JSON.parse(decoded) as T;
  }

  public async getBlockHeight(): Promise<number> {
    const status = await this.postRpc("status", []);
    return status.sync_info.latest_block_height;
  }

  public async getAccountBalance(accountId: string): Promise<string> {
    try {
      const result = await this.postRpc("query", {
        request_type: "view_account",
        finality: "optimistic",
        account_id: accountId,
      });
      return result?.amount || "0";
    } catch {
      return "0";
    }
  }

  public async getAmstrTokenBalance(accountId: string): Promise<string> {
    try {
      const bal = await this.callViewFunction<string>(CONFIG.TOKEN_CONTRACT_ID, "ft_balance_of", {
        account_id: accountId,
      });
      return bal || "0";
    } catch {
      return "0";
    }
  }

  public async getTokenTotalSupply(): Promise<string> {
    try {
      const supply = await this.callViewFunction<string>(CONFIG.TOKEN_CONTRACT_ID, "ft_total_supply", {});
      return supply || "0";
    } catch {
      return "0";
    }
  }

  public async getTotalMintedLifetime(): Promise<string> {
    try {
      const minted = await this.callViewFunction<string>(CONFIG.TOKEN_CONTRACT_ID, "get_total_minted_lifetime", {});
      return minted || "0";
    } catch {
      return "0";
    }
  }

  public async getTreasuryInfo(): Promise<TreasuryInfoView> {
    try {
      const res = await this.callViewFunction<[string, string, number, string]>(
        CONFIG.TREASURY_CONTRACT_ID,
        "get_treasury_info",
        {}
      );
      return {
        nearBalance: res[0] || "0",
        oraclePrice: res[1] || "0",
        capBps: res[2] || 1000,
        devWithdrawn: res[3] || "0",
      };
    } catch (err) {
      console.warn("getTreasuryInfo error:", err);
      return {
        nearBalance: "0",
        oraclePrice: "0",
        capBps: 1000,
        devWithdrawn: "0",
      };
    }
  }

  public async getStakingUserInfo(accountId: string): Promise<{ staked: string; rewards: string }> {
    try {
      const res = await this.callViewFunction<[string, string]>(CONFIG.STAKING_CONTRACT_ID, "get_user_info", {
        account_id: accountId,
      });
      return { staked: res[0] || "0", rewards: res[1] || "0" };
    } catch {
      return { staked: "0", rewards: "0" };
    }
  }

  public async getActiveRound(): Promise<RoundView | null> {
    return await this.callViewFunction<RoundView | null>(CONFIG.CONTRACT_ID, "get_active_round", {});
  }

  public async getRound(roundId: number): Promise<RoundView | null> {
    return await this.callViewFunction<RoundView | null>(CONFIG.CONTRACT_ID, "get_round", {
      round_id: roundId,
    });
  }

  public async getNextRoundId(): Promise<number> {
    return await this.callViewFunction<number>(CONFIG.CONTRACT_ID, "get_next_round_id", {});
  }

  public async getRoundEntries(roundId: number): Promise<EntryView[]> {
    return await this.callViewFunction<EntryView[]>(CONFIG.CONTRACT_ID, "get_round_entries", {
      round_id: roundId,
    });
  }

  public async getRoundSettledEvent(
    roundId: number,
    txHash?: string
  ): Promise<{ seed: string; chain_entropy: string; winning_tile: number } | null> {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const cached = localStorage.getItem(`amstr_seed_${roundId}`);
        if (cached) {
          return { seed: cached, chain_entropy: "", winning_tile: 0 };
        }
      }
      if (txHash) {
        const txData = await this.postRpc("tx", [txHash, "amstr-admin-zxlhcx.testnet"]);
        const outcomes = txData?.receipts_outcome || [];
        for (const ro of outcomes) {
          for (const log of ro?.outcome?.logs || []) {
            if (typeof log === "string" && log.startsWith("EVENT_JSON:")) {
              try {
                const parsed = JSON.parse(log.slice("EVENT_JSON:".length));
                if (parsed.event === "round_settled" && parsed.data?.[0]?.seed) {
                  const seed = parsed.data[0].seed;
                  if (typeof window !== "undefined" && window.localStorage) {
                    localStorage.setItem(`amstr_seed_${roundId}`, seed);
                  }
                  return parsed.data[0];
                }
              } catch (_) {}
            }
          }
        }
      }
    } catch (err) {
      console.warn(`Could not retrieve round_settled event for round ${roundId}:`, err);
    }
    return null;
  }

  public async getPlayerEntry(roundId: number, accountId: string): Promise<EntryView | null> {
    return await this.callViewFunction<EntryView | null>(CONFIG.CONTRACT_ID, "get_entry", {
      round_id: roundId,
      account_id: accountId,
    });
  }

  public async getCvmKey(): Promise<CvmKeyView | null> {
    return await this.callViewFunction<CvmKeyView | null>(CONFIG.CONTRACT_ID, "get_cvm", {});
  }

  public async getConfig(): Promise<ConfigView> {
    return await this.callViewFunction<ConfigView>(CONFIG.CONTRACT_ID, "get_config", {});
  }

  public async getJackpotPools(): Promise<JackpotPoolView[]> {
    return await this.callViewFunction<JackpotPoolView[]>(CONFIG.CONTRACT_ID, "get_jackpot_pools", {});
  }

  public async getCarryoverPool(): Promise<string> {
    return await this.callViewFunction<string>(CONFIG.CONTRACT_ID, "get_carryover_pool", {});
  }

  public async checkCvmHealth(): Promise<{ isHealthy: boolean; uptime?: number; error?: string }> {
    try {
      const res = await fetch(`${CONFIG.CVM_URL}/health`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return { isHealthy: false, error: `HTTP ${res.status}` };
      }
      const data = await res.json();
      return { isHealthy: data.status === "healthy", uptime: data.uptime_seconds };
    } catch (err: any) {
      return { isHealthy: false, error: err.message || String(err) };
    }
  }

  public async fetchCvmKeys(): Promise<{ ed25519_pub: string; x25519_pub: string }> {
    const res = await fetch(`${CONFIG.CVM_URL}/keys`);
    if (!res.ok) {
      throw new Error(`Failed to fetch keys from CVM (${res.status}): ${await res.text()}`);
    }
    return await res.json();
  }

  public async fetchAttestation(): Promise<AttestationReport> {
    const res = await fetch(`${CONFIG.CVM_URL}/attestation`);
    if (!res.ok) {
      throw new Error(`Failed to fetch attestation from CVM (${res.status}): ${await res.text()}`);
    }
    const data = await res.json();

    // Extract quote bytes if present
    let quoteBytes: Uint8Array | null = null;
    if (data.quote) {
      if (typeof data.quote === "object" && !Array.isArray(data.quote)) {
        quoteBytes = new Uint8Array(Object.values(data.quote) as number[]);
      } else if (Array.isArray(data.quote)) {
        quoteBytes = new Uint8Array(data.quote);
      }
    } else if (data.quote_b64) {
      const binStr = atob(data.quote_b64);
      quoteBytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) quoteBytes[i] = binStr.charCodeAt(i);
    }

    // Extract RTMR3 (bytes 520..552) and report_data (bytes 568..600) directly from Intel TDX quote
    let rtmr3Hex = CONFIG.RTMR3_EXPECTED;
    let reportDataHex = data.report_data_hash || "";
    if (quoteBytes && quoteBytes.length >= 600) {
      const rtmr3Slice = quoteBytes.slice(520, 552);
      rtmr3Hex = Array.from(rtmr3Slice).map((b) => b.toString(16).padStart(2, "0")).join("");

      const reportDataSlice = quoteBytes.slice(568, 600);
      reportDataHex = Array.from(reportDataSlice).map((b) => b.toString(16).padStart(2, "0")).join("");
    }

    return {
      ed25519_pubkey: data.ed25519_pub || data.pubkey || "",
      x25519_pubkey: data.x25519_pub || data.x25519_pubkey || "",
      code_hash: rtmr3Hex,
      report_data: reportDataHex,
      is_hardware_tdx: data.is_hardware_tdx ?? true,
      quote_hex: quoteBytes ? Array.from(quoteBytes).map((b) => b.toString(16).padStart(2, "0")).join("") : undefined,
    };
  }
}

export const nearRpc = new NearRpcClient();

/**
 * Exact formatting of yoctoNEAR string to readable NEAR string
 */
export function formatYoctoNear(yoctoStr: string, decimals = 3): string {
  if (!yoctoStr || yoctoStr === "0") return "0";
  try {
    const bi = BigInt(yoctoStr);
    const whole = bi / 10n ** 24n;
    const remainder = bi % 10n ** 24n;
    if (remainder === 0n) return whole.toString();

    const remStr = remainder.toString().padStart(24, "0");
    const trimmed = remStr.slice(0, decimals).replace(/0+$/, "");
    return trimmed.length > 0 ? `${whole}.${trimmed}` : whole.toString();
  } catch {
    return yoctoStr;
  }
}

/**
 * Format yoctoAMSTR (18 decimals)
 */
export function formatYoctoAmstr(yoctoStr: string, decimals = 4): string {
  if (!yoctoStr || yoctoStr === "0") return "0";
  try {
    const bi = BigInt(yoctoStr);
    const whole = bi / 10n ** 18n;
    const remainder = bi % 10n ** 18n;
    if (remainder === 0n) return whole.toString();

    const remStr = remainder.toString().padStart(18, "0");
    const trimmed = remStr.slice(0, decimals).replace(/0+$/, "");
    return trimmed.length > 0 ? `${whole}.${trimmed}` : whole.toString();
  } catch {
    return yoctoStr;
  }
}

export function parseNearToYocto(nearAmount: number | string): string {
  const parts = nearAmount.toString().split(".");
  const whole = BigInt(parts[0] || "0");
  const fracStr = (parts[1] || "").padEnd(24, "0").slice(0, 24);
  const frac = BigInt(fracStr);
  return (whole * 10n ** 24n + frac).toString();
}

export function parseAmstrToYocto(amstrAmount: number | string): string {
  const parts = amstrAmount.toString().split(".");
  const whole = BigInt(parts[0] || "0");
  const fracStr = (parts[1] || "").padEnd(18, "0").slice(0, 18);
  const frac = BigInt(fracStr);
  return (whole * 10n ** 18n + frac).toString();
}
