import { sha256 } from "@noble/hashes/sha256";
import nacl from "tweetnacl";
import { EnclaveKeys } from "./keys.js";
import { ResilientRpcClient } from "./rpc.js";
import { decryptAndVerifyEntry, DecryptedReveal } from "./decrypt.js";
import { AttestationReport } from "./attestation.js";

export interface ContractRoundView {
  round_id: number;
  status: "Open" | "Revealing" | "Settled" | "Refunded";
  open_height: number;
  close_height: number;
  settle_height: number | null;
  seed_commit: number[];
  chain_entropy: number[] | null;
  entry_count: number;
  revealed_count: number;
}

export interface ContractEntryView {
  account_id: string;
  gross_stake: string;
  net_stake: string;
  commit: number[];
  ciphertext: number[];
  mask: number | null;
  is_valid: boolean;
  claimed: boolean;
  refunded: boolean;
}

export type RunnerAction =
  | { type: "OpenRound"; roundId: bigint; seedCommitBase64: string }
  | { type: "WaitingForDeposits"; roundId: bigint; remainingBlocks: bigint }
  | { type: "CloseRound"; roundId: bigint }
  | {
      type: "RevealAndSettle";
      roundId: bigint;
      reveals: DecryptedReveal[];
      seedBase64: string;
      signatureBase64: string;
    }
  | { type: "AbortForTimeoutRefund"; roundId: bigint; reason: string };

export class AutonomousRoundRunner {
  public readonly keys: EnclaveKeys;
  public readonly rpc: ResilientRpcClient;
  public readonly contractId: string;
  public readonly attestation: AttestationReport;

  // Volatile in-memory seed storage. Completely wiped if CVM restarts.
  private readonly activeSeeds = new Map<bigint, Uint8Array>();

  constructor(
    keys: EnclaveKeys,
    rpc: ResilientRpcClient,
    contractId: string,
    attestation: AttestationReport
  ) {
    this.keys = keys;
    this.rpc = rpc;
    this.contractId = contractId;
    this.attestation = attestation;
  }

  /**
   * Generates a cryptographically secure 32-byte seed in volatile enclave memory
   */
  public generateSeedForRound(roundId: bigint): { seed: Uint8Array; commit: Uint8Array } {
    const seed = nacl.randomBytes(32);
    const commit = sha256(seed);
    this.activeSeeds.set(roundId, seed);
    return { seed, commit };
  }

  /**
   * Requirement 5: If the CVM crashes or restarts, it must not reveal a different seed.
   * If the seed is not in volatile memory matching the commit, return null to trigger timeout refund.
   */
  public getVerifiedSeed(roundId: bigint, onChainCommit: Uint8Array): Uint8Array | null {
    const seed = this.activeSeeds.get(roundId);
    if (seed) {
      const derived = sha256(seed);
      if (Buffer.from(derived).equals(Buffer.from(onChainCommit))) {
        return seed;
      } else {
        console.error(`[CRITICAL] Memory corruption: In-memory seed for round ${roundId} does not match commit!`);
        return null;
      }
    }

    console.warn(
      `[Crash Recovery] Seed for round ${roundId} not in memory (CVM restarted). Refusing to forge altered seed. Safe timeout refund will trigger.`
    );
    return null;
  }

  /**
   * Evaluates the next autonomous action for the game round
   */
  public async step(
    currentBlock: bigint,
    round: ContractRoundView | null,
    entries: ContractEntryView[] = []
  ): Promise<RunnerAction> {
    if (!round) {
      // No round exists yet -> Open Round 1
      const { commit } = this.generateSeedForRound(1n);
      return {
        type: "OpenRound",
        roundId: 1n,
        seedCommitBase64: Buffer.from(commit).toString("base64"),
      };
    }

    const roundId = BigInt(round.round_id);

    switch (round.status) {
      case "Settled":
      case "Refunded": {
        const nextRoundId = roundId + 1n;
        const { commit } = this.generateSeedForRound(nextRoundId);
        return {
          type: "OpenRound",
          roundId: nextRoundId,
          seedCommitBase64: Buffer.from(commit).toString("base64"),
        };
      }

      case "Open": {
        const closeHeight = BigInt(round.close_height);
        if (currentBlock > closeHeight) {
          // Deposit window closed! Close round to lock chain_entropy
          return {
            type: "CloseRound",
            roundId,
          };
        } else {
          return {
            type: "WaitingForDeposits",
            roundId,
            remainingBlocks: closeHeight - currentBlock,
          };
        }
      }

      case "Revealing": {
        const onChainCommit = new Uint8Array(round.seed_commit);

        // Requirement 5: Enclave crash safety
        const seed = this.getVerifiedSeed(roundId, onChainCommit);
        if (!seed) {
          return {
            type: "AbortForTimeoutRefund",
            roundId,
            reason: "Seed lost due to enclave restart; safe timeout refund triggered after 10m",
          };
        }

        // Requirement 4: Decrypt entries and verify against on-chain commits
        const reveals: DecryptedReveal[] = [];
        for (const entry of entries) {
          const entryCommit = new Uint8Array(entry.commit);
          const ciphertext = new Uint8Array(entry.ciphertext);

          const reveal = decryptAndVerifyEntry(
            this.keys,
            entry.account_id,
            roundId,
            ciphertext,
            entryCommit
          );
          reveals.push(reveal);
        }

        // Requirement 3: Reveal seed and Ed25519 signature on (round_id || seed)
        const signature = this.keys.signSettle(roundId, seed);

        return {
          type: "RevealAndSettle",
          roundId,
          reveals,
          seedBase64: Buffer.from(seed).toString("base64"),
          signatureBase64: Buffer.from(signature).toString("base64"),
        };
      }

      default:
        throw new Error(`Unexpected round status: ${(round as any).status}`);
    }
  }
}
