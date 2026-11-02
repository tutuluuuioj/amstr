import { describe, it } from "node:test";
import assert from "node:assert";
import nacl from "tweetnacl";
import { EnclaveKeys } from "./keys.js";
import {
  computeCommit,
  decryptAndVerifyEntry,
  encryptClientPick,
  toContractRevealItems,
} from "./decrypt.js";

describe("Phase 2 Requirement 4: Post-Close Decryption and Commit Verification", () => {
  it("computes exact length-prefixed SHA-256 commit hash matching smart contract", () => {
    const accountId = "alice.near";
    const roundId = 1n;
    const mask = 0b00001; // Tile 0 selected
    const salt = new Uint8Array(32).fill(7);

    const commit = computeCommit(accountId, roundId, mask, salt);
    assert.strictEqual(commit.length, 32);

    // Verify determinism
    const commit2 = computeCommit(accountId, roundId, mask, salt);
    assert.deepStrictEqual(commit, commit2);

    // Changing any parameter alters the commit hash
    const commitDifferentSalt = computeCommit(accountId, roundId, mask, new Uint8Array(32).fill(8));
    assert.notDeepStrictEqual(commit, commitDifferentSalt);

    const commitDifferentMask = computeCommit(accountId, roundId, 0b00010, salt);
    assert.notDeepStrictEqual(commit, commitDifferentMask);

    const commitDifferentAccount = computeCommit("bob.near", roundId, mask, salt);
    assert.notDeepStrictEqual(commit, commitDifferentAccount);
  });

  it("successfully decrypts a valid player pick and validates against on-chain commit", () => {
    const cvmKeys = EnclaveKeys.generate();
    const accountId = "miner.near";
    const roundId = 5n;
    const mask = 0b10101; // Tiles 0, 2, 4 selected (3 tiles)
    const salt = nacl.randomBytes(32);

    // 1. Client computes on-chain commit
    const onChainCommit = computeCommit(accountId, roundId, mask, salt);

    // 2. Client encrypts pick to CVM's X25519 public key
    const ciphertext = encryptClientPick(cvmKeys.boxPublicKey, mask, salt);

    // 3. CVM decrypts and verifies
    const result = decryptAndVerifyEntry(cvmKeys, accountId, roundId, ciphertext, onChainCommit);

    assert.strictEqual(result.is_valid, true);
    assert.strictEqual(result.account_id, accountId);
    assert.strictEqual(result.mask, mask);
    assert.deepStrictEqual(result.salt, salt);
  });

  it("NEVER reveals a pick that doesn't match its on-chain commit (tampered ciphertext)", () => {
    const cvmKeys = EnclaveKeys.generate();
    const accountId = "cheater.near";
    const roundId = 5n;
    const realMask = 0b00001;
    const tamperedMask = 0b00010;
    const salt = nacl.randomBytes(32);

    // On-chain commit committed for realMask
    const onChainCommit = computeCommit(accountId, roundId, realMask, salt);

    // Client secretly encrypts tamperedMask
    const ciphertext = encryptClientPick(cvmKeys.boxPublicKey, tamperedMask, salt);

    // CVM decrypts and checks commit
    const result = decryptAndVerifyEntry(cvmKeys, accountId, roundId, ciphertext, onChainCommit);

    // SECURITY CHECK: Must NEVER reveal mismatched pick
    assert.strictEqual(result.is_valid, false);
    assert.strictEqual(result.mask, 0, "Mismatched pick mask must be sanitized to 0");
    assert.deepStrictEqual(result.salt, new Uint8Array(32), "Mismatched pick salt must be zeroed");
  });

  it("safely handles corrupted or truncated ciphertext without crashing", () => {
    const cvmKeys = EnclaveKeys.generate();
    const accountId = "broken.near";
    const roundId = 5n;
    const onChainCommit = new Uint8Array(32).fill(1);

    // Too short ciphertext
    const truncatedResult = decryptAndVerifyEntry(
      cvmKeys,
      accountId,
      roundId,
      new Uint8Array(20),
      onChainCommit
    );
    assert.strictEqual(truncatedResult.is_valid, false);
    assert.strictEqual(truncatedResult.mask, 0);

    // Garbage ciphertext with correct length
    const garbage = nacl.randomBytes(120);
    const garbageResult = decryptAndVerifyEntry(
      cvmKeys,
      accountId,
      roundId,
      garbage,
      onChainCommit
    );
    assert.strictEqual(garbageResult.is_valid, false);
    assert.strictEqual(garbageResult.mask, 0);
  });

  it("rejects picks with invalid tile mask (0 tiles or out of range)", () => {
    const cvmKeys = EnclaveKeys.generate();
    const accountId = "invalid_mask.near";
    const roundId = 5n;
    const zeroMask = 0; // 0 tiles
    const salt = nacl.randomBytes(32);

    const onChainCommit = computeCommit(accountId, roundId, zeroMask, salt);
    const ciphertext = encryptClientPick(cvmKeys.boxPublicKey, zeroMask, salt);

    const result = decryptAndVerifyEntry(cvmKeys, accountId, roundId, ciphertext, onChainCommit);
    assert.strictEqual(result.is_valid, false);
    assert.strictEqual(result.mask, 0);
  });

  it("formats decrypted reveals into NEAR smart contract RevealItem format", () => {
    const salt = new Uint8Array(32).fill(42);
    const reveal = {
      account_id: "bob.near",
      mask: 0b111,
      salt,
      is_valid: true,
    };

    const contractItems = toContractRevealItems([reveal]);
    assert.strictEqual(contractItems.length, 1);
    assert.strictEqual(contractItems[0].account, "bob.near");
    assert.strictEqual(contractItems[0].mask, 0b111);
    assert.strictEqual(contractItems[0].salt, Buffer.from(salt).toString("base64"));
  });
});
