import { describe, it } from "node:test";
import assert from "node:assert";
import { EnclaveKeys } from "./keys.js";
import nacl from "tweetnacl";

describe("Phase 2 Requirement 1: EnclaveKeys Secrecy and Ephemeral Generation", () => {
  it("generates distinct in-memory ephemeral keypairs on each boot", () => {
    const keys1 = EnclaveKeys.generate();
    const keys2 = EnclaveKeys.generate();

    assert.notDeepStrictEqual(keys1.signPublicKey, keys2.signPublicKey);
    assert.notDeepStrictEqual(keys1.boxPublicKey, keys2.boxPublicKey);
    assert.notStrictEqual(keys1.nearPublicKey, keys2.nearPublicKey);
    assert.notStrictEqual(keys1.x25519PublicKeyBase64, keys2.x25519PublicKeyBase64);
  });

  it("formats NEAR ed25519 public key correctly", () => {
    const keys = EnclaveKeys.generate();
    assert.match(keys.nearPublicKey, /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    assert.strictEqual(keys.signPublicKey.length, 32);
    assert.strictEqual(keys.boxPublicKey.length, 32);
  });

  it("produces valid 64-byte Ed25519 signatures verifiable by its public key", () => {
    const keys = EnclaveKeys.generate();
    const message = Buffer.from("NEAR AMSTR Round Settle Check", "utf-8");
    const sig = keys.sign(message);

    assert.strictEqual(sig.length, 64);
    const verified = nacl.sign.detached.verify(message, sig, keys.signPublicKey);
    assert.strictEqual(verified, true);
  });

  it("signs round settlement message with exact (round_id_le || seed) layout", () => {
    const keys = EnclaveKeys.generate();
    const roundId = 42n;
    const seed = nacl.randomBytes(32);

    const sig = keys.signSettle(roundId, seed);
    assert.strictEqual(sig.length, 64);

    // Reconstruct expected message
    const expectedMsg = new Uint8Array(8 + 32);
    const view = new DataView(expectedMsg.buffer);
    view.setBigUint64(0, roundId, true);
    expectedMsg.set(seed, 8);

    const verified = nacl.sign.detached.verify(expectedMsg, sig, keys.signPublicKey);
    assert.strictEqual(verified, true);
  });

  it("rejects signing settlement with invalid seed length", () => {
    const keys = EnclaveKeys.generate();
    assert.throws(() => {
      keys.signSettle(1n, new Uint8Array(16));
    }, /Seed must be exactly 32 bytes/);
  });

  it("redacts private keys completely from JSON serialization and console logs", () => {
    const keys = EnclaveKeys.generate();
    const jsonStr = JSON.stringify(keys);

    assert.ok(jsonStr.includes(`"signSecretKey":"[REDACTED_IN_TEE]"`));
    assert.ok(jsonStr.includes(`"boxSecretKey":"[REDACTED_IN_TEE]"`));
    assert.strictEqual(jsonStr.includes(keys.nearPublicKey), true);

    const strRepr = keys.toString();
    assert.strictEqual(strRepr.includes("secret"), false);
  });

  it("performs box decryption with valid sender key and nonce", () => {
    const cvmKeys = EnclaveKeys.generate();
    const clientKp = nacl.box.keyPair();
    const nonce = nacl.randomBytes(24);
    const message = Buffer.from("Secret Player Pick 0x1F", "utf-8");

    const encrypted = nacl.box(message, nonce, cvmKeys.boxPublicKey, clientKp.secretKey);
    const decrypted = cvmKeys.decryptBox(encrypted, nonce, clientKp.publicKey);

    assert.ok(decrypted);
    assert.strictEqual(Buffer.from(decrypted).toString("utf-8"), "Secret Player Pick 0x1F");
  });

  it("fails box decryption with corrupted ciphertext or wrong sender key", () => {
    const cvmKeys = EnclaveKeys.generate();
    const clientKp = nacl.box.keyPair();
    const wrongKp = nacl.box.keyPair();
    const nonce = nacl.randomBytes(24);
    const message = Buffer.from("Secret Player Pick 0x1F", "utf-8");

    const encrypted = nacl.box(message, nonce, cvmKeys.boxPublicKey, clientKp.secretKey);
    // Decrypt with wrong sender public key
    const decryptedWrong = cvmKeys.decryptBox(encrypted, nonce, wrongKp.publicKey);
    assert.strictEqual(decryptedWrong, null);

    // Decrypt with corrupted ciphertext
    encrypted[0] ^= 0xff;
    const decryptedCorrupt = cvmKeys.decryptBox(encrypted, nonce, clientKp.publicKey);
    assert.strictEqual(decryptedCorrupt, null);
  });
});
