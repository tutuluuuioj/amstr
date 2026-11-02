import { EnclaveKeys } from "./keys.js";
import { AttestationProvider } from "./attestation.js";
import { ResilientRpcClient } from "./rpc.js";
import { AutonomousRoundRunner } from "./runner.js";
import { createServer } from "./server.js";
import dotenv from "dotenv";

dotenv.config();

const PORT = parseInt(process.env.PORT || "3000", 10);
const CONTRACT_ID = process.env.CONTRACT_ID || "amstr-game.testnet";
const RPC_ENDPOINTS = process.env.RPC_ENDPOINTS
  ? process.env.RPC_ENDPOINTS.split(",")
  : [
      "https://rpc.testnet.near.org",
      "https://testnet.neardata.xyz/v1/node",
      "https://near-testnet.api.pagoda.co/rpc/v1",
    ];

async function main() {
  console.log("==================================================");
  console.log("   AMSTR Phala CVM (TEE Service) - Node.js/TS    ");
  console.log("==================================================");

  // 1. Generate in-enclave ephemeral keys in volatile memory
  console.log("[1/4] Generating in-enclave ephemeral keys...");
  const keys = EnclaveKeys.generate();
  console.log(`      Ed25519 Public Key: ${keys.nearPublicKey}`);
  console.log(`      X25519  Public Key: ${keys.x25519PublicKeyBase64}`);
  console.log("      Private keys safely allocated in memory (zero disk egress).");

  // 2. Generate remote attestation quote (TDX)
  console.log("[2/4] Generating Intel TDX attestation quote...");
  const attestationProvider = new AttestationProvider();
  const attestation = await attestationProvider.generateAttestation(keys);
  console.log(`      Code Hash : ${attestation.code_hash}`);
  console.log(`      Hardware  : ${attestation.is_hardware_tdx ? "Intel TDX Enclave" : "Local Simulator"}`);

  // 3. Initialize resilient multi-provider RPC client
  console.log("[3/4] Initializing resilient RPC client...");
  const rpc = new ResilientRpcClient({ endpoints: RPC_ENDPOINTS });
  console.log(`      Configured ${RPC_ENDPOINTS.length} RPC failover endpoints`);

  // 4. Initialize Autonomous Round Runner
  const runner = new AutonomousRoundRunner(keys, rpc, CONTRACT_ID, attestation);

  // 5. Start HTTP server
  const state = {
    keys,
    attestation,
    contractId: CONTRACT_ID,
    startTime: Date.now(),
    runner,
  };
  const app = createServer(state);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[4/4] CVM HTTP server listening on port ${PORT}`);
    console.log(`      GET /health      -> CVM status`);
    console.log(`      GET /attestation -> TDX quote & code hash`);
    console.log(`      GET /keys        -> Public keys for client encryption`);
    console.log("==================================================");
  });

  // Start autonomous loop (runs every 3 seconds)
  setInterval(async () => {
    try {
      const currentBlock = await rpc.getBlockHeight();
      const activeRound = await rpc.viewFunction<any>(CONTRACT_ID, "get_active_round", {});
      let entries: any[] = [];
      if (activeRound && activeRound.status === "Revealing") {
        entries =
          (await rpc.viewFunction<any[]>(CONTRACT_ID, "get_round_entries", {
            round_id: activeRound.round_id,
          })) || [];
      }
      const action = await runner.step(currentBlock, activeRound, entries);
      // Log or execute action
      if (action.type !== "WaitingForDeposits") {
        console.log(`[CVM Autonomous Loop] Action: ${action.type}`);
      }
    } catch (err: any) {
      // Handled gracefully via multi-provider RPC retry
    }
  }, 3000);
}

if (
  process.env.CVM_START === "1" ||
  (typeof import.meta !== "undefined" && import.meta.url === `file://${process.argv[1]}`) ||
  (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module)
) {
  main().catch((err) => {
    console.error("Fatal CVM Error:", err);
    process.exit(1);
  });
}

export { EnclaveKeys, AttestationProvider, ResilientRpcClient, AutonomousRoundRunner, createServer };
