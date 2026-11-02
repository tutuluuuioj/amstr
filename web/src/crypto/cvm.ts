import nacl from "tweetnacl";
import util from "tweetnacl-util";
import { sha256 } from "@noble/hashes/sha256";

export interface EncryptedPickResult {
  ciphertext: Uint8Array;
  commit: Uint8Array;
  salt: Uint8Array;
  ephemeralPubKey: Uint8Array;
}

export interface StoredPickData {
  roundId: number;
  accountId: string;
  mask: number;
  saltHex: string;
  commitHex: string;
  savedAt: number;
}

/**
 * Requirement 1: Check the CVM key before encrypting.
 * Compares the contract's registered X25519 key against the live CVM /keys endpoint.
 * Refuses encryption if they do not match bit-for-bit.
 */
export function verifyCvmKeyMatch(
  contractX25519Bytes: number[] | Uint8Array,
  cvmX25519Base64: string
): { isValid: boolean; error?: string } {
  try {
    const contractBytes = new Uint8Array(contractX25519Bytes);
    const cvmBytes = util.decodeBase64(cvmX25519Base64);

    if (contractBytes.length !== 32 || cvmBytes.length !== 32) {
      return {
        isValid: false,
        error: `Invalid key length: contract=${contractBytes.length}B, CVM=${cvmBytes.length}B (expected 32B)`,
      };
    }

    let mismatch = false;
    for (let i = 0; i < 32; i++) {
      if (contractBytes[i] !== cvmBytes[i]) {
        mismatch = true;
        break;
      }
    }

    if (mismatch) {
      return {
        isValid: false,
        error: "Security Violation: Live Phala CVM public key does not match smart contract registry!",
      };
    }

    return { isValid: true };
  } catch (err: any) {
    return {
      isValid: false,
      error: `Failed to verify CVM key: ${err.message || String(err)}`,
    };
  }
}

/**
 * Standardized commitment calculation matching NEAR Rust contract:
 * sha256(u32_le(len(account_id)) || account_id || u64_le(round_id) || u32_le(mask) || salt)
 */
export function computeCommit(
  accountId: string,
  roundId: bigint | number,
  mask: number,
  salt: Uint8Array
): Uint8Array {
  if (salt.length !== 32) {
    throw new Error(`Salt must be exactly 32 bytes, got ${salt.length}`);
  }

  const accountBytes = new TextEncoder().encode(accountId);
  const accountLenBytes = new Uint8Array(4);
  new DataView(accountLenBytes.buffer).setUint32(0, accountBytes.length, true);

  const roundBytes = new Uint8Array(8);
  new DataView(roundBytes.buffer).setBigUint64(0, BigInt(roundId), true);

  const maskBytes = new Uint8Array(4);
  new DataView(maskBytes.buffer).setUint32(0, mask, true);

  const totalLen = 4 + accountBytes.length + 8 + 4 + 32;
  const buffer = new Uint8Array(totalLen);
  let offset = 0;

  buffer.set(accountLenBytes, offset);
  offset += 4;
  buffer.set(accountBytes, offset);
  offset += accountBytes.length;
  buffer.set(roundBytes, offset);
  offset += 8;
  buffer.set(maskBytes, offset);
  offset += 4;
  buffer.set(salt, offset);

  return sha256(buffer);
}

/**
 * Requirement 1 & 8: Encrypt pick using ephemeral TweetNaCl box.
 * "Picks are encrypted in your browser and only the TEE can decrypt them."
 * Payload format: ephemeralPub (32B) || nonce (24B) || box (52B) = 108 bytes
 */
export function encryptClientPick(
  cvmX25519Pub: Uint8Array,
  mask: number,
  salt?: Uint8Array
): {
  ciphertext: Uint8Array;
  salt: Uint8Array;
  ephemeralPublicKey: Uint8Array;
} {
  const actualSalt = salt || nacl.randomBytes(32);

  // 36-byte plaintext: mask (4B little-endian) || salt (32B)
  const plaintext = new Uint8Array(36);
  new DataView(plaintext.buffer).setUint32(0, mask, true);
  plaintext.set(actualSalt, 4);

  // Generate ephemeral sender keypair
  const ephemeralKeypair = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);

  // Box encryption to enclave X25519 key
  const boxed = nacl.box(plaintext, nonce, cvmX25519Pub, ephemeralKeypair.secretKey);

  // Pack into canonical 108-byte wire format
  const payload = new Uint8Array(32 + 24 + boxed.length);
  payload.set(ephemeralKeypair.publicKey, 0);
  payload.set(nonce, 32);
  payload.set(boxed, 56);

  return {
    ciphertext: payload,
    salt: actualSalt,
    ephemeralPublicKey: ephemeralKeypair.publicKey,
  };
}

/**
 * Requirement 1: Keep the salt in the browser (localStorage) until the round settles.
 */
const SALT_STORAGE_PREFIX = "amstr_pick_salt_";

export function savePickSalt(
  roundId: number,
  accountId: string,
  salt: Uint8Array,
  mask: number,
  commit: Uint8Array
): void {
  try {
    const key = `${SALT_STORAGE_PREFIX}${accountId}_${roundId}`;
    const data: StoredPickData = {
      roundId,
      accountId,
      mask,
      saltHex: Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join(""),
      commitHex: Array.from(commit).map((b) => b.toString(16).padStart(2, "0")).join(""),
      savedAt: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.warn("Could not save pick salt to localStorage:", err);
  }
}

export function getPickSalt(roundId: number, accountId: string): StoredPickData | null {
  try {
    const key = `${SALT_STORAGE_PREFIX}${accountId}_${roundId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearPickSalt(roundId: number, accountId: string): void {
  try {
    const key = `${SALT_STORAGE_PREFIX}${accountId}_${roundId}`;
    localStorage.removeItem(key);
  } catch (err) {
    console.warn("Could not remove pick salt from localStorage:", err);
  }
}
