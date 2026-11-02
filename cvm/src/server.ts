import express, { Request, Response } from "express";
import cors from "cors";
import { EnclaveKeys } from "./keys.js";
import { AttestationReport } from "./attestation.js";
import { AutonomousRoundRunner } from "./runner.js";
import { decryptAndVerifyEntry, toContractRevealItems } from "./decrypt.js";

export interface ServerState {
  keys: EnclaveKeys;
  attestation: AttestationReport;
  contractId: string;
  startTime: number;
  runner?: AutonomousRoundRunner;
}

export function createServer(state: ServerState): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Health endpoint
  app.get("/health", (_req: Request, res: Response) => {
    const uptimeSeconds = Math.floor((Date.now() - state.startTime) / 1000);
    res.json({
      status: "healthy",
      uptime_seconds: uptimeSeconds,
      pubkey: state.keys.nearPublicKey,
      x25519_pub: state.keys.x25519PublicKeyBase64,
      contract_id: state.contractId,
      is_hardware_tdx: state.attestation.is_hardware_tdx,
    });
  });

  // Proof screen endpoint: serves TDX attestation quote, code hash, and public keys
  app.get("/attestation", (_req: Request, res: Response) => {
    res.json(state.attestation);
  });

  // Public keys for client-side pick encryption (private keys are strictly hidden)
  app.get("/keys", (_req: Request, res: Response) => {
    res.json({
      ed25519_pub: state.keys.nearPublicKey,
      x25519_pub: state.keys.x25519PublicKeyBase64,
    });
  });

  // Generate volatile round seed commit for opening a new round
  app.post("/round/seed-commit", (req: Request, res: Response) => {
    if (!state.runner) {
      return res.status(503).json({ error: "Runner not initialized" });
    }
    const roundId = BigInt(req.body.round_id || 1);
    const { commit } = state.runner.generateSeedForRound(roundId);
    res.json({
      round_id: Number(roundId),
      seed_commit: Buffer.from(commit).toString("base64"),
      seed_commit_hex: Buffer.from(commit).toString("hex"),
    });
  });

  // Post-close decryption, verification, and settlement signing
  app.post("/round/settle", async (req: Request, res: Response) => {
    if (!state.runner) {
      return res.status(503).json({ error: "Runner not initialized" });
    }
    const roundId = BigInt(req.body.round_id);
    const roundCommit = Buffer.from(req.body.seed_commit, "base64");
    const seed = state.runner.getVerifiedSeed(roundId, new Uint8Array(roundCommit));
    if (!seed) {
      return res.status(400).json({ error: "Seed not found or commit mismatch" });
    }

    const reveals = [];
    const entries = req.body.entries || [];
    for (const entry of entries) {
      const entryCommit = Buffer.from(entry.commit, "base64");
      const ciphertext = Buffer.from(entry.ciphertext, "base64");
      const r = decryptAndVerifyEntry(state.keys, entry.account_id, roundId, ciphertext, entryCommit);
      reveals.push(r);
    }

    const signature = state.keys.signSettle(roundId, seed);
    res.json({
      round_id: Number(roundId),
      seed: Buffer.from(seed).toString("base64"),
      signature: Buffer.from(signature).toString("base64"),
      reveals: toContractRevealItems(reveals),
    });
  });

  return app;
}
