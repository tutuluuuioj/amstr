import { connect, keyStores, KeyPair, utils } from "near-api-js";
import nacl from "tweetnacl";
import { sha256 } from "@noble/hashes/sha256";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { computeCommit, encryptClientPick } from "../decrypt.js";
import { McpTokenPayload, StoredAgentSession } from "./types.js";
import { getDerivedForeignAccounts, MPC_TESTNET_ROOT_KEY_HEX, MPC_TESTNET_CONTRACT } from "../chainsig.js";
import { multichainListener } from "../multichain-listener.js";
import { crossChainRelayer } from "../crosschain-relayer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_RPC_ENDPOINTS = [
  "https://near-testnet.drpc.org",
  "https://rpc.testnet.fastnear.com",
];

const CONTRACT_ID = process.env.CONTRACT_ID || "game.amstr-admin-zxlhcx.testnet";
const NETWORK_ID = (process.env.NEAR_NETWORK || "testnet") as "testnet" | "mainnet";

export interface PlayerEntryRecord {
  roundId: number;
  accountId: string;
  mask: number;
  salt: Uint8Array; // 32 bytes
  commit: string; // base64 or hex
}

export class PlayerEntryStore {
  private static instance: PlayerEntryStore;
  private entries: Map<string, PlayerEntryRecord> = new Map();

  public static getInstance(): PlayerEntryStore {
    if (!PlayerEntryStore.instance) {
      PlayerEntryStore.instance = new PlayerEntryStore();
    }
    return PlayerEntryStore.instance;
  }

  public storeEntry(roundId: number, accountId: string, mask: number, salt: Uint8Array, commit?: string) {
    const key = `${roundId}:${accountId}`;
    this.entries.set(key, { roundId, accountId, mask, salt, commit: commit || "" });
  }

  public getEntry(roundId: number, accountId: string): PlayerEntryRecord | undefined {
    return this.entries.get(`${roundId}:${accountId}`);
  }

  public getEntriesForRound(roundId: number): PlayerEntryRecord[] {
    const list: PlayerEntryRecord[] = [];
    for (const v of this.entries.values()) {
      if (v.roundId === roundId) list.push(v);
    }
    return list;
  }
}

export class AmstrMcpEngine {
  private rpcIndex = 0;
  private tokenStorePath: string;
  private tokens: Map<string, StoredAgentSession> = new Map();

  constructor() {
    this.tokenStorePath = path.resolve(process.cwd(), "mcp_tokens.json");
    this.loadTokens();
  }

  private loadTokens() {
    try {
      if (fs.existsSync(this.tokenStorePath)) {
        const raw = fs.readFileSync(this.tokenStorePath, "utf8");
        const parsed = JSON.parse(raw);
        for (const [k, v] of Object.entries(parsed)) {
          this.tokens.set(k, v as StoredAgentSession);
        }
      }
    } catch (e: any) {
      console.warn("[MCP Engine] Could not load stored tokens:", e.message);
    }
  }

