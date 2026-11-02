import { connect, keyStores, KeyPair } from "../cvm/node_modules/near-api-js/lib/index.js";

const CONTRACT_ID = process.env.CONTRACT_ID || "game.amstr-admin-zxlhcx.testnet";
const ADMIN_ID = process.env.NEAR_ACCOUNT_ID || "amstr-admin-zxlhcx.testnet";
const ADMIN_PRIV_KEY = process.env.NEAR_PRIVATE_KEY;
if (!ADMIN_PRIV_KEY) {
  console.error("Error: NEAR_PRIVATE_KEY environment variable is required to execute admin updates.");
  process.exit(1);
}
const RPC_URL = "https://rpc.testnet.fastnear.com";

async function main() {
  console.log("==================================================");
  console.log("  Updating deposit_window_blocks to 300 (~5 mins)");
  console.log("==================================================");

  const keyStore = new keyStores.InMemoryKeyStore();
  const kp = KeyPair.fromString(ADMIN_PRIV_KEY);
  await keyStore.setKey("testnet", ADMIN_ID, kp);

  const near = await connect({ networkId: "testnet", keyStore, nodeUrl: RPC_URL });
  const admin = await near.account(ADMIN_ID);

  // 1. Fetch current config
  const currentConfig = await admin.viewFunction({
    contractId: CONTRACT_ID,
    methodName: "get_config",
    args: {}
  });
  console.log("Current config on-chain:", JSON.stringify(currentConfig, null, 2));

  // 2. Prepare updated config with deposit_window_blocks = 300
  const updatedConfig = {
    ...currentConfig,
    deposit_window_blocks: 300 // ~5 minutes (300 blocks at ~1s/block)
  };

  console.log(`Calling set_config with deposit_window_blocks: 300...`);
  const txOutcome = await admin.functionCall({
    contractId: CONTRACT_ID,
    methodName: "set_config",
    args: { config: updatedConfig },
    gas: "100000000000000"
  });

  console.log("set_config Transaction successful!");
  console.log("Tx Hash:", txOutcome.transaction.hash);
  console.log(`NearBlocks: https://testnet.nearblocks.io/txns/${txOutcome.transaction.hash}`);

  // 3. Verify on-chain
  const verifiedConfig = await admin.viewFunction({
    contractId: CONTRACT_ID,
    methodName: "get_config",
    args: {}
  });
  console.log("\nVerified new config on-chain:", JSON.stringify(verifiedConfig, null, 2));
}

main().catch(err => {
  console.error("set_config failed:", err);
  process.exit(1);
});
