import { sha256 } from "@noble/hashes/sha256";

export interface FairnessVerificationResult {
  roundId: number;
  revealedSeedBase64: string;
  revealedSeedHex: string;
  derivedCommitBase64: string;
  derivedCommitHex: string;
  onChainCommitBase64: string;
  onChainCommitHex: string;
  seedCommitMatches: boolean;
  chainEntropyHex: string;
  combinedEntropyHex: string;
  hashEntropyHex: string;
  rawU64: string;
  calculatedWinningTile: number;
  onChainWinningTile: number;
  tileMatches: boolean;
  isProvablyFair: boolean;
  explanation: string[];
}

export function toHex(bytes: Uint8Array | number[]): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(u8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function toBase64(bytes: Uint8Array | number[]): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < u8.length; i++) {
    binary += String.fromCharCode(u8[i]);
  }
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Requirement 3: A Fairness button on every settled round.
 * Cryptographically verifies seed pre-commitment integrity and winning tile formula.
 */
export function verifyRoundFairness(
  roundId: number,
  revealedSeed: Uint8Array | string,
  onChainSeedCommit: number[] | Uint8Array,
  chainEntropy: number[] | Uint8Array,
  onChainWinningTile: number
): FairnessVerificationResult {
  const seedClean = typeof revealedSeed === "string" ? revealedSeed.replace(/\s+/g, "") : revealedSeed;
  const seedBytes = typeof seedClean === "string" ? fromBase64(seedClean) : seedClean;
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

  const explanation = [
    `1. Seed Pre-Commitment Check: SHA-256(revealed_seed) = ${derivedCommitB64}`,
    `   Matches contract seed_commit: ${seedCommitMatches ? "YES (Verified)" : "NO (Failed)"}`,
    `2. Combined Entropy: Seed (32B) + On-chain Block Hash (32B) = 64 bytes`,
    `3. Winning Tile: u64_le(SHA-256(seed || entropy)[0..8]) % 25`,
    `   ${rawU64.toString()} % 25 = ${calculatedWinningTile}`,
    `   Matches contract winning_tile (${onChainWinningTile}): ${tileMatches ? "YES (Verified)" : "NO (Failed)"}`,
  ];

  return {
    roundId,
    revealedSeedBase64: toBase64(seedBytes),
    revealedSeedHex: toHex(seedBytes),
    derivedCommitBase64: derivedCommitB64,
    derivedCommitHex: toHex(derivedCommit),
    onChainCommitBase64: onChainCommitB64,
    onChainCommitHex: toHex(commitBytes),
    seedCommitMatches,
    chainEntropyHex: toHex(entropyBytes),
    combinedEntropyHex: toHex(combined),
    hashEntropyHex: toHex(hashEntropy),
    rawU64: rawU64.toString(),
    calculatedWinningTile,
    onChainWinningTile,
    tileMatches,
    isProvablyFair,
    explanation,
  };
}
