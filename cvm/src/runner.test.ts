import { describe, it } from "node:test";
import assert from "node:assert";
import nacl from "tweetnacl";
import { sha256 } from "@noble/hashes/sha256";
import { EnclaveKeys } from "./keys.js";
import { AttestationProvider } from "./attestation.js";
import { ResilientRpcClient } from "./rpc.js";
import {
  AutonomousRoundRunner,
  ContractRoundView,
  ContractEntryView,
} from "./runner.js";
import { computeCommit, encryptClientPick } from "./decrypt.js";

describe("Phase 2 Requirements 3 & 5: Pre-committed Seed Draw, Reveal, and Crash Safety", () => {
  async function createFixture() {
    const keys = EnclaveKeys.generate();
    const attestation = await new AttestationProvider().generateAttestation(keys);
    const rpc = new ResilientRpcClient({
      endpoints: ["http://127.0.0.1:9001", "http://127.0.0.1:9002"],
    });
    const runner = new AutonomousRoundRunner(keys, rpc, "amstr-game.testnet", attestation);
    return { keys, attestation, rpc, runner };
  }

  it("posts SHA-256 commit of seed before opening a round", async () => {
    const { runner } = await createFixture();

    const action = await runner.step(100n, null, []);
    assert.strictEqual(action.type, "OpenRound");
    if (action.type === "OpenRound") {
      assert.strictEqual(action.roundId, 1n);
      assert.ok(action.seedCommitBase64.length > 0);
      const commitBytes = Buffer.from(action.seedCommitBase64, "base64");
      assert.strictEqual(commitBytes.length, 32);
    }
  });

  it("waits for deposits when block height is below close_height", async () => {
    const { runner } = await createFixture();
    const { commit } = runner.generateSeedForRound(1n);

    const roundView: ContractRoundView = {
      round_id: 1,
      status: "Open",
      open_height: 100,
      close_height: 200,
      settle_height: null,
      seed_commit: Array.from(commit),
      chain_entropy: null,
      entry_count: 5,
      revealed_count: 0,
    };

    const action = await runner.step(150n, roundView, []);
    assert.strictEqual(action.type, "WaitingForDeposits");
    if (action.type === "WaitingForDeposits") {
      assert.strictEqual(action.roundId, 1n);
      assert.strictEqual(action.remainingBlocks, 50n);
    }
  });

  it("emits CloseRound action once block height exceeds close_height to lock entropy", async () => {
    const { runner } = await createFixture();
    const { commit } = runner.generateSeedForRound(1n);

    const roundView: ContractRoundView = {
      round_id: 1,
      status: "Open",
      open_height: 100,
      close_height: 200,
      settle_height: null,
      seed_commit: Array.from(commit),
      chain_entropy: null,
      entry_count: 5,
      revealed_count: 0,
    };

    const action = await runner.step(205n, roundView, []);
    assert.strictEqual(action.type, "CloseRound");
    if (action.type === "CloseRound") {
      assert.strictEqual(action.roundId, 1n);
    }
  });

  it("reveals pre-committed seed and valid picks when in Revealing state", async () => {
    const { keys, runner } = await createFixture();
    const { seed, commit } = runner.generateSeedForRound(1n);

    // Prepare 2 players
    const aliceMask = 0b00101;
    const aliceSalt = nacl.randomBytes(32);
    const aliceCommit = computeCommit("alice.near", 1n, aliceMask, aliceSalt);
    const aliceCiphertext = encryptClientPick(keys.boxPublicKey, aliceMask, aliceSalt);

    const roundView: ContractRoundView = {
      round_id: 1,
      status: "Revealing",
      open_height: 100,
      close_height: 200,
      settle_height: null,
      seed_commit: Array.from(commit),
      chain_entropy: Array.from(nacl.randomBytes(32)),
      entry_count: 1,
      revealed_count: 0,
    };

    const entries: ContractEntryView[] = [
      {
        account_id: "alice.near",
        gross_stake: "1000000000000000000000000",
        net_stake: "980000000000000000000000",
        commit: Array.from(aliceCommit),
        ciphertext: Array.from(aliceCiphertext),
        mask: null,
        is_valid: true,
        claimed: false,
        refunded: false,
      },
    ];

    const action = await runner.step(210n, roundView, entries);
    assert.strictEqual(action.type, "RevealAndSettle");
    if (action.type === "RevealAndSettle") {
      assert.strictEqual(action.roundId, 1n);
      assert.strictEqual(action.reveals.length, 1);
      assert.strictEqual(action.reveals[0].account_id, "alice.near");
      assert.strictEqual(action.reveals[0].mask, aliceMask);
      assert.strictEqual(action.reveals[0].is_valid, true);

      // Verify revealed seed matches commit
      const revealedSeedBytes = Buffer.from(action.seedBase64, "base64");
      assert.deepStrictEqual(revealedSeedBytes, Buffer.from(seed));
      assert.deepStrictEqual(sha256(revealedSeedBytes), commit);

      // Verify Ed25519 signature on (round_id || seed)
      const sigBytes = Buffer.from(action.signatureBase64, "base64");
      assert.strictEqual(sigBytes.length, 64);
      const expectedMsg = new Uint8Array(8 + 32);
      new DataView(expectedMsg.buffer).setBigUint64(0, 1n, true);
      expectedMsg.set(seed, 8);
      const verified = nacl.sign.detached.verify(expectedMsg, sigBytes, keys.signPublicKey);
      assert.strictEqual(verified, true);
    }
  });

  it("CRASH SAFETY: Refuses to forge an altered seed if CVM restarts, triggering safe timeout refund", async () => {
    // 1. Initial CVM boot creates a seed and commits it on-chain
    const { keys, attestation, rpc } = await createFixture();
    const oldCvmRunner = new AutonomousRoundRunner(keys, rpc, "amstr-game.testnet", attestation);
    const { commit } = oldCvmRunner.generateSeedForRound(1n);

    // 2. CVM crashes/restarts! New runner instance initialized with empty volatile memory
    const restartedCvmRunner = new AutonomousRoundRunner(keys, rpc, "amstr-game.testnet", attestation);

    const roundView: ContractRoundView = {
      round_id: 1,
      status: "Revealing",
      open_height: 100,
      close_height: 200,
      settle_height: null,
      seed_commit: Array.from(commit),
      chain_entropy: Array.from(nacl.randomBytes(32)),
      entry_count: 1,
      revealed_count: 0,
    };

    // 3. Step must NOT generate or reveal a fraudulent seed; must abort for timeout refund!
    const action = await restartedCvmRunner.step(210n, roundView, []);
    assert.strictEqual(action.type, "AbortForTimeoutRefund");
    if (action.type === "AbortForTimeoutRefund") {
      assert.strictEqual(action.roundId, 1n);
      assert.ok(action.reason.includes("Seed lost due to enclave restart"));
    }
  });

  it("opens next round upon seeing Settled or Refunded status", async () => {
    const { runner } = await createFixture();

    const roundView: ContractRoundView = {
      round_id: 7,
      status: "Settled",
      open_height: 100,
      close_height: 200,
      settle_height: 220,
      seed_commit: Array.from(nacl.randomBytes(32)),
      chain_entropy: Array.from(nacl.randomBytes(32)),
      entry_count: 3,
      revealed_count: 3,
    };

    const action = await runner.step(230n, roundView, []);
    assert.strictEqual(action.type, "OpenRound");
    if (action.type === "OpenRound") {
      assert.strictEqual(action.roundId, 8n);
      assert.ok(action.seedCommitBase64.length > 0);
    }
  });
});
