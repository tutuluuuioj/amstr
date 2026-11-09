import test from "node:test";
import assert from "node:assert/strict";
import elliptic from "elliptic";
import { sha3_256, keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import nacl from "tweetnacl";
import { utils } from "near-api-js";

const { ec: EC } = elliptic;
const ec = new EC("secp256k1");

const MPC_TESTNET_ROOT_KEY_HEX =
  "04a8bb8176747682aab5c681d4ef375ca537023b2b287d8b5f9d89505277a5a291538ef3680882d8fb793a62a5fdb4c6974c7cd8f9eb0b9cbbf659314c30347000";
const EPSILON_DERIVATION_PREFIX = "near-mpc-recovery v0.1.0 epsilon derivation:";

function computeDerivationTweak(accountId, path) {
  const derivationString = `${EPSILON_DERIVATION_PREFIX}${accountId},${path}`;
  return sha3_256(new TextEncoder().encode(derivationString));
}

function deriveChildSecp256k1PublicKey(accountId, path, rootPubHex = MPC_TESTNET_ROOT_KEY_HEX) {
  const rootPoint = ec.keyFromPublic(rootPubHex, "hex").getPublic();
  const tweak = computeDerivationTweak(accountId, path);
  const scalar = ec.keyFromPrivate(tweak).getPrivate();
  const childPoint = rootPoint.add(ec.g.mul(scalar));
  return childPoint.encode("hex", false);
}

function deriveEthAddress(accountId, path = "ethereum-1", rootPubHex = MPC_TESTNET_ROOT_KEY_HEX) {
  const childPubHex = deriveChildSecp256k1PublicKey(accountId, path, rootPubHex);
  const pubBytes = Buffer.from(childPubHex.slice(2), "hex");
  const hash = keccak_256(pubBytes);
  const ethAddr = Buffer.from(hash.slice(-20)).toString("hex");
  return `0x${ethAddr}`;
}

function deriveSolanaAddress(accountId, path = "solana-1") {
  const seedString = `amstr-solana-derivation:${accountId},${path}`;
  const seedBytes = sha256(new TextEncoder().encode(seedString));
  const keyPair = nacl.sign.keyPair.fromSeed(seedBytes);
  return utils.serialize.base_encode(keyPair.publicKey);
}

test("Track 1: NEAR Chain Signatures & Multichain Address Derivation", async (t) => {
  const testAccount = "player_p657e8.testnet";

  await t.test("computes deterministic scalar tweak", () => {
    const tweak1 = computeDerivationTweak(testAccount, "base-1");
    const tweak2 = computeDerivationTweak(testAccount, "base-1");
    assert.equal(tweak1.length, 32);
    assert.deepEqual(Array.from(tweak1), Array.from(tweak2));
  });

  await t.test("produces different tweaks for different derivation paths", () => {
    const tweakBase = computeDerivationTweak(testAccount, "base-1");
    const tweakEth = computeDerivationTweak(testAccount, "ethereum-1");
    assert.notDeepEqual(Array.from(tweakBase), Array.from(tweakEth));
  });

  await t.test("derives valid 65-byte uncompressed secp256k1 public key", () => {
    const childPub = deriveChildSecp256k1PublicKey(testAccount, "base-1");
    assert.equal(typeof childPub, "string");
    assert.equal(childPub.length, 130);
    assert.ok(childPub.startsWith("04"));
  });

  await t.test("derives valid checksummed or lowercased EVM addresses (0x...)", () => {
    const ethAddr = deriveEthAddress(testAccount, "ethereum-1");
    const baseAddr = deriveEthAddress(testAccount, "base-1");
    const arbAddr = deriveEthAddress(testAccount, "arbitrum-1");

    const evmRegex = /^0x[0-9a-fA-F]{40}$/;
    assert.match(ethAddr, evmRegex);
    assert.match(baseAddr, evmRegex);
    assert.match(arbAddr, evmRegex);

    assert.notEqual(ethAddr, baseAddr);
    assert.notEqual(baseAddr, arbAddr);
  });

  await t.test("derives valid Base58 Solana address (32-44 chars)", () => {
    const solAddr = deriveSolanaAddress(testAccount, "solana-1");
    assert.equal(typeof solAddr, "string");
    assert.ok(solAddr.length >= 32 && solAddr.length <= 44);
    assert.match(solAddr, /^[1-9A-HJ-NP-Za-km-z]+$/);
  });

  await t.test("guarantees idempotence across multiple calls for same account", () => {
    const addr1 = deriveEthAddress(testAccount, "base-1");
    const addr2 = deriveEthAddress(testAccount, "base-1");
    assert.equal(addr1, addr2);
  });
});
