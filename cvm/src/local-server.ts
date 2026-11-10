import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { connect, keyStores, KeyPair, utils } from "near-api-js";
import { multichainListener, DepositIntent } from "./multichain-listener.js";
import { crossChainRelayer } from "./crosschain-relayer.js";
import { getDerivedForeignAccounts } from "./chainsig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env.testnet") });

const CONTRACT_ID = process.env.CONTRACT_ID || "game.amstr-admin-zxlhcx.testnet";
const ADMIN_ID = process.env.NEAR_ACCOUNT_ID || "amstr-admin-zxlhcx.testnet";
const ADMIN_PRIV_KEY =
  process.env.NEAR_PRIVATE_KEY ||
  "ed25519:3XZERnaJXnEz9R3N8oSt9XwfFJzE9mFxzo9eW9vKQXxPiQaTJbnBizqBxsb86Zkv3b6EfjinzVyKBXE9eehunq2L";
const NODE_URL = process.env.NEAR_NODE_URL || "https://rpc.testnet.fastnear.com";

const REGISTERED_ED25519_PUB = "ed25519:8fXMCKmxZxEuhr5dWMQkDXq8K3pF7teAJvq8GwFx87U6";
const REGISTERED_X25519_PUB = "EcT6bfLFEE3zB0BQ25CBhxuuItBH5LFf6kuR7lvSA24=";

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Near connection and KeyStore for relayer
const keyStore = new keyStores.InMemoryKeyStore();
const adminKeyPair = KeyPair.fromString(ADMIN_PRIV_KEY as any);
await keyStore.setKey("testnet", ADMIN_ID, adminKeyPair);

const near = await connect({
  networkId: "testnet",
  keyStore,
  nodeUrl: NODE_URL,
});

const adminAccount = await near.account(ADMIN_ID);
console.log(`[Local Multichain Relayer] Initialized with admin account: ${ADMIN_ID}`);

// 1. Health
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "healthy",
    service: "amstr-local-multichain-relayer",
    contractId: CONTRACT_ID,
    adminId: ADMIN_ID,
    pubkey: REGISTERED_ED25519_PUB,
    x25519_pub: REGISTERED_X25519_PUB,
  });
});

// 2. Keys (for client-side pick encryption matching the smart contract)
app.get("/keys", (_req: Request, res: Response) => {
  res.json({
    ed25519_pub: REGISTERED_ED25519_PUB,
    x25519_pub: REGISTERED_X25519_PUB,
  });
});

// 3. Register pick secret for CVM reveal
const playerEntriesStore: Record<string, any> = {};
app.post("/player/entry", (req: Request, res: Response) => {
  const { round_id, account_id, mask, salt, commit } = req.body;
  if (!round_id || !account_id) {
    return res.status(400).json({ error: "Missing required fields: round_id, account_id" });
  }
  const key = `${round_id}:${account_id}`;
  playerEntriesStore[key] = { round_id, account_id, mask, salt, commit };
  console.log(`[Local Relayer] Saved pick secrets for ${key}`);
  res.json({ success: true, saved: key });
});

// 4. Register deposit intent
app.post("/multichain/deposit-intent", (req: Request, res: Response) => {
  try {
    const intent = multichainListener.registerDepositIntent(req.body);
    console.log(`[Local Relayer] Registered deposit intent ${intent.intentId} for ${intent.accountId} (${intent.targetChain})`);
    res.json({ success: true, intent });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 5. Query intent
app.get("/multichain/intent/:intentId", (req: Request, res: Response) => {
  const intent = multichainListener.getIntent(req.params.intentId);
  if (intent) {
    res.json({ success: true, intent });
  } else {
    res.status(404).json({ success: false, error: "Intent not found" });
  }
});

// Helper: Ensure subaccount exists on NEAR for the player
async function ensurePlayerSubaccount(playerAccountId: string): Promise<any> {
  try {
    await keyStore.setKey("testnet", playerAccountId, adminKeyPair);
    const acc = await near.account(playerAccountId);
    await acc.state();
    return acc;
  } catch (err: any) {
    // If unknown account and subaccount of admin, create it
    if (playerAccountId.endsWith(`.${ADMIN_ID}`)) {
      console.log(`[Local Relayer] Creating subaccount on NEAR testnet: ${playerAccountId}...`);
      await adminAccount.createAccount(
        playerAccountId,
        adminKeyPair.getPublicKey(),
        BigInt(utils.format.parseNearAmount("0.2")!)
      );
      await keyStore.setKey("testnet", playerAccountId, adminKeyPair);
      return await near.account(playerAccountId);
    }
    // Fallback: register key for accountId
    await keyStore.setKey("testnet", playerAccountId, adminKeyPair);
    return await near.account(playerAccountId);
  }
}

// 6. Verify Foreign Transaction & Deploy Bet on NEAR
app.post("/multichain/verify-tx", async (req: Request, res: Response) => {
  try {
    const { intentId, txHash } = req.body;
    console.log(`[Local Relayer] Verifying tx ${txHash} for intent ${intentId}...`);

    const updated = await multichainListener.verifyAndProcessTx(intentId, txHash, async (intent: DepositIntent) => {
      console.log(
        `[Local Relayer] Solana/EVM tx verified on foreign chain! Deploying bet on NEAR contract for round #${intent.roundId}...`
      );

      const stakeYocto =
        utils.format.parseNearAmount(intent.stakeNear ? intent.stakeNear.toString() : "0.05") ||
        "50000000000000000000000";
      const storageYocto = "10000000000000000000000"; // 0.01 NEAR
      const totalDeposit = (BigInt(stakeYocto) + BigInt(storageYocto)).toString();

      // Ensure valid player subaccount
      const playerAcc = await ensurePlayerSubaccount(intent.accountId);

      // Deploy bet to the game contract!
      const outcome = await playerAcc.functionCall({
        contractId: CONTRACT_ID,
        methodName: "deploy",
        args: {
          round_id: intent.roundId,
          ciphertext: intent.ciphertext,
          commit: intent.commit,
        },
        attachedDeposit: totalDeposit,
        gas: 100_000_000_000_000n, // 100 TGas
      });

      const nearTxHash = outcome.transaction.hash;
      console.log(`[Local Relayer] Bet deployed on-chain on NEAR! Tx: ${nearTxHash}`);
      return nearTxHash;
    });

    res.json({ success: true, intent: updated });
  } catch (err: any) {
    console.error("[Local Relayer] Verification or deploy failed:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// 7. Outbound Payout
app.post("/multichain/payout", async (req: Request, res: Response) => {
  try {
    const { recipientAddress, amountSol, amountEth, chain } = req.body;
    let payout: any;
    if (chain === "solana") {
      payout = await crossChainRelayer.executeSolanaPayout(
        adminAccount,
        recipientAddress,
        amountSol || "0.01",
        "solana-1"
      );
    } else {
      payout = await crossChainRelayer.executeCrossChainPayout(
        adminAccount,
        recipientAddress,
        amountEth || "0.005",
        `${chain || "base"}-1`
      );
    }
    res.json({ success: true, payout });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

const PORT = 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Local Multichain Relayer & Keeper API] Listening on http://localhost:${PORT}`);
});
