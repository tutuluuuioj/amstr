#!/usr/bin/env node
import crypto from "crypto";

const RPC_URLS = [
  process.env.NEAR_RPC_URL,
  "https://rpc.testnet.fastnear.com",
  "https://near-testnet.api.pagoda.co/rpc/v1",
  "https://rpc.testnet.near.org",
].filter(Boolean);

const CONTRACT_ID = process.env.CONTRACT_ID || "game.amstr-admin-zxlhcx.testnet";

// Known settlement transactions on NEAR Testnet for automated discovery
const KNOWN_SETTLE_TXS = {
  1: "AjthLw4ZksVZPAhhyR6hRcAX1NyJo562Fuo3KKTnvhFQ",
  2: "4A6U78MustvVJe2fac142ovFSjyXNqu6aCYUytG2crSH",
};

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest();
}

async function rpcFetch(method, params) {
  for (const url of RPC_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "verify-fairness",
          method,
          params,
        }),
      });
      const data = await res.json();
      if (data.result) return data.result;
    } catch (_) {}
  }
  throw new Error(`Failed RPC call ${method} across all RPC endpoints`);
}

async function getRoundView(roundId) {
  const result = await rpcFetch("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: CONTRACT_ID,
    method_name: "get_round",
    args_base64: Buffer.from(JSON.stringify({ round_id: Number(roundId) })).toString("base64"),
  });
  return JSON.parse(Buffer.from(result.result).toString("utf8"));
}

async function getSettledEventFromTx(txHash) {
  const txData = await rpcFetch("tx", [txHash, "amstr-admin-zxlhcx.testnet"]);
  const logs = [];
  if (txData.receipts_outcome) {
    for (const ro of txData.receipts_outcome) {
      if (ro.outcome && ro.outcome.logs) {
        logs.push(...ro.outcome.logs);
      }
    }
  }

  for (const log of logs) {
    if (log.startsWith("EVENT_JSON:")) {
      try {
        const parsed = JSON.parse(log.slice("EVENT_JSON:".length));
        if (parsed.event === "round_settled" && parsed.data && parsed.data[0]) {
          return parsed.data[0];
        }
      } catch (_) {}
    }
  }
  return null;
}

async function main() {
  const roundArg = process.argv[2] || "2";
  const explicitSeed = process.argv[3] || null;

  const roundId = parseInt(roundArg, 10);
  if (isNaN(roundId)) {
    console.error("Usage: node scripts/verify-fairness.mjs <round_id> [optional_seed]");
    process.exit(1);
  }

  console.log("==================================================");
  console.log(`   AMSTR Provable Fairness Verification: Round ${roundId}`);
  console.log("==================================================");

  // 1. Fetch on-chain round status
  console.log(`[1/3] Fetching on-chain state for Round ${roundId} from ${CONTRACT_ID}...`);
  const round = await getRoundView(roundId);
  if (!round) {
    console.error(`Round ${roundId} not found on contract.`);
    process.exit(1);
  }

  console.log(`  Round Status   : ${round.status}`);
  console.log(`  Winning Tile   : ${round.winning_tile}`);
  console.log(`  Total Net Stake: ${round.total_net} yoctoNEAR`);
  console.log(`  Close Height   : ${round.close_height}`);
  console.log(`  Settle Height  : ${round.settle_height}`);

  if (round.status !== "Settled") {
    console.log(`\nRound ${roundId} is not settled (status: ${round.status}). Cannot verify settlement.`);
    process.exit(1);
  }

  // 2. Discover revealed seed and chain_entropy from round_settled event
  console.log(`\n[2/3] Retrieving revealed seed and entropy from on-chain 'round_settled' event...`);
  let seedB64 = explicitSeed;
  let chainEntropyB64 = null;
  let eventWinningTile = null;

  if (!seedB64) {
    const knownTx = KNOWN_SETTLE_TXS[roundId];
    if (knownTx) {
      console.log(`  Found settle transaction: ${knownTx}`);
      const eventData = await getSettledEventFromTx(knownTx);
      if (eventData) {
        seedB64 = eventData.seed;
        chainEntropyB64 = eventData.chain_entropy;
        eventWinningTile = eventData.winning_tile;
        console.log(`  Extracted from event:`);
        console.log(`    - Revealed Seed : ${seedB64}`);
        console.log(`    - Chain Entropy : ${chainEntropyB64}`);
        console.log(`    - Winning Tile  : ${eventWinningTile}`);
      }
    }
  }

  if (!seedB64) {
    console.error(`\nCould not automatically locate 'round_settled' event for round ${roundId}.`);
    console.error(`Please provide the revealed seed: node scripts/verify-fairness.mjs ${roundId} <seed_base64>`);
    process.exit(1);
  }

  // 3. Cryptographic Verification
  console.log(`\n[3/3] Executing Cryptographic Provable Fairness Proof...`);

  const onChainCommitB64 = Buffer.from(round.seed_commit).toString("base64");
  const onChainEntropyBytes = Buffer.from(round.chain_entropy);
  const seedBytes = Buffer.from(seedB64, "base64");

  // Step A: Verify Pre-commitment Integrity: sha256(revealed_seed) == seed_commit
  const derivedCommit = sha256(seedBytes);
  const derivedCommitB64 = derivedCommit.toString("base64");

  console.log("  A) Seed Pre-Commitment Check:");
  console.log(`     Revealed Seed       : ${seedB64}`);
  console.log(`     SHA-256(Seed)       : ${derivedCommitB64}`);
  console.log(`     On-Chain Seed Commit: ${onChainCommitB64}`);

  const commitMatches = derivedCommitB64 === onChainCommitB64;
  console.log(`     -> Result           : ${commitMatches ? "✅ VALID (Enclave revealed its pre-committed seed)" : "❌ MISMATCH"}`);

  if (!commitMatches) {
    console.error("FATAL: Revealed seed does not match on-chain pre-commitment!");
    process.exit(1);
  }

  // Step B: Verify Winning Tile Calculation:
  // formula: u64_le(sha256(seed || chain_entropy)[0..8]) % 25 == winning_tile
  const combined = new Uint8Array(64);
  combined.set(seedBytes, 0);
  combined.set(onChainEntropyBytes, 32);

  const hash = sha256(combined);
  const val = new DataView(hash.buffer, hash.byteOffset, hash.byteLength).getBigUint64(0, true);
  const calculatedWinningTile = Number(val % 25n);

  console.log("\n  B) Winning Tile Derivation Check:");
  console.log("     Formula             : u64_le(sha256(seed || chain_entropy)[0..8]) % 25");
  console.log(`     Calculated Tile     : ${calculatedWinningTile}`);
  console.log(`     On-Chain Tile       : ${round.winning_tile}`);

  const tileMatches = calculatedWinningTile === round.winning_tile;
  console.log(`     -> Result           : ${tileMatches ? "✅ PROVABLY FAIR (Matches on-chain winning tile)" : "❌ MISMATCH"}`);

  if (commitMatches && tileMatches) {
    console.log("\n==================================================");
    console.log("  🎉 Cryptographic Fairness Proof: 100% VERIFIED! ");
    console.log("==================================================");
  } else {
    console.error("\n❌ Fairness verification failed!");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal verification error:", err.message);
  process.exit(1);
});
