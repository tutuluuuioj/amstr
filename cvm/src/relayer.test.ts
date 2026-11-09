import test from "node:test";
import assert from "node:assert/strict";
import { GaslessRelayerService } from "./relayer.js";

test("GaslessRelayerService: Architecture & Security Controls", async (t) => {
  const dummyKey = "ed25519:3D5WpBsMmBVsrT8rkFmbY2UfHek3mC8mQ2XW9hG1pQ9JzKjM7hF6mR5vL4wT3xY2kZ1aB9cD8eF7gH6j";
  const relayer = new GaslessRelayerService({
    networkId: "testnet",
    nodeUrl: "https://rpc.testnet.near.org",
    relayerAccountId: "relayer.testnet",
    relayerPrivateKey: dummyKey,
    whitelistedContracts: ["game.amstr-admin-zxlhcx.testnet", "token.amstr-admin-zxlhcx.testnet"],
    maxCallsPerHourPerAccount: 3,
  });

  await t.test("enforces strict contract whitelisting", async () => {
    const res = await relayer.relayFunctionCall({
      senderAccountId: "alice.testnet",
      contractId: "malicious-contract.testnet",
      methodName: "deploy",
      args: {},
    });
    assert.equal(res.success, false);
    assert.match(res.error || "", /not whitelisted/);
  });

  await t.test("enforces strict method whitelisting", async () => {
    const res = await relayer.relayFunctionCall({
      senderAccountId: "alice.testnet",
      contractId: "game.amstr-admin-zxlhcx.testnet",
      methodName: "unauthorized_admin_wipe",
      args: {},
    });
    assert.equal(res.success, false);
    assert.match(res.error || "", /not permitted/);
  });

  await t.test("enforces sliding-window rate limiting per account", async () => {
    const account = "rate_limited_user.testnet";
    assert.equal(relayer.checkRateLimit(account), true); // 1
    assert.equal(relayer.checkRateLimit(account), true); // 2
    assert.equal(relayer.checkRateLimit(account), true); // 3
    assert.equal(relayer.checkRateLimit(account), false); // 4 (exceeded max 3)
  });

  await t.test("reports active operational status and telemetry", async () => {
    const status = relayer.getStatus();
    assert.equal(status.status, "active");
    assert.equal(status.relayerAccountId, "relayer.testnet");
    assert.equal(status.whitelistedContracts.length, 2);
    assert.equal(status.rateLimitPerHour, 3);
  });
});
