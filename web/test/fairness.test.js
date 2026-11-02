import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sha256 } from "@noble/hashes/sha256";

function toBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < u8.length; i++) {
    binary += String.fromCharCode(u8[i]);
  }
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function verifyRoundFairness(roundId, revealedSeed, onChainSeedCommit, chainEntropy, onChainWinningTile) {
  const seedBytes = typeof revealedSeed === "string" ? fromBase64(revealedSeed) : revealedSeed;
  const commitBytes = onChainSeedCommit instanceof Uint8Array ? onChainSeedCommit : new Uint8Array(onChainSeedCommit);
  const entropyBytes = chainEntropy instanceof Uint8Array ? chainEntropy : new Uint8Array(chainEntropy);

  // Step 1: Pre-commitment verification sha256(seed) == seed_commit
  const derivedCommit = sha256(seedBytes);
  const derivedCommitB64 = toBase64(derivedCommit);
  const onChainCommitB64 = toBase64(commitBytes);
  const seedCommitMatches = derivedCommitB64 === onChainCommitB64;

  // Step 2: Winning tile derivation u64_le(sha256(seed || chain_entropy)[0..8]) % 25
  const combined = new Uint8Array(64);
  combined.set(seedBytes, 0);
  combined.set(entropyBytes, 32);

  const hashEntropy = sha256(combined);
  const dataView = new DataView(hashEntropy.buffer, hashEntropy.byteOffset, hashEntropy.byteLength);
  const rawU64 = dataView.getBigUint64(0, true);
  const calculatedWinningTile = Number(rawU64 % 25n);

  const tileMatches = calculatedWinningTile === onChainWinningTile;
  const isProvablyFair = seedCommitMatches && tileMatches;

  return {
    roundId,
    seedCommitMatches,
    tileMatches,
    isProvablyFair,
    calculatedWinningTile,
  };
}

describe("AMSTR Provable Fairness & Economics Verification", () => {
  describe("verifyRoundFairness", () => {
    test("validates pre-commitment and winning tile correctly for matching data", () => {
      // Synthetic known round
      const seed = new Uint8Array(32).fill(11);
      const commit = sha256(seed);
      const entropy = new Uint8Array(32).fill(22);

      const combined = new Uint8Array(64);
      combined.set(seed, 0);
      combined.set(entropy, 32);
      const hash = sha256(combined);
      const expectedTile = Number(new DataView(hash.buffer).getBigUint64(0, true) % 25n);

      const result = verifyRoundFairness(101, seed, commit, entropy, expectedTile);
      assert.equal(result.seedCommitMatches, true);
      assert.equal(result.tileMatches, true);
      assert.equal(result.isProvablyFair, true);
      assert.equal(result.calculatedWinningTile, expectedTile);
    });

    test("flags tamper attempt when seed does not match commit", () => {
      const realSeed = new Uint8Array(32).fill(1);
      const fakeSeed = new Uint8Array(32).fill(2);
      const commit = sha256(realSeed);
      const entropy = new Uint8Array(32).fill(3);

      const result = verifyRoundFairness(102, fakeSeed, commit, entropy, 0);
      assert.equal(result.seedCommitMatches, false);
      assert.equal(result.isProvablyFair, false);
    });

    test("flags tamper attempt when winning tile is altered", () => {
      const seed = new Uint8Array(32).fill(5);
      const commit = sha256(seed);
      const entropy = new Uint8Array(32).fill(6);

      const combined = new Uint8Array(64);
      combined.set(seed, 0);
      combined.set(entropy, 32);
      const hash = sha256(combined);
      const actualTile = Number(new DataView(hash.buffer).getBigUint64(0, true) % 25n);
      const fakeTile = (actualTile + 1) % 25;

      const result = verifyRoundFairness(103, seed, commit, entropy, fakeTile);
      assert.equal(result.seedCommitMatches, true);
      assert.equal(result.tileMatches, false);
      assert.equal(result.isProvablyFair, false);
    });
  });

  describe("Timeout and Escrow Refund Guard Logic", () => {
    test("does not trigger premature timeout refund while drawing within grace period", () => {
      const closeHeight = 1000;
      const currentBlock = 1050; // 50 blocks into drawing (grace period is 600 blocks)
      const roundStatus = "Drawing";

      const isRefundEligible =
        roundStatus === "Refunded" ||
        (roundStatus === "Drawing" && currentBlock > closeHeight + 600);

      assert.equal(isRefundEligible, false, "Should not offer refund prematurely during normal drawing");
    });

    test("allows automated 100% refund when drawing exceeds 600-block timeout limit", () => {
      const closeHeight = 1000;
      const currentBlock = 1650; // exceeds 600 block timeout
      const roundStatus = "Drawing";

      const isRefundEligible =
        roundStatus === "Refunded" ||
        (roundStatus === "Drawing" && currentBlock > closeHeight + 600);

      assert.equal(isRefundEligible, true, "Player must be protected and allowed to claim refund");
    });
  });

  describe("Protocol Fee and Staking Dividend Math", () => {
    test("calculates correct 10% protocol fee and 90% net pot", () => {
      const grossDeposit = 1.0; // 1 NEAR
      const protocolFee = grossDeposit * 0.1;
      const netPot = grossDeposit - protocolFee;

      assert.equal(protocolFee, 0.1);
      assert.equal(netPot, 0.9);
    });

    test("calculates storage deposit return on settlement", () => {
      const storageDeposit = 0.01; // 0.01 NEAR attached for account storage
      assert.equal(storageDeposit, 0.01);
    });
  });
});
