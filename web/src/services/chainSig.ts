import { secp256k1 } from "@noble/curves/secp256k1";
import { sha3_256, keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import nacl from "tweetnacl";
import { utils } from "near-api-js";

/**
 * NEAR Testnet Root MPC Public Key for v1.signer-prod.testnet
 * Verified on-chain via view call to v1.signer-prod.testnet::public_key
 * Decodes to 64 bytes (X and Y coordinates) on secp256k1
 */
export const MPC_TESTNET_ROOT_KEY_HEX =
  "04a8bb8176747682aab5c681d4ef375ca537023b2b287d8b5f9d89505277a5a291538ef3680882d8fb793a62a5fdb4c6974c7cd8f9eb0b9cbbf659314c30347000";

/**
 * Derivation domain prefix defined by the official NEAR Chain Signatures protocol
 */
const EPSILON_DERIVATION_PREFIX = "near-mpc-recovery v0.1.0 epsilon derivation:";

export interface DerivedForeignAccounts {
  accountId: string;
  ethereum: string;
  base: string;
  arbitrum: string;
  solana: string;
}

/**
 * Computes the Additive Key Derivation (AKD) scalar tweak for a NEAR account and path
 * tweak = SHA3-256("near-mpc-recovery v0.1.0 epsilon derivation:" + accountId + "," + path)
 */
export function computeDerivationTweak(accountId: string, path: string): Uint8Array {
  const derivationString = `${EPSILON_DERIVATION_PREFIX}${accountId},${path}`;
  return sha3_256(new TextEncoder().encode(derivationString));
}

/**
 * Derives a child uncompressed secp256k1 public key (65 bytes hex starting with 04)
 * child_pk = root_pk + (tweak * G)
 */
export function deriveChildSecp256k1PublicKey(
  accountId: string,
  path: string,
  rootPubHex = MPC_TESTNET_ROOT_KEY_HEX
): string {
  const rootPoint = secp256k1.ProjectivePoint.fromHex(rootPubHex);
  const tweakBytes = computeDerivationTweak(accountId, path);
  const scalar = BigInt("0x" + Buffer.from(tweakBytes).toString("hex"));

  const tweakPoint = secp256k1.ProjectivePoint.BASE.multiply(scalar);
  const childPoint = rootPoint.add(tweakPoint);
  return Buffer.from(childPoint.toRawBytes(false)).toString("hex");
}

/**
 * Derives a deterministic EVM (0x...) address from child public key using Keccak-256
 */
export function deriveEthAddress(
  accountId: string,
  path = "ethereum-1",
  rootPubHex = MPC_TESTNET_ROOT_KEY_HEX
): string {
  const childPubHex = deriveChildSecp256k1PublicKey(accountId, path, rootPubHex);
  // Exclude leading 0x04 format byte
  const pubBytes = Buffer.from(childPubHex.slice(2), "hex");
  const hash = keccak_256(pubBytes);
  const ethAddr = Buffer.from(hash.slice(-20)).toString("hex");
  return `0x${ethAddr}`;
}

/**
 * Derives a deterministic Base address (EVM address with Base-specific derivation path)
 */
export function deriveBaseAddress(
  accountId: string,
  path = "base-1",
  rootPubHex = MPC_TESTNET_ROOT_KEY_HEX
): string {
  return deriveEthAddress(accountId, path, rootPubHex);
}

/**
 * Derives a deterministic Arbitrum address
 */
export function deriveArbitrumAddress(
  accountId: string,
  path = "arbitrum-1",
  rootPubHex = MPC_TESTNET_ROOT_KEY_HEX
): string {
  return deriveEthAddress(accountId, path, rootPubHex);
}

/**
 * Derives a deterministic Solana (Base58) address for the given account
 * Uses deterministic Ed25519 keypair derivation based on the account derivation path
 */
export function deriveSolanaAddress(accountId: string, path = "solana-1"): string {
  const seedString = `amstr-solana-derivation:${accountId},${path}`;
  const seedBytes = sha256(new TextEncoder().encode(seedString));
  const keyPair = nacl.sign.keyPair.fromSeed(seedBytes);
  return utils.serialize.base_encode(keyPair.publicKey);
}

/**
 * Returns all derived foreign addresses for a given NEAR account ID
 */
export function getDerivedForeignAccounts(accountId: string): DerivedForeignAccounts {
  return {
    accountId,
    ethereum: deriveEthAddress(accountId, "ethereum-1"),
    base: deriveBaseAddress(accountId, "base-1"),
    arbitrum: deriveArbitrumAddress(accountId, "arbitrum-1"),
    solana: deriveSolanaAddress(accountId, "solana-1"),
  };
}
