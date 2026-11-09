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

  it("computes consistent 32-byte Keccak-256 hash for outbound EVM transactions using standard RLP", () => {
    const tx = {
      to: "0x4150cd29bba624e5bc918c15eb9343aefc867b9b",
      valueWei: "1000000000000000",
      nonce: 1,
      gasLimit: 21000,
      gasPriceGwei: 1.5,
      chainId: 84532,
    };

    const { payload32Bytes, hashHex, unsignedRlpHex } = crossChainRelayer.computeTransactionHash(tx);
    assert.strictEqual(payload32Bytes.length, 32);
    assert.match(hashHex, /^0x[0-9a-fA-F]{64}$/);
    assert.ok(unsignedRlpHex.startsWith("0x"));

    // Verify raw signed RLP assembly
    const mockSig = {
      big_r: { affine_point: "04" + "a".repeat(128) },
      s: { scalar: "b".repeat(64) },
      recovery_id: 0,
    };
    const rawTxHex = crossChainRelayer.assembleSignedRawTransaction(tx, mockSig);
    assert.ok(rawTxHex.startsWith("0x"));
  });

  it("strictly enforces double-spend replay protection across deposit intents", async () => {
    const intent1 = multichainListener.registerDepositIntent({
      accountId,
      targetChain: "base",
      stakeNear: 0.1,
      roundId: 2376,
      ciphertext: "c1",
      commit: "m1",
    });

    // Mark as deployed with tx_123
    (multichainListener as any).processedTxHashes.add("tx_123");
    intent1.status = "bet_deployed";

    const intent2 = multichainListener.registerDepositIntent({
      accountId,
      targetChain: "base",
      stakeNear: 0.1,
      roundId: 2376,
      ciphertext: "c2",
      commit: "m2",
    });

    // Submitting tx_123 for intent2 must throw replay error
    await assert.rejects(
      async () => {
        await multichainListener.verifyAndProcessTx(intent2.intentId, "tx_123", async () => "relayed");
      },
      /Double-spend prevented/
    );
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

  it("builds and serializes valid Solana native transfer wire messages", () => {
    const fromAddress = "7bSJ4puJNp4L2Eo46n1Vx7LYx93jG8r3HMzKrwzjUuiQ";
    const toAddress = "5EiSMs1FBCHvGMnbM5UZJXbQ4RY5o2KPeJuC1SbNi6BC";
    const recentBlockhash = "DNLQwZxyFeo7xjJ8KjvA6qZ4uwfJdZnohyKLdKsuVZZG";
    const lamports = 10000000; // 0.01 SOL

    const { messageBytes, messageHash } = crossChainRelayer.buildSolanaTransferMessage({
      fromAddress,
      toAddress,
      lamports,
      recentBlockhash,
    });

    assert.strictEqual(messageBytes.length, 150);
    assert.strictEqual(messageHash.length, 32);

    // Verify header [1, 0, 1]
    assert.strictEqual(messageBytes[0], 1);
    assert.strictEqual(messageBytes[1], 0);
    assert.strictEqual(messageBytes[2], 1);

    // Verify accounts count
    assert.strictEqual(messageBytes[3], 3);

    // Verify instruction count & SystemProgram transfer index (2)
    const insStart = 3 + 1 + 32 * 3 + 32;
    assert.strictEqual(messageBytes[insStart], 1); // 1 instruction
    assert.strictEqual(messageBytes[insStart + 1], 2); // programIdIndex 2 (SystemProgram)
  });

  it("assembles valid 64-byte Ed25519 signed Solana wire transactions", () => {
    const fromAddress = "7bSJ4puJNp4L2Eo46n1Vx7LYx93jG8r3HMzKrwzjUuiQ";
    const toAddress = "5EiSMs1FBCHvGMnbM5UZJXbQ4RY5o2KPeJuC1SbNi6BC";
    const recentBlockhash = "DNLQwZxyFeo7xjJ8KjvA6qZ4uwfJdZnohyKLdKsuVZZG";

    const { messageBytes } = crossChainRelayer.buildSolanaTransferMessage({
      fromAddress,
      toAddress,
      lamports: 5000000,
      recentBlockhash,
    });

    const mockSig = new Uint8Array(64).fill(0x7a);
    const wireTx = crossChainRelayer.assembleSignedSolanaTransaction(messageBytes, mockSig);

    // Expected length = 1 (num_sigs) + 64 (sig) + 150 (message) = 215 bytes
    assert.strictEqual(wireTx.length, 215);
    assert.strictEqual(wireTx[0], 1);
    assert.strictEqual(wireTx[1], 0x7a);
    assert.strictEqual(wireTx[64], 0x7a);
  });

  it("executes Solana outbound payout generating valid Base58 signature and wire tx", async () => {
    const recipient = "5EiSMs1FBCHvGMnbM5UZJXbQ4RY5o2KPeJuC1SbNi6BC";
    const mockSigner = { accountId: "game.amstr-admin-zxlhcx.testnet" };

    const payout = await crossChainRelayer.executeSolanaPayout(
      mockSigner,
      recipient,
      "0.02",
      "solana-1"
    );

    assert.ok(payout.txHash);
    assert.ok(payout.rawTxBase64);
    assert.ok(payout.signatureBase58);
    assert.strictEqual(payout.txHash, payout.signatureBase58);
    // Base58 signature should be 86-90 chars
    assert.ok(payout.signatureBase58.length >= 80 && payout.signatureBase58.length <= 92);
  });
});
