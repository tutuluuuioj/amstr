import { connect, keyStores, KeyPair, utils, transactions } from "near-api-js";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env.testnet") });

const CVM_URL = process.env.CVM_URL || "https://2dba4d4f68ab082e126801c1271d5fbc1abff3bd-3000.dstack-pha-prod5.phala.network";
const CONTRACT_ID = process.env.CONTRACT_ID || "game.amstr-admin-zxlhcx.testnet";
const ADMIN_ID = process.env.NEAR_ACCOUNT_ID || "amstr-admin-zxlhcx.testnet";
const ADMIN_PRIV_KEY = process.env.NEAR_PRIVATE_KEY;
if (!ADMIN_PRIV_KEY) {
  throw new Error("NEAR_PRIVATE_KEY environment variable is required to run the autonomous keeper daemon. Provide it in .env.testnet or your process environment.");
}
const RPC_ENDPOINTS = [
  "https://near-testnet.drpc.org",
  "https://rpc.testnet.fastnear.com",
];

async function retry<T>(fn: () => Promise<T>, attempts = 6, delayMs = 3000): Promise<T> {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (i === attempts) throw err;
      console.log(`  [Retry ${i}/${attempts}]: ${err.message?.slice(0, 100)}. Waiting ${delayMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("Unreachable");
}

async function sendAlert(message: string) {
  console.warn(`\n🚨 [ALERT] ${message}`);

  // 1. Discord Webhook
  if (process.env.ALERT_WEBHOOK_URL) {
    try {
      await fetch(process.env.ALERT_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message }),
      });
    } catch (e: any) {
      console.warn("Discord webhook alert error:", e.message);
    }
  }

  // 2. Telegram Bot
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      const tgUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
      await fetch(tgUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: message,
        }),
      });
    } catch (e: any) {
      console.warn("Telegram alert error:", e.message);
    }
  }
}

class AutonomousRoundRunnerService {
  private nearAccount: any;
  private isRunning = false;
  private lastGasCheckTime = 0;
  private currentRpcIndex = 0;
  private pendingRoundCommits: Map<number, string> = new Map();

  private async connectRpc(index = this.currentRpcIndex) {
    const keyStore = new keyStores.InMemoryKeyStore();
    const adminKey = KeyPair.fromString(ADMIN_PRIV_KEY as any);
    await keyStore.setKey("testnet", ADMIN_ID, adminKey);

    const endpoint = RPC_ENDPOINTS[index % RPC_ENDPOINTS.length];
    const near = await connect({
      networkId: "testnet",
      keyStore,
      nodeUrl: endpoint,
    });

    this.nearAccount = await near.account(ADMIN_ID);
    console.log(`[RPC] Connected to NEAR Testnet via ${endpoint}`);
  }

  public async rotateRpc(reason: string) {
    this.currentRpcIndex = (this.currentRpcIndex + 1) % RPC_ENDPOINTS.length;
    const nextEndpoint = RPC_ENDPOINTS[this.currentRpcIndex];
    console.warn(`\n[RPC Failover] Rotating endpoint (${reason.slice(0, 80)}) -> ${nextEndpoint}`);
    await this.connectRpc(this.currentRpcIndex);
  }

  public async init() {
    console.log("==================================================");
    console.log("   AMSTR Autonomous Round Runner Daemon (60s)    ");
    console.log("==================================================");
    console.log(`Contract ID : ${CONTRACT_ID}`);
    console.log(`Admin ID    : ${ADMIN_ID}`);
    console.log(`CVM URL     : ${CVM_URL}`);

    await this.connectRpc(0);
    console.log("Initialization complete.\n");
  }

  public async runLoop() {
    this.isRunning = true;
    while (this.isRunning) {
      try {
        await this.step();
      } catch (err: any) {
        const msg = err.message || String(err);
        console.error("[Runner Loop Error]:", msg);
        if (msg.includes("429") || msg.includes("Rate limits") || msg.includes("fetch failed") || msg.includes("ETIMEDOUT")) {
          await this.rotateRpc(msg);
        }
      }
      // Poll every 4 seconds
      await new Promise((r) => setTimeout(r, 4000));
    }
  }

  public stop() {
    this.isRunning = false;
  }

  private async step() {
    // Periodic Keeper Gas Balance Check (every 5 mins)
    const now = Date.now();
    if (now - this.lastGasCheckTime > 5 * 60 * 1000) {
      this.lastGasCheckTime = now;
      try {
        const bal = await this.nearAccount.getAccountBalance();
        const availableNear = Number(BigInt(bal.available) / 10n ** 22n) / 100;
        if (availableNear < 5.0) {
          await sendAlert(
            `KEEPER LOW GAS WARNING: Keeper account ${ADMIN_ID} balance is ${availableNear.toFixed(2)} NEAR (threshold: 5 NEAR). Please refuel.`
          );
        }
      } catch (e: any) {
        console.warn("Gas check notice:", e.message);
      }
    }

    // 1. Fetch current block height and active round from smart contract
    const activeRound = await retry(async () => {
      return await this.nearAccount.viewFunction({
        contractId: CONTRACT_ID,
        methodName: "get_active_round",
        args: {},
      });
    });

    const blockStatus = await retry(async () => {
      return await this.nearAccount.connection.provider.status();
    });
    const currentHeight = blockStatus.sync_info.latest_block_height;

    // Case A: No active round, or round is finished (Settled / Refunded) -> Open next round
    if (!activeRound || activeRound.status === "Settled" || activeRound.status === "Refunded") {
      const nextRoundId = await retry(async () => {
        return await this.nearAccount.viewFunction({
          contractId: CONTRACT_ID,
          methodName: "get_next_round_id",
          args: {},
        });
      });

      const nextRoundNum = Number(nextRoundId);
      let seedCommit = this.pendingRoundCommits.get(nextRoundNum);

      if (!seedCommit) {
        console.log(`\n>>> [Step 1] Requesting CVM seed commit for Round #${nextRoundId}...`);
        const seedCommitRes = await fetch(`${CVM_URL}/round/seed-commit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ round_id: nextRoundNum }),
        });

        if (!seedCommitRes.ok) {
          throw new Error(`CVM seed-commit error (${seedCommitRes.status}): ${await seedCommitRes.text()}`);
        }

        const seedData: any = await seedCommitRes.json();
        seedCommit = seedData.seed_commit;
        this.pendingRoundCommits.set(nextRoundNum, seedCommit!);
        console.log(`    Seed Commit locked: ${seedCommit}`);
      } else {
        console.log(`\n>>> [Step 1] Reusing locked CVM seed commit for Round #${nextRoundId}: ${seedCommit}`);
      }

      console.log(`>>> [Step 1] Calling open_round(${nextRoundId}) on NEAR Testnet...`);
      try {
        const openTx = await retry(async () => {
          const freshNextId = await this.nearAccount.viewFunction({
            contractId: CONTRACT_ID,
            methodName: "get_next_round_id",
            args: {},
          });
          if (Number(freshNextId) > nextRoundNum) {
            console.log(`    Round #${nextRoundNum} already opened on-chain!`);
            return { transaction: { hash: "already_confirmed" } };
          }
          return await this.nearAccount.functionCall({
            contractId: CONTRACT_ID,
            methodName: "open_round",
            args: { seed_commit: seedCommit },
            gas: 100000000000000n, // 100 TGas
          });
        });
        console.log(`    Round #${nextRoundId} OPEN! Tx: ${openTx.transaction.hash}`);
      } catch (err: any) {
        // If open_round failed because it was already opened by a concurrent attempt
        const checkActive = await this.nearAccount.viewFunction({
          contractId: CONTRACT_ID,
          methodName: "get_active_round",
          args: {},
        });
        if (checkActive && Number(checkActive.round_id) === nextRoundNum) {
          console.log(`    Round #${nextRoundId} was already successfully opened! Proceeding.`);
        } else {
          throw err;
        }
      }
      return;
    }

    // Case B: Round is Open -> check if deposit window elapsed
    if (activeRound.status === "Open") {
      // Clear pending commits for active round
      this.pendingRoundCommits.delete(Number(activeRound.round_id));

      const remainingBlocks = activeRound.close_height - currentHeight;
      if (remainingBlocks > 0) {
        process.stdout.write(`\r[Round #${activeRound.round_id} OPEN] Window closes in ${remainingBlocks} blocks (~${remainingBlocks}s) | Players: ${activeRound.entry_count}   `);
        return;
      }

      if (currentHeight > activeRound.close_height + 5) {
        const delayBlocks = currentHeight - activeRound.close_height;
        await sendAlert(
          `WINDOW OVERDUE: Round #${activeRound.round_id} is ${delayBlocks} blocks past close_height without being closed! Triggering immediate close_round()...`
        );
      }

      console.log(`\n\n>>> [Step 2] Deposit window closed for Round #${activeRound.round_id}! Calling close_round()...`);
      try {
        const closeTx = await retry(async () => {
          return await this.nearAccount.functionCall({
            contractId: CONTRACT_ID,
            methodName: "close_round",
            args: { round_id: Number(activeRound.round_id) },
            gas: 100000000000000n,
          });
        });
        console.log(`    Round #${activeRound.round_id} CLOSED! Entropy locked. Tx: ${closeTx.transaction.hash}`);
      } catch (err: any) {
        // Idempotency check: if already closed, proceed
        const check = await this.nearAccount.viewFunction({
          contractId: CONTRACT_ID,
          methodName: "get_active_round",
          args: {},
        });
        if (check && check.status !== "Open") {
          console.log(`    Round #${activeRound.round_id} already transitioned to ${check.status}.`);
        } else {
          throw err;
        }
      }
      return;
    }

    // Case C: Round is Revealing -> fetch entries, decrypt via CVM, reveal_batch, and settle
    if (activeRound.status === "Revealing") {
      console.log(`\n>>> [Step 3] Round #${activeRound.round_id} in Revealing phase. Querying entries...`);
      const entries = await retry(async () => {
        return await this.nearAccount.viewFunction({
          contractId: CONTRACT_ID,
          methodName: "get_round_entries",
          args: { round_id: Number(activeRound.round_id) },
        });
      });
      console.log(`    Found ${entries.length} player entries.`);

      const settlePayload = {
        round_id: Number(activeRound.round_id),
        seed_commit: Buffer.from(activeRound.seed_commit).toString("base64"),
        entries: entries.map((e: any) => ({
          account_id: e.account_id,
          ciphertext: Buffer.from(e.ciphertext).toString("base64"),
          commit: Buffer.from(e.commit).toString("base64"),
        })),
      };

      console.log(`>>> [Step 3] Submitting entries to Phala Intel TDX CVM for hardware decryption...`);
      const settleCvmRes = await fetch(`${CVM_URL}/round/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settlePayload),
      });

      if (!settleCvmRes.ok) {
        const errorText = await settleCvmRes.text();
        console.warn(`CVM Settle Notice (${settleCvmRes.status}): ${errorText}`);
        const timeoutBlock = activeRound.close_height + 600;
        const blocksLeft = timeoutBlock - currentHeight;

        if (blocksLeft <= 0) {
          console.log(`>>> [Fail-Safe Auto-Refund] Timeout reached on Round #${activeRound.round_id} (+600 blocks).`);
          const nextRoundNum = Number(activeRound.round_id) + 1;
          let nextSeedCommit: string | undefined = this.pendingRoundCommits.get(nextRoundNum);

          if (!nextSeedCommit) {
            console.log(`    Pre-locking CVM seed commit for Next Round #${nextRoundNum}...`);
            try {
              const seedCommitRes = await fetch(`${CVM_URL}/round/seed-commit`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ round_id: nextRoundNum }),
              });
              if (seedCommitRes.ok) {
                const seedData: any = await seedCommitRes.json();
                nextSeedCommit = seedData.seed_commit;
                this.pendingRoundCommits.set(nextRoundNum, nextSeedCommit!);
              }
            } catch (preErr: any) {
              console.warn("Could not pre-fetch next seed:", preErr.message);
            }
          }

          console.log(`    Submitting atomic refund_expired + open_round(#${nextRoundNum})...`);
          await retry(async () => {
            if (nextSeedCommit) {
              return await this.nearAccount.signAndSendTransaction({
                receiverId: CONTRACT_ID,
                actions: [
                  transactions.functionCall(
                    "refund_expired",
                    { round_id: Number(activeRound.round_id), limit: 50 },
                    150000000000000n,
                    0n
                  ),
                  transactions.functionCall(
                    "open_round",
                    { seed_commit: nextSeedCommit },
                    100000000000000n,
                    0n
                  ),
                ],
              });
            } else {
              return await this.nearAccount.functionCall({
                contractId: CONTRACT_ID,
                methodName: "refund_expired",
                args: { round_id: Number(activeRound.round_id), limit: 50 },
                gas: 200000000000000n,
              });
            }
          });
          console.log(`    Round #${activeRound.round_id} Refunded and Round #${nextRoundNum} Opened Atomically!`);
          this.pendingRoundCommits.delete(nextRoundNum);
          return;
        } else {
          console.log(`    [Fail-Safe Pending]: ${blocksLeft} blocks until automatic refund activation. Waiting safely.`);
          return;
        }
      }

      const cvmData: any = await settleCvmRes.json();
      console.log(`    CVM Hardware Decryption & Signature complete!`);

      // If there are reveals, submit reveal_batch
      if (cvmData.reveals && cvmData.reveals.length > 0) {
        console.log(`>>> [Step 3] Submitting reveal_batch with ${cvmData.reveals.length} reveals...`);
        try {
          const revealTx = await retry(async () => {
            return await this.nearAccount.functionCall({
              contractId: CONTRACT_ID,
              methodName: "reveal_batch",
              args: {
                round_id: Number(activeRound.round_id),
                reveals: cvmData.reveals,
              },
              gas: 200000000000000n,
            });
          });
          console.log(`    reveal_batch Tx: ${revealTx.transaction.hash}`);
        } catch (revealErr: any) {
          console.warn(`    reveal_batch notice: ${revealErr.message?.slice(0, 80)}`);
        }
      }

      // Pre-lock next round seed commit while current round is still in Revealing!
      // This prevents the CVM's 3-second internal loop from ever racing or overwriting the seed.
      const nextRoundNum = Number(activeRound.round_id) + 1;
      let nextSeedCommit = this.pendingRoundCommits.get(nextRoundNum);
      if (!nextSeedCommit) {
        console.log(`>>> [Step 3] Pre-requesting CVM seed commit for Next Round #${nextRoundNum}...`);
        try {
          const seedCommitRes = await fetch(`${CVM_URL}/round/seed-commit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ round_id: nextRoundNum }),
          });
          if (seedCommitRes.ok) {
            const seedData: any = await seedCommitRes.json();
            nextSeedCommit = seedData.seed_commit;
            this.pendingRoundCommits.set(nextRoundNum, nextSeedCommit!);
            console.log(`    Next Round #${nextRoundNum} Seed Commit locked: ${nextSeedCommit}`);
          }
        } catch (preErr: any) {
          console.warn("Could not pre-fetch next seed:", preErr.message);
        }
      }

      // Settle round on-chain and open next round in the EXACT SAME ATOMIC TRANSACTION!
      // This guarantees zero idle blocks where status is "Settled", so the CVM loop never regenerates seeds.
      console.log(`>>> [Step 3] Submitting atomic settle(Round #${activeRound.round_id}) + open_round(Round #${nextRoundNum})...`);
      let settleConfirmed = false;
      try {
        const settleTx = await retry(async () => {
          if (nextSeedCommit) {
            return await this.nearAccount.signAndSendTransaction({
              receiverId: CONTRACT_ID,
              actions: [
                transactions.functionCall(
                  "settle",
                  {
                    round_id: Number(activeRound.round_id),
                    seed: cvmData.seed,
                    sig: cvmData.signature,
                  },
                  150000000000000n,
                  0n
                ),
                transactions.functionCall(
                  "open_round",
                  {
                    seed_commit: nextSeedCommit,
                  },
                  100000000000000n,
                  0n
                ),
              ],
            });
          } else {
            return await this.nearAccount.functionCall({
              contractId: CONTRACT_ID,
              methodName: "settle",
              args: {
                round_id: Number(activeRound.round_id),
                seed: cvmData.seed,
                sig: cvmData.signature,
              },
              gas: 250000000000000n,
            });
          }
        });
        console.log(`    Atomic Settle + Open SUCCESS! Tx: ${settleTx.transaction.hash}`);
        settleConfirmed = true;
        this.pendingRoundCommits.delete(nextRoundNum);
      } catch (err: any) {
        // Idempotency check: did a retry or parallel call succeed?
        console.warn(`    settle() returned: ${err.message?.slice(0, 100)}. Checking on-chain status...`);
        const checkRound = await this.nearAccount.viewFunction({
          contractId: CONTRACT_ID,
          methodName: "get_round",
          args: { round_id: Number(activeRound.round_id) },
        });
        if (checkRound && (checkRound.status === "Settled" || checkRound.status === "Refunded")) {
          console.log(`    Round #${activeRound.round_id} is confirmed Settled on-chain!`);
          settleConfirmed = true;
          this.pendingRoundCommits.delete(nextRoundNum);
        } else {
          throw err;
        }
      }

      if (settleConfirmed) {
        // Persist revealed seed for instant automated fairness verification
        try {
          const seedsPath = path.resolve(__dirname, "../../web/src/data/settledSeeds.json");
          const publicPath = path.resolve(__dirname, "../../web/public/settledSeeds.json");
          const currentData = fs.existsSync(seedsPath) ? JSON.parse(fs.readFileSync(seedsPath, "utf8")) : {};
          currentData[Number(activeRound.round_id)] = cvmData.seed;
          fs.writeFileSync(seedsPath, JSON.stringify(currentData, null, 2));
          if (fs.existsSync(path.dirname(publicPath))) {
            fs.writeFileSync(publicPath, JSON.stringify(currentData, null, 2));
          }
        } catch (err: any) {
          console.warn(`Could not update settledSeeds.json:`, err.message);
        }

        // Query settled round
        const settledRound = await retry(async () => {
          return await this.nearAccount.viewFunction({
            contractId: CONTRACT_ID,
            methodName: "get_round",
            args: { round_id: Number(activeRound.round_id) },
          });
        });

        console.log(`==================================================`);
        console.log(`  Round #${settledRound.round_id} Settled!`);
        console.log(`  Winning Tile Drawn: #${settledRound.winning_tile}`);
        console.log(`  Total Net Pot     : ${utils.format.formatNearAmount(settledRound.total_net.toString())} NEAR`);
        console.log(`==================================================\n`);

        // Automated 6% Buyback & Burn per Round
        try {
          console.log(`>>> [Buyback & Burn] Executing automated round buyback...`);
          const grossNear = BigInt(settledRound.total_gross || "0");
          let buybackNear = (grossNear * 600n) / 10000n; // 6% of gross pot
          if (buybackNear < 1000000000000000000000n) {
            buybackNear = 1000000000000000000000n; // 0.001 NEAR baseline per round
          }
          const buybackTx = await retry(async () => {
            return await this.nearAccount.functionCall({
              contractId: "treasury.amstr-admin-zxlhcx.testnet",
              methodName: "run_buyback",
              args: { near_to_spend: buybackNear.toString() },
              gas: 150000000000000n,
            });
          });
          console.log(`    Buyback & Burn SUCCESS! Tx: ${buybackTx.transaction.hash}`);
        } catch (bbErr: any) {
          console.warn(`    Buyback notice: ${bbErr.message?.slice(0, 100)}`);
        }
      }

      // Brief delay before opening next round
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

async function main() {
  const runner = new AutonomousRoundRunnerService();
  await runner.init();
  await runner.runLoop();
}

main().catch((err) => {
  console.error("Fatal runner crash:", err);
  process.exit(1);
});
