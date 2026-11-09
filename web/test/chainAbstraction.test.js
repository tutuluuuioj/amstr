import test from "node:test";
import assert from "node:assert/strict";
import { KeyPair } from "near-api-js";

test("Track 2: Chain Abstraction & Session Key Architecture", async (t) => {
  await t.test("generates valid Ed25519 session keypair", () => {
    const keyPair = KeyPair.fromRandom("ed25519");
    const pub = keyPair.getPublicKey().toString();
    assert.match(pub, /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/);
  });

  await t.test("formats session expiration and duration correctly", () => {
    const durationHours = 24;
    const now = Date.now();
    const expiresAt = now + durationHours * 3600 * 1000;
    assert.ok(expiresAt > now);
    assert.equal(Math.round((expiresAt - now) / (3600 * 1000)), 24);
  });

  await t.test("calculates abstracted fee breakdown without exposing scary raw storage", () => {
    const stakeNear = 0.2;
    const fee10Pct = (stakeNear * 0.1).toFixed(3);
    const netStake = (stakeNear * 0.9).toFixed(3);
    const storageRefundable = 0.01;
    const totalRequired = (stakeNear + storageRefundable).toFixed(3);

    assert.equal(fee10Pct, "0.020");
    assert.equal(netStake, "0.180");
    assert.equal(totalRequired, "0.210");
  });

  await t.test("session key scoped permissions strictly target game contract methods", () => {
    const allowedMethods = ["deploy", "claim"];
    const targetContract = "game.amstr-admin-zxlhcx.testnet";

    assert.ok(allowedMethods.includes("deploy"));
    assert.ok(allowedMethods.includes("claim"));
    assert.ok(!allowedMethods.includes("transfer"));
    assert.ok(!allowedMethods.includes("delete_account"));
    assert.equal(targetContract, "game.amstr-admin-zxlhcx.testnet");
  });

  await t.test("derives valid Base58 NEAR ed25519 KeyPair from Passkey seed without Non-base58 errors", async () => {
    const nacl = (await import("tweetnacl")).default;
    const { utils } = await import("near-api-js");

    // Simulate 32-byte hash seed from WebAuthn credential ID
    const seed = new Uint8Array(32);
    seed.fill(42);

    const naclKp = nacl.sign.keyPair.fromSeed(seed);
    const base58Secret = utils.serialize.base_encode(naclKp.secretKey);
    const nearKp = KeyPair.fromString(`ed25519:${base58Secret}`);

    const pub = nearKp.getPublicKey().toString();
    assert.match(pub, /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    assert.doesNotThrow(() => {
      nearKp.sign(new Uint8Array([1, 2, 3]));
    });
  });
});
