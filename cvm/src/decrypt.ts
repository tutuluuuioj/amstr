import { sha256 } from "@noble/hashes/sha256";
import { EnclaveKeys } from "./keys.js";
import nacl from "tweetnacl";

export interface DecryptedReveal {
  account_id: string;
  mask: number;
  salt: Uint8Array; // 32 bytes
  is_valid: boolean;
}

export interface ContractRevealItem {
  account: string;
  mask: number;
  salt: string; // Base64 encoded 32 bytes
}

export function toContractRevealItems(reveals: DecryptedReveal[]): ContractRevealItem[] {
  return reveals.map((r) => ({
    account: r.account_id,
    mask: r.mask,
    salt: Buffer.from(r.salt).toString("base64"),
  }));
}

/**
 * Computes exact length-prefixed SHA-256 commit hash matching the NEAR smart contract:
 * sha256(len(account_id)_u32_le || account_id_utf8 || round_id_u64_le || mask_u32_le || salt_32_bytes)
 */
export function computeCommit(
  accountId: string,
  roundId: bigint,
  mask: number,
  salt: Uint8Array
): Uint8Array {
  if (salt.length !== 32) {
    throw new Error("Salt must be exactly 32 bytes");
  }

  const accountBytes = Buffer.from(accountId, "utf-8");
  const totalLen = 4 + accountBytes.length + 8 + 4 + 32;
  const buffer = new ArrayBuffer(totalLen);
  const view = new DataView(buffer);

  let offset = 0;

  // 1. Account ID length prefix (u32 LE)
  view.setUint32(offset, accountBytes.length, true);
  offset += 4;

  // 2. Account ID bytes
  new Uint8Array(buffer, offset, accountBytes.length).set(accountBytes);
  offset += accountBytes.length;

  // 3. Round ID (u64 LE)
  view.setBigUint64(offset, roundId, true);
  offset += 8;

  // 4. Mask (u32 LE)
  view.setUint32(offset, mask, true);
  offset += 4;

  // 5. Salt (32 bytes)
  new Uint8Array(buffer, offset, 32).set(salt);

  return sha256(new Uint8Array(buffer));
}

/**
 * Decrypts a player's encrypted pick and validates it against their on-chain commit.
 *
 * Wire Ciphertext Layout:
 * - Bytes 0..32:  Sender ephemeral X25519 public key (32 bytes)
 * - Bytes 32..56: Encryption Nonce (24 bytes)
 * - Bytes 56..:   Encrypted Box (Plaintext: mask_u32_le [4 bytes] || salt [32 bytes] + 16 bytes Poly1305 MAC)
 *
 * Security Requirement:
 * - Never reveal a pick that doesn't match its on-chain commit.
 * - If decryption fails or commit mismatch, marked `is_valid: false` for contract fee-adjusted refund.
 */
export function decryptAndVerifyEntry(
  keys: EnclaveKeys,
  accountId: string,
  roundId: bigint,
  ciphertextBytes: Uint8Array,
  onChainCommit: Uint8Array
): DecryptedReveal {
  // Minimum wire size = 32 (sender pub) + 24 (nonce) + 36 (payload) + 16 (MAC) = 108 bytes
  if (ciphertextBytes.length < 32 + 24 + 36 + 16) {
    return {
      account_id: accountId,
      mask: 0,
      salt: new Uint8Array(32),
      is_valid: false,
    };
  }

  const senderPublicKey = ciphertextBytes.slice(0, 32);
  const nonce = ciphertextBytes.slice(32, 56);
  const encryptedBox = ciphertextBytes.slice(56);

  const decrypted = keys.decryptBox(encryptedBox, nonce, senderPublicKey);
  if (!decrypted || decrypted.length < 36) {
    return {
      account_id: accountId,
      mask: 0,
      salt: new Uint8Array(32),
      is_valid: false,
    };
  }

  const view = new DataView(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength);
  const mask = view.getUint32(0, true);
  const salt = decrypted.slice(4, 36);

  // Requirement: Never reveal a pick that doesn't match its on-chain commit
  const derivedCommit = computeCommit(accountId, roundId, mask, salt);
  const commitMatches = Buffer.from(derivedCommit).equals(Buffer.from(onChainCommit));

  // Validate 25-bit mask (between 1 and 25 tiles selected)
  const activeTiles = (mask & 0x1ffffff)
    .toString(2)
    .split("")
    .filter((b) => b === "1").length;
  const isValidMask = activeTiles > 0 && activeTiles <= 25;

  if (commitMatches && isValidMask) {
    return {
      account_id: accountId,
      mask,
      salt,
      is_valid: true,
    };
  } else {
    return {
      account_id: accountId,
      mask: 0,
      salt: new Uint8Array(32),
      is_valid: false,
    };
  }
}

/**
 * Client-side helper for encrypting a pick (used in web app and tests)
 */
export function encryptClientPick(
  cvmBoxPublicKey: Uint8Array,
  mask: number,
  salt: Uint8Array
): Uint8Array {
  const clientKeyPair = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);

  const plaintext = new Uint8Array(36);
  const view = new DataView(plaintext.buffer);
  view.setUint32(0, mask, true);
  plaintext.set(salt, 4);

  const encryptedBox = nacl.box(plaintext, nonce, cvmBoxPublicKey, clientKeyPair.secretKey);

  const wire = new Uint8Array(32 + 24 + encryptedBox.length);
  wire.set(clientKeyPair.publicKey, 0);
  wire.set(nonce, 32);
  wire.set(encryptedBox, 56);

  return wire;
}
