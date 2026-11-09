import { describe, it } from "node:test";
import assert from "node:assert";
import {
  deriveEthAddress,
  deriveBaseAddress,
  deriveArbitrumAddress,
  deriveSolanaAddress,
  getDerivedForeignAccounts,
  computeDerivationTweak,
} from "./chainsig.js";
import { multichainListener, DepositIntent } from "./multichain-listener.js";
import { crossChainRelayer } from "./crosschain-relayer.js";
import { mcpEngine } from "./mcp/engine.js";

describe("Track 1: CVM Chain Signatures & Multichain Engine", () => {
  const accountId = "player_p657e8.testnet";

  it("computes deterministic tweak for Base derivation path", () => {
    const tweak1 = computeDerivationTweak(accountId, "base-1");
    const tweak2 = computeDerivationTweak(accountId, "base-1");
    assert.strictEqual(tweak1.length, 32);
    assert.deepStrictEqual(Array.from(tweak1), Array.from(tweak2));
  });

  it("derives valid 42-char EVM address for Base and Ethereum", () => {
    const baseAddr = deriveBaseAddress(accountId, "base-1");
    const ethAddr = deriveEthAddress(accountId, "ethereum-1");
    assert.match(baseAddr, /^0x[0-9a-fA-F]{40}$/);
    assert.match(ethAddr, /^0x[0-9a-fA-F]{40}$/);
    assert.notStrictEqual(baseAddr, ethAddr);
  });

  it("derives valid Base58 Solana address", () => {
    const solAddr = deriveSolanaAddress(accountId, "solana-1");
    assert.strictEqual(typeof solAddr, "string");
    assert.strictEqual(solAddr.length >= 32 && solAddr.length <= 44, true);
    assert.match(solAddr, /^[1-9A-HJ-NP-Za-km-z]+$/);
  });

  it("registers and manages cross-chain deposit intents in MultichainListener", () => {
    const intent = multichainListener.registerDepositIntent({
      accountId,
      targetChain: "base",
      stakeNear: 0.2,
      roundId: 2376,
      ciphertext: "test_ciphertext",
      commit: "test_commit",
      expectedAmount: "0.001",
    });

    assert.ok(intent.intentId.startsWith("intent_"));
    assert.strictEqual(intent.accountId, accountId);
    assert.strictEqual(intent.targetChain, "base");
    assert.strictEqual(intent.status, "pending_deposit");
    assert.match(intent.derivedAddress, /^0x[0-9a-fA-F]{40}$/);

    const retrieved = multichainListener.getIntent(intent.intentId);
    assert.deepStrictEqual(retrieved, intent);
  });

  it("computes consistent 32-byte Keccak-256 hash for outbound EVM transactions", () => {
    const tx = {
      to: "0x4150cd29bba624e5bc918c15eb9343aefc867b9b",
      valueWei: "1000000000000000",
      nonce: 1,
      gasLimit: 21000,
      chainId: 84532,
    };

    const { payload32Bytes, hashHex } = crossChainRelayer.computeTransactionHash(tx);
    assert.strictEqual(payload32Bytes.length, 32);
    assert.match(hashHex, /^0x[0-9a-fA-F]{64}$/);
  });

  it("MCP engine exposes cross-chain deposit address tool for AI agents", async () => {
    const result = await mcpEngine.getCrossChainDepositAddress(null, accountId, "base");
    assert.strictEqual(result.account_id, accountId);
    assert.strictEqual(result.requested_chain, "base");
    assert.match(result.deposit_address, /^0x[0-9a-fA-F]{40}$/);
    assert.ok(result.all_derived_addresses.solana);
  });

  it("MCP engine verifies cross-chain deposit intent query", async () => {
    const intent = multichainListener.registerDepositIntent({
      accountId,
      targetChain: "base",
      stakeNear: 0.1,
      roundId: 2376,
      ciphertext: "cipher",
      commit: "commit",
    });

    const status = await mcpEngine.checkCrossChainDeposit(intent.intentId);
    assert.strictEqual(status.found, true);
    assert.strictEqual((status as any).intent.intentId, intent.intentId);
  });
});