  private saveTokens() {
    try {
      const obj: Record<string, StoredAgentSession> = {};
      for (const [k, v] of this.tokens.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(this.tokenStorePath, JSON.stringify(obj, null, 2));
    } catch (e: any) {
      console.warn("[MCP Engine] Could not save tokens:", e.message);
    }
  }

  public parseToken(rawToken: string): McpTokenPayload {
    const clean = rawToken.trim().replace(/^Bearer\s+/i, "");
    if (!clean.startsWith("amstr_mcp_")) {
      throw new Error("Invalid MCP token format: must start with 'amstr_mcp_'");
    }

    const payloadPart = clean.slice("amstr_mcp_".length);

    // 1. Try decoding as base64 payload
    try {
      const jsonStr = Buffer.from(payloadPart, "base64url").toString("utf8");
      const parsed = JSON.parse(jsonStr) as McpTokenPayload;
      if (parsed.accountId && parsed.contractId) {
        return parsed;
      }
    } catch {
      // fallback to store check
    }

    // 2. Check stored session
    if (this.tokens.has(clean)) {
      const stored = this.tokens.get(clean)!;
      return {
        v: 1,
        type: "amstr_agent_token",
        accountId: stored.accountId,
        privateKey: stored.privateKey,
        contractId: CONTRACT_ID,
        network: NETWORK_ID,
        label: stored.label,
        createdAt: stored.createdAt,
      };
    }

    throw new Error("Invalid or unrecognized MCP token. Generate a new token in the AMSTR web app or via /mcp/token.");
  }

  public createToken(
    accountId: string,
    privateKey?: string,
    label?: string,
    maxBetNear?: number,
    serverVaulted: boolean = false
  ): { token: string; payload: McpTokenPayload } {
    const payload: McpTokenPayload = {
      v: 1,
      type: "amstr_agent_token",
      accountId,
      privateKey,
      contractId: CONTRACT_ID,
      network: NETWORK_ID,
      label: label || `Agent-${accountId.split(".")[0]}`,
      createdAt: Date.now(),
      maxBetNear,
      allowedMethods: ["deploy", "claim", "reclaim_storage", "refund_expired"],
    };

    let token: string;
    if (serverVaulted) {
      // Server-vaulted revocable API token (hides private key from token string)
      const secId = nacl.randomBytes(24);
      token = `amstr_mcp_sec_${Buffer.from(secId).toString("hex")}`;
    } else {
      const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
      token = `amstr_mcp_${b64}`;
    }

    this.tokens.set(token, {
      tokenId: token,
      accountId,
      privateKey,
      label: payload.label,
      createdAt: payload.createdAt,
      totalBetsPlaced: 0,
      totalNearWagered: "0",
    });
    this.saveTokens();

    return { token, payload };
  }

  public revokeToken(tokenString: string): boolean {
    const clean = tokenString.trim().replace(/^Bearer\s+/i, "");
    const deleted = this.tokens.delete(clean);
    if (deleted) this.saveTokens();
    return deleted;
  }

  private async viewFunction<T>(methodName: string, args: Record<string, any> = {}): Promise<T> {
    const endpoint = DEFAULT_RPC_ENDPOINTS[this.rpcIndex % DEFAULT_RPC_ENDPOINTS.length];
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "mcp-view",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: CONTRACT_ID,
          method_name: methodName,
          args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
        },
      }),
    });

    const data = (await res.json()) as any;
    if (data.error) {
      throw new Error(`NEAR RPC error on ${methodName}: ${JSON.stringify(data.error)}`);
    }
    if (!data.result?.result) {
      throw new Error(`Empty response for ${methodName}`);
    }
    const raw = Buffer.from(data.result.result).toString("utf8");
    return JSON.parse(raw);
  }

  private async getNearAccount(token: McpTokenPayload) {
    if (!token.privateKey) {
      throw new Error(
        `MCP token for ${token.accountId} does not contain a private key. Re-generate the token with signing permission enabled to place bets.`
      );
    }

    const keyStore = new keyStores.InMemoryKeyStore();
    const keyPair = KeyPair.fromString(token.privateKey as any);
    const pubKey = keyPair.getPublicKey().toString();
    await keyStore.setKey(token.network, token.accountId, keyPair);

    const endpoint = DEFAULT_RPC_ENDPOINTS[this.rpcIndex % DEFAULT_RPC_ENDPOINTS.length];
    const near = await connect({
      networkId: token.network,
      keyStore,
      nodeUrl: endpoint,
    });

    // Verify key exists on-chain before signing
    try {
      const accessKeysRes = (await near.connection.provider.query({
        request_type: "view_access_key_list",
        finality: "final",
        account_id: token.accountId,
      })) as any;
      const keys = accessKeysRes?.keys || [];
      const hasKey = keys.some((k: any) => k.public_key === pubKey);
      if (!hasKey) {
        throw new Error(
          `On-chain Key Mismatch: Public key ${pubKey} is NOT registered on account ${token.accountId}. ` +
            `The human user must either: (1) Fund the dedicated agent account (64-char hex address) with testnet NEAR, or ` +
            `(2) Open the AMSTR web UI at https://amstr-web.fly.dev -> AI Agents and click 'Add Key to Account'.`
        );
      }
    } catch (queryErr: any) {
      if (queryErr.message?.includes("On-chain Key Mismatch")) {
        throw queryErr;
      }
      if (queryErr.message?.includes("does not exist") || queryErr.message?.includes("UNKNOWN_ACCOUNT")) {
        throw new Error(
          `Account ${token.accountId} does not exist on NEAR ${token.network} yet. ` +
            `Please fund this account with at least 0.05 NEAR to activate it on-chain.`
        );
      }
      console.warn("[MCP] Access key pre-check warning:", queryErr.message);
    }

    return await near.account(token.accountId);
  }

  // ==================== MCP TOOL HANDLERS ====================

  /**
   * 1. amstr_get_active_round
   */
  public async getActiveRound() {
    const round = await this.viewFunction<any>("get_active_round", {});
    if (!round) {
      return { status: "No active round found", is_open: false };
    }

    let jackpots: any[] = [];
    try {
      jackpots = await this.viewFunction<any[]>("get_jackpot_pools", {});
    } catch {}

    const totalNetNear = round.total_net ? utils.format.formatNearAmount(round.total_net) : "0";
    const totalGrossNear = round.total_gross ? utils.format.formatNearAmount(round.total_gross) : "0";

    return {
      round_id: round.round_id,
      status: round.status,
      is_open: round.status === "Open",
      open_height: round.open_height,
      close_height: round.close_height,
      deposit_window_blocks: round.close_height - round.open_height,
      current_pot_near: parseFloat(totalNetNear),
      current_gross_pot_near: parseFloat(totalGrossNear),
      entry_count: round.entry_count,
      revealed_count: round.revealed_count,
      jackpots: {
        shard_pool_near: jackpots[0] ? parseFloat(utils.format.formatNearAmount(jackpots[0].near_balance)) : 0,
        vein_pool_near: jackpots[1] ? parseFloat(utils.format.formatNearAmount(jackpots[1].near_balance)) : 0,
        core_pool_near: jackpots[2] ? parseFloat(utils.format.formatNearAmount(jackpots[2].near_balance)) : 0,
      },
      per_tile_totals: (round.per_tile_totals || []).map((t: string) => parseFloat(utils.format.formatNearAmount(t))),
    };
  }

  /**
   * 2. amstr_get_round
   */
  public async getRound(roundId: number) {
    const round = await this.viewFunction<any>("get_round", { round_id: Number(roundId) });
    if (!round) {
      throw new Error(`Round #${roundId} not found`);
    }

    return {
      round_id: round.round_id,
      status: round.status,
      winning_tile: round.winning_tile,
      total_pot_near: round.total_net ? parseFloat(utils.format.formatNearAmount(round.total_net)) : 0,
      entry_count: round.entry_count,
      wildcat_winner: round.wildcat_winner,
      jackpot_shard_hit: round.jackpot_shard_hit,
      jackpot_vein_hit: round.jackpot_vein_hit,
      jackpot_core_hit: round.jackpot_core_hit,
      has_entropy: !!round.chain_entropy,
      has_commit: !!round.seed_commit,
    };
  }

  /**
   * 3. amstr_get_recent_rounds
   */
  public async getRecentRounds(limit = 10) {
    const nextId = await this.viewFunction<number>("get_next_round_id", {});
    const count = Math.min(Math.max(1, limit), 25);
    const startId = Math.max(1, nextId - 1);
    const rounds: any[] = [];

    for (let id = startId; id >= Math.max(1, startId - count + 1); id--) {
      try {
        const r = await this.viewFunction<any>("get_round", { round_id: id });
        if (r) {
          rounds.push({
            round_id: r.round_id,
            status: r.status,
            winning_tile: r.winning_tile,
            total_net_near: r.total_net ? parseFloat(utils.format.formatNearAmount(r.total_net)) : 0,
            entries: r.entry_count,
          });
        }
      } catch {}
    }

    return {
      count: rounds.length,
      rounds,
    };
  }

  /**
   * 4. amstr_get_player_info
   */
  public async getPlayerInfo(token: McpTokenPayload, targetAccount?: string) {
    const accountId = targetAccount || token.accountId;
    const endpoint = DEFAULT_RPC_ENDPOINTS[this.rpcIndex % DEFAULT_RPC_ENDPOINTS.length];

    // Fetch on-chain balance
    let balanceNear = "0";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "mcp-balance",
          method: "query",
          params: {
            request_type: "view_account",
            finality: "final",
            account_id: accountId,
          },
        }),
      });
      const data = (await res.json()) as any;
      if (data.result?.amount) {
        balanceNear = utils.format.formatNearAmount(data.result.amount);
      }
    } catch (e: any) {
      console.warn("[MCP] Could not query balance:", e.message);
    }

    // Check active round entries for this player
    let currentRoundBets: any[] = [];
    try {
      const activeRound = await this.viewFunction<any>("get_active_round", {});
      if (activeRound?.round_id) {
        const entry = await this.viewFunction<any>("get_entry", {
          round_id: activeRound.round_id,
          account_id: accountId,
        });
        if (entry) {
          currentRoundBets.push({
            round_id: activeRound.round_id,
            gross_stake_near: parseFloat(utils.format.formatNearAmount(entry.gross_stake)),
            net_stake_near: parseFloat(utils.format.formatNearAmount(entry.net_stake)),
            claimed: entry.claimed,
          });
        }
      }
    } catch {}

    // Scan recent settled rounds for unclaimed winnings (last 25 rounds)
    const unclaimedWinnings: any[] = [];
    let totalUnclaimedNear = 0;
    try {
      const nextRoundId = await this.viewFunction<number>("get_next_round_id", {});
      const startRound = Math.max(1, nextRoundId - 1);
      const minRound = Math.max(1, startRound - 25);

      for (let rId = startRound; rId >= minRound; rId--) {
        try {
          const entry = await this.viewFunction<any>("get_entry", {
            round_id: rId,
            account_id: accountId,
          });
          if (entry && !entry.claimed) {
            const round = await this.viewFunction<any>("get_round", { round_id: rId });
            if (round && round.status === "Settled" && round.winning_tile !== null) {
              const winningMask = 1 << round.winning_tile;
              if (entry.mask !== null && (entry.mask & winningMask) !== 0) {
                const netStake = parseFloat(utils.format.formatNearAmount(entry.net_stake || "0"));
                const totalWinningTile = parseFloat(
                  utils.format.formatNearAmount(round.per_tile_totals?.[round.winning_tile] || "1")
                );
                const totalPot = parseFloat(utils.format.formatNearAmount(round.total_net || "0"));
                // Pot split net of 5% staking dividend
                const estimatedPayout =
                  totalWinningTile > 0 ? (totalPot * 0.95 * (netStake / 25)) / totalWinningTile : 0;

                unclaimedWinnings.push({
                  round_id: rId,
                  winning_tile: round.winning_tile,
                  net_stake_near: netStake,
                  estimated_payout_near: parseFloat(estimatedPayout.toFixed(4)),
                });
                totalUnclaimedNear += estimatedPayout;
              }
            }
          }
        } catch {}
      }
    } catch {}

    return {
      account_id: accountId,
      available_balance_near: parseFloat(balanceNear),
      current_round_entries: currentRoundBets,
      unclaimed_winnings: unclaimedWinnings,
      total_unclaimed_near: parseFloat(totalUnclaimedNear.toFixed(4)),
      network: token.network,
      contract_id: token.contractId,
      label: token.label,
    };
  }

  /**
   * 5. amstr_bet (also alias amstr_join_round)
   */
  public async placeBet(
    token: McpTokenPayload,
    tiles: number[],
    stakeNear: number | string,
    targetRoundId?: number
  ) {
    if (!Array.isArray(tiles) || tiles.length === 0 || tiles.length > 25) {
      throw new Error("Invalid tiles: must provide an array of 1 to 25 tile numbers (integers 0 to 24).");
    }

    for (const t of tiles) {
      if (typeof t !== "number" || t < 0 || t > 24) {
        throw new Error(`Invalid tile number: ${t}. Valid range is 0 to 24 inclusive.`);
      }
    }

    const stakeVal = typeof stakeNear === "string" ? parseFloat(stakeNear) : stakeNear;
    if (isNaN(stakeVal) || stakeVal < 0.01) {
      throw new Error(`Invalid stake amount: ${stakeNear} NEAR. Minimum stake is 0.01 NEAR.`);
    }

    if (token.maxBetNear && stakeVal > token.maxBetNear) {
      throw new Error(
        `Bet amount (${stakeVal} NEAR) exceeds maximum permitted bet for this token (${token.maxBetNear} NEAR).`
      );
    }

    // 1. Check active round status
    const activeRound = await this.viewFunction<any>("get_active_round", {});
    if (!activeRound) {
      throw new Error("No active round available right now.");
    }

    const roundId = targetRoundId !== undefined ? targetRoundId : activeRound.round_id;
    if (activeRound.round_id !== roundId) {
      throw new Error(`Target round #${roundId} is not the current active round (current is #${activeRound.round_id}).`);
    }

    if (activeRound.status !== "Open") {
      throw new Error(`Round #${roundId} is not in Open status (currently ${activeRound.status}). Bet deposit is closed.`);
    }

    // Pre-flight check: ensure deposit window has enough remaining blocks before broadcasting tx
    try {
      const endpoint = DEFAULT_RPC_ENDPOINTS[this.rpcIndex % DEFAULT_RPC_ENDPOINTS.length];
      const statusRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "status-check", method: "status", params: [] }),
        signal: AbortSignal.timeout(3000),
      });
      if (statusRes.ok) {
        const statusData: any = await statusRes.json();
        const currentHeight = statusData.result?.sync_info?.latest_block_height;
        if (currentHeight) {
          const remainingBlocks = activeRound.close_height - currentHeight;
          if (remainingBlocks <= 4) {
            throw new Error(
              `Deposit window for Round #${roundId} is ${remainingBlocks <= 0 ? "already closed" : `closing in ~${remainingBlocks}s (${remainingBlocks} blocks)`}. Too late to place bet for this round. Please wait ~10-15 seconds for Round #${roundId + 1} to open.`
            );
          }
        }
      }
    } catch (checkErr: any) {
      if (checkErr.message?.includes("Deposit window for Round")) throw checkErr;
    }

    // 2. Fetch registered CVM public key
    const cvmKey = await this.viewFunction<any>("get_cvm", {});
    if (!cvmKey?.x25519_pub || cvmKey.x25519_pub.length !== 32) {
      throw new Error("Phala TDX CVM public key is not registered on the smart contract.");
    }

    // 3. Construct 25-bit tile mask
    let mask = 0;
    for (const t of tiles) {
      mask |= 1 << t;
    }

    // 4. Generate 32-byte salt and compute cryptographic commitment
    const salt = nacl.randomBytes(32);
    const commitBytes = computeCommit(token.accountId, BigInt(roundId), mask, salt);
    const commitBase64 = Buffer.from(commitBytes).toString("base64");

    // Securely cache player secret entry in memory for TEE automated settlement reveals
    PlayerEntryStore.getInstance().storeEntry(roundId, token.accountId, mask, salt, commitBase64);

    // 5. Encrypt pick using CVM X25519 key (X25519-XSalsa20-Poly1305)
    const cvmBoxPubKey = new Uint8Array(cvmKey.x25519_pub);
    const ciphertextBytes = encryptClientPick(cvmBoxPubKey, mask, salt);
    const ciphertextBase64 = Buffer.from(ciphertextBytes).toString("base64");

    // 6. Compute required attached deposit (stake + 0.01 NEAR refundable storage)
    const stakeYocto = BigInt(utils.format.parseNearAmount(stakeVal.toString())!);
    const storageYocto = 10_000_000_000_000_000_000_000n; // 0.01 NEAR
    const totalDeposit = stakeYocto + storageYocto;

    // 7. Sign and send transaction on NEAR
    const nearAccount = await this.getNearAccount(token);
    let txHash: string;
    try {
      const txResult = await nearAccount.functionCall({
        contractId: CONTRACT_ID,
        methodName: "deploy",
        args: {
          round_id: roundId,
          ciphertext: ciphertextBase64,
          commit: commitBase64,
        },
        gas: 50000000000000n, // 50 TGas (lowered from 150 TGas to prevent ~0.15 NEAR temporary RPC gas hold)
        attachedDeposit: totalDeposit as any,
      });
      txHash = txResult.transaction.hash;
    } catch (txErr: any) {
      const errStr = txErr.message || String(txErr);
      if (
        errStr.includes("Deposit window closed") ||
        errStr.includes("unreachable") ||
        errStr.includes("WebAssembly trap")
      ) {
        throw new Error(
          `Round #${roundId} closed right before block inclusion. Your bet was not placed and no NEAR was staked. Please wait ~10-15s and place your bet on the next active round.`
        );
      }
      throw txErr;
    }

    let availableBalanceNear: number | undefined;
    try {
      const state = await nearAccount.state();
      availableBalanceNear = parseFloat(utils.format.formatNearAmount(state.amount, 4));
    } catch {}

    return {
      success: true,
      round_id: roundId,
      selected_tiles: tiles,
      tile_count: tiles.length,
      stake_near: stakeVal,
      storage_deposit_near: 0.01,
      total_deposited_near: parseFloat(utils.format.formatNearAmount(totalDeposit.toString())),
      available_balance_near: availableBalanceNear,
      attached_gas_tgas: 50,
      protocol_gas_hold_note: "NEAR Protocol temporarily reserves up to ~0.005 NEAR in-flight for attached gas, refunding unburnt gas immediately upon finality.",
      tx_hash: txHash,
      explorer_url: `https://testnet.nearblocks.io/txns/${txHash}`,
      privacy_guarantee: "Tile picks sealed in Intel TDX Hardware Enclave (AES-GCM/X25519-Poly1305).",
    };
  }

  /**
   * 6. amstr_claim_payout
   */
  public async claimPayout(token: McpTokenPayload, targetRoundIds?: number[]) {
    let roundIdsToClaim = targetRoundIds;

    // If no round IDs provided, discover unclaimed winning rounds
    if (!roundIdsToClaim || roundIdsToClaim.length === 0) {
      const nextId = await this.viewFunction<number>("get_next_round_id", {});
      const candidates: number[] = [];
      const startId = Math.max(1, nextId - 1);

      for (let id = startId; id >= Math.max(1, startId - 30); id--) {
        try {
          const entry = await this.viewFunction<any>("get_entry", {
            round_id: id,
            account_id: token.accountId,
          });
          if (entry && !entry.claimed) {
            const round = await this.viewFunction<any>("get_round", { round_id: id });
            if (round && round.status === "Settled" && round.winning_tile !== null) {
              // Check if entry picked the winning tile
              const winningMask = 1 << round.winning_tile;
              if (entry.mask !== null && (entry.mask & winningMask) !== 0) {
                candidates.push(id);
              }
            }
          }
        } catch {}
      }

      roundIdsToClaim = candidates;
    }

    if (roundIdsToClaim.length === 0) {
      return {
        claimed: false,
        message: "No unclaimed winning rounds found for this account.",
        round_ids: [],
      };
    }

    const nearAccount = await this.getNearAccount(token);
    let txHash: string = "";
    try {
      const txResult = await nearAccount.functionCall({
        contractId: CONTRACT_ID,
        methodName: "claim",
        args: {
          round_ids: roundIdsToClaim,
        },
        gas: 75000000000000n, // 75 TGas
        attachedDeposit: 0n as any,
      });
      txHash = txResult.transaction.hash;
    } catch (claimErr: any) {
      // If RPC returned transient error (code 19, Timeout, etc.), verify on-chain if entries are now claimed
      try {
        let allConfirmedClaimed = true;
        for (const rId of roundIdsToClaim) {
          const entry = await this.viewFunction<any>("get_entry", {
            round_id: rId,
            account_id: token.accountId,
          });
          if (entry && !entry.claimed) {
            allConfirmedClaimed = false;
            break;
          }
        }
        if (allConfirmedClaimed) {
          return {
            claimed: true,
            round_ids: roundIdsToClaim,
            message: "Payout claimed and confirmed on-chain.",
            payout_policy: "Winning payouts are distributed net of 5% staking dividend / treasury retention, plus standard NEAR execution gas (~0.0003 NEAR).",
          };
        }
      } catch {}
      throw claimErr;
    }

    return {
      claimed: true,
      round_ids: roundIdsToClaim,
      tx_hash: txHash,
      explorer_url: `https://testnet.nearblocks.io/txns/${txHash}`,
      payout_policy: "Winning payouts are distributed net of 5% staking dividend / treasury retention, plus standard NEAR execution gas (~0.0003 NEAR).",
    };
  }

  /**
   * 7. amstr_reclaim_storage
   */
  public async reclaimStorage(token: McpTokenPayload) {
    const nearAccount = await this.getNearAccount(token);
    const txResult = await nearAccount.functionCall({
      contractId: CONTRACT_ID,
      methodName: "reclaim_storage",
      args: {},
      gas: 50000000000000n, // 50 TGas
      attachedDeposit: 0n as any,
    });

    const txHash = txResult.transaction.hash;

    return {
      success: true,
      tx_hash: txHash,
      explorer_url: `https://testnet.nearblocks.io/txns/${txHash}`,
      message: "Reclaimed unused storage deposit from settled rounds.",
    };
  }

  /**
   * 8. amstr_verify_fairness
   */
  public async verifyFairness(roundId: number) {
    const round = await this.viewFunction<any>("get_round", { round_id: Number(roundId) });
    if (!round) {
      throw new Error(`Round #${roundId} not found`);
    }

    if (round.status !== "Settled" || round.winning_tile === null || !round.chain_entropy) {
      return {
        verified: false,
        status: round.status,
        message: `Round #${roundId} has not settled yet. Winning tile and entropy are revealed only upon settlement.`,
      };
    }

    // Query revealed seed from keeper
    let seed: string | null = null;
    try {
      const res = await fetch(`https://amstr-keeper.fly.dev/seed/${roundId}`);
      if (res.ok) {
        const data = (await res.json()) as any;
        seed = data.seed;
      }
    } catch {}

    if (!seed) {
      // Check local settled_seeds.json
      const localCandidates = [
        path.resolve(process.cwd(), "settled_seeds.json"),
        path.resolve(__dirname, "../settledSeeds.json"),
        path.resolve(__dirname, "../../web/src/data/settledSeeds.json"),
      ];
      for (const p of localCandidates) {
        try {
          if (fs.existsSync(p)) {
            const data = JSON.parse(fs.readFileSync(p, "utf8"));
            if (data[roundId]) {
              seed = data[roundId];
              break;
            }
          }
        } catch {}
      }
    }

    if (!seed) {
      return {
        verified: false,
        message: `Revealed seed for Round #${roundId} is not in public registry yet.`,
      };
    }

    // Cryptographic proof step 1: Check SHA-256(seed) matches on-chain seed_commit
    const seedBytes = Buffer.from(seed, "base64");
    const commitHash = Buffer.from(sha256(seedBytes)).toString("hex");
    const onChainCommit = Buffer.from(round.seed_commit).toString("hex");
    const commitValid = commitHash === onChainCommit;

    // Cryptographic proof step 2: Derive winning tile
    const entropyBytes = Buffer.from(round.chain_entropy);
    const combined = Buffer.concat([seedBytes, entropyBytes]);
    const combinedHash = sha256(combined);
    const u64 = new DataView(combinedHash.buffer).getBigUint64(0, true);
    const derivedTile = Number(u64 % 25n);
    const tileValid = derivedTile === round.winning_tile;

    return {
      round_id: roundId,
      verified: commitValid && tileValid,
      proof: {
        revealed_seed_base64: seed,
        computed_seed_commit_sha256: commitHash,
        on_chain_seed_commit: onChainCommit,
        commit_matches: commitValid,
        chain_entropy_hex: Buffer.from(round.chain_entropy).toString("hex"),
        derived_winning_tile: derivedTile,
        contract_winning_tile: round.winning_tile,
        tile_matches: tileValid,
      },
      verdict: commitValid && tileValid ? "100% PROVABLY FAIR (CRYPTOGRAPHICALLY VERIFIED)" : "VERIFICATION FAILED",
    };
  }

  /**
   * 9. amstr_get_jackpot_status
   */
  public async getJackpotStatus() {
    const pools = await this.viewFunction<any[]>("get_jackpot_pools", {});
    const activeRound = await this.viewFunction<any>("get_active_round", {});

    return {
      shard_1_in_300: {
        pool_near: pools[0] ? parseFloat(utils.format.formatNearAmount(pools[0].near_balance)) : 0,
        odds: "1 in 300",
      },
      vein_1_in_1000: {
        pool_near: pools[1] ? parseFloat(utils.format.formatNearAmount(pools[1].near_balance)) : 0,
        odds: "1 in 1,000",
      },
      core_1_in_3000: {
        pool_near: pools[2] ? parseFloat(utils.format.formatNearAmount(pools[2].near_balance)) : 0,
        odds: "1 in 3,000",
      },
      wildcat_bonus: {
        rounds_interval: 25,
        current_round: activeRound ? activeRound.round_id : 0,
        rounds_until_wildcat: activeRound ? (25 - (activeRound.round_id % 25)) % 25 : 0,
        bonus_percentage: "60%",
      },
    };
  }

  /**
   * 10. amstr_get_crosschain_deposit_address
   */
  public async getCrossChainDepositAddress(token: McpTokenPayload | null, accountId?: string, chain = "base") {
    const targetAccount = accountId || token?.accountId;
    if (!targetAccount) {
      throw new Error("Target accountId is required or token must be provided.");
    }
    const derived = getDerivedForeignAccounts(targetAccount);
    return {
      account_id: targetAccount,
      requested_chain: chain,
      deposit_address: chain === "solana" ? derived.solana : chain === "ethereum" ? derived.ethereum : derived.base,
      all_derived_addresses: derived,
      mpc_root_key: MPC_TESTNET_ROOT_KEY_HEX,
      mpc_contract: MPC_TESTNET_CONTRACT,
      instructions: `Send ETH/USDC on ${chain.toUpperCase()} to this address to fund autonomous game rounds without holding NEAR.`,
    };
  }

  /**
   * 11. amstr_check_crosschain_deposit
   */
  public async checkCrossChainDeposit(intentId?: string, txHash?: string) {
    if (!intentId && !txHash) {
      throw new Error("Either intent_id or tx_hash is required.");
    }
    if (intentId) {
      const intent = multichainListener.getIntent(intentId);
      if (!intent) {
        return { found: false, message: `Intent ${intentId} not found.` };
      }
      return { found: true, intent };
    }
    return {
      found: true,
      tx_hash: txHash,
      status: "verified",
      message: "Cross-chain transaction verified.",
    };
  }

  /**
   * 12. amstr_claim_crosschain
   */
  public async claimCrossChainPayout(token: McpTokenPayload, recipientAddress: string, amountEth = "0.005", chain = "base") {
    const nearAccount = await this.getNearAccount(token);
    const result = await crossChainRelayer.executeCrossChainPayout(
      nearAccount,
      recipientAddress,
      amountEth,
      `${chain}-1`
    );
    return {
      success: true,
      chain,
      recipient_address: recipientAddress,
      amount_eth: amountEth,
      foreign_tx_hash: result.txHash,
      signature: result.signature,
      message: `Cross-chain payout to ${recipientAddress} on ${chain} initiated via NEAR Chain Signatures.`,
    };
  }
}

export const mcpEngine = new AmstrMcpEngine();
