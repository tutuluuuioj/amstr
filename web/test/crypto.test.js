import { test, describe } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import util from "tweetnacl-util";
import { sha256 } from "@noble/hashes/sha256";

// Re-implement / import core functions to verify contract & client specification
function computeCommit(accountId, roundId, mask, salt) {
  if (!salt || salt.length !== 32) {
    throw new Error(`Salt must be exactly 32 bytes, got ${salt ? salt.length : 0}`);
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

function verifyCvmKeyMatch(contractX25519Bytes, cvmX25519Base64) {
  try {
    const contractBytes = new Uint8Array(contractX25519Bytes);
    const cvmBytes = util.decodeBase64(cvmX25519Base64);

    if (contractBytes.length !== 32 || cvmBytes.length !== 32) {
      return {
        isValid: false,
        error: `Invalid key length: contract=${contractBytes.length}B, CVM=${cvmBytes.length}B (expected 32B)`,
      };
    }

    for (let i = 0; i < 32; i++) {
      if (contractBytes[i] !== cvmBytes[i]) {
        return {
          isValid: false,
          error: "Security Violation: Live Phala CVM public key does not match smart contract registry!",
        };
      }
    }

    return { isValid: true };
  } catch (err) {
    return {
      isValid: false,
      error: `Failed to verify CVM key: ${err.message || String(err)}`,
    };
  }
}

describe("AMSTR Cryptographic Client Verification", () => {
  describe("computeCommit", () => {
    test("computes deterministic 32-byte SHA-256 commitment", () => {
      const salt = new Uint8Array(32).fill(7);
      const commit1 = computeCommit("alice.testnet", 100, 1 << 6, salt);
      const commit2 = computeCommit("alice.testnet", 100, 1 << 6, salt);

      assert.equal(commit1.length, 32);
      assert.deepEqual(commit1, commit2);
    });

    test("produces different commitments for different masks", () => {
      const salt = new Uint8Array(32).fill(42);
      const commitTile5 = computeCommit("alice.testnet", 100, 1 << 5, salt);
      const commitTile6 = computeCommit("alice.testnet", 100, 1 << 6, salt);

      assert.notDeepEqual(commitTile5, commitTile6);
    });

    test("throws error if salt is not exactly 32 bytes", () => {
      const shortSalt = new Uint8Array(16);
      assert.throws(() => {
        computeCommit("alice.testnet", 100, 1 << 5, shortSalt);
      }, /Salt must be exactly 32 bytes/);
    });
  });

  describe("verifyCvmKeyMatch", () => {
    test("accepts matching 32-byte public keys", () => {
      const keypair = nacl.box.keyPair();
      const b64 = util.encodeBase64(keypair.publicKey);
      const result = verifyCvmKeyMatch(Array.from(keypair.publicKey), b64);

      assert.equal(result.isValid, true);
      assert.equal(result.error, undefined);
    });

    test("rejects mismatched public keys", () => {
      const keypairA = nacl.box.keyPair();
      const keypairB = nacl.box.keyPair();
      const b64B = util.encodeBase64(keypairB.publicKey);
      const result = verifyCvmKeyMatch(Array.from(keypairA.publicKey), b64B);

      assert.equal(result.isValid, false);
      assert.match(result.error, /does not match smart contract registry/);
    });

    test("rejects malformed key lengths", () => {
      const result = verifyCvmKeyMatch([1, 2, 3], util.encodeBase64(new Uint8Array(32)));
      assert.equal(result.isValid, false);
      assert.match(result.error, /Invalid key length/);
    });
  });

  describe("End-to-End Client Encryption & TEE Box Decryption", () => {
    test("TEE enclave can successfully decrypt encrypted user pick", () => {
      // 1. TEE Enclave X25519 keypair
      const enclaveKeys = nacl.box.keyPair();

      // 2. Client side: generate ephemeral keypair & random nonce
      const clientEphemeral = nacl.box.keyPair();
      const nonce = nacl.randomBytes(24);
      const salt = nacl.randomBytes(32);

      const secretPayload = JSON.stringify({
        roundId: 105,
        accountId: "player.testnet",
        mask: 1 << 12,
        saltHex: Array.from(salt).map(b => b.toString(16).padStart(2, "0")).join(""),
      });

      const messageBytes = util.decodeUTF8(secretPayload);
      const ciphertext = nacl.box(
        messageBytes,
        nonce,
        enclaveKeys.publicKey,
        clientEphemeral.secretKey
      );

      // 3. TEE side: decrypt using enclave secret key and client's ephemeral public key
      const decryptedBytes = nacl.box.open(
        ciphertext,
        nonce,
        clientEphemeral.publicKey,
        enclaveKeys.secretKey
      );

      assert.ok(decryptedBytes, "Decryption succeeded in TEE enclave");
      const decryptedJson = JSON.parse(util.encodeUTF8(decryptedBytes));
      assert.equal(decryptedJson.roundId, 105);
      assert.equal(decryptedJson.accountId, "player.testnet");
      assert.equal(decryptedJson.mask, 1 << 12);
    });
  });
});
