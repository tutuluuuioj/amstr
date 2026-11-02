import { describe, it } from "node:test";
import assert from "node:assert";
import nacl from "tweetnacl";
import { EnclaveKeys } from "./keys.js";
import { computeCommit, decryptAndVerifyEntry, encryptClientPick, toContractRevealItems } from "./decrypt.js";

describe("E2E Client Pick Encryption -> CVM Decryption -> Contract Verification", () => {
  it("verifies client pick matches CVM decryption and contract commit verification", () => {
    const cvmKeys = EnclaveKeys.generate();
    const accountId = "alice.amstr-admin-zxlhcx.testnet";
    const roundId = 2n;
    const tileMask = 0b00011111; // 5 tiles: 0, 1, 2, 3, 4
    const salt = nacl.randomBytes(32);

    // 1. Client computes on-chain commit hash
    const clientCommit = computeCommit(accountId, roundId, tileMask, salt);
    assert.strictEqual(clientCommit.length, 32);

    // 2. Client encrypts pick with CVM's X25519 public key
    const ciphertext = encryptClientPick(cvmKeys.boxPublicKey, tileMask, salt);

    // Wire layout check: 32B sender pubkey + 24B nonce + 36B payload + 16B Poly1305 tag = 108 bytes
    assert.strictEqual(ciphertext.length, 108);

    // 3. CVM decrypts pick and validates against on-chain commit
    const reveal = decryptAndVerifyEntry(cvmKeys, accountId, roundId, ciphertext, clientCommit);

    assert.strictEqual(reveal.is_valid, true, "Pick must be valid");
    assert.strictEqual(reveal.account_id, accountId);
    assert.strictEqual(reveal.mask, tileMask);
    assert.deepStrictEqual(reveal.salt, salt);

    // 4. Format into smart contract RevealItem
    const contractItems = toContractRevealItems([reveal]);
    assert.strictEqual(contractItems.length, 1);
    assert.strictEqual(contractItems[0].account, accountId);
    assert.strictEqual(contractItems[0].mask, tileMask);
    assert.strictEqual(contractItems[0].salt, Buffer.from(salt).toString("base64"));
  });

  it("sanitizes tampered picks when client ciphertext does not match on-chain commit", () => {
    const cvmKeys = EnclaveKeys.generate();
    const accountId = "cheater.testnet";
    const roundId = 2n;
    const realMask = 0b00001; // Tile 0
    const tamperedMask = 0b00010; // Tile 1
    const salt = nacl.randomBytes(32);

    // On-chain commit registered for realMask
    const onChainCommit = computeCommit(accountId, roundId, realMask, salt);

    // Player secretly sends ciphertext containing tamperedMask
    const tamperedCiphertext = encryptClientPick(cvmKeys.boxPublicKey, tamperedMask, salt);

    const reveal = decryptAndVerifyEntry(cvmKeys, accountId, roundId, tamperedCiphertext, onChainCommit);

    assert.strictEqual(reveal.is_valid, false, "Tampered pick must be marked invalid");
    assert.strictEqual(reveal.mask, 0, "Tampered mask must be zeroed");
  });
});
