import { describe, it } from "node:test";
import assert from "node:assert";
import http from "node:http";
import { EnclaveKeys } from "./keys.js";
import { AttestationProvider } from "./attestation.js";
import { createServer } from "./server.js";

describe("Phase 2 CVM HTTP REST API", () => {
  async function createServerFixture() {
    const keys = EnclaveKeys.generate();
    const attestation = await new AttestationProvider().generateAttestation(keys);
    const app = createServer({
      keys,
      attestation,
      contractId: "amstr-game.testnet",
      startTime: Date.now() - 5000,
    });

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    return { server, baseUrl, keys, attestation };
  }

  it("GET /health returns 200 OK and enclave status without secret keys", async () => {
    const { server, baseUrl, keys } = await createServerFixture();
    try {
      const res = await fetch(`${baseUrl}/health`);
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;

      assert.strictEqual(data.status, "healthy");
      assert.strictEqual(data.contract_id, "amstr-game.testnet");
      assert.strictEqual(data.pubkey, keys.nearPublicKey);
      assert.strictEqual(data.x25519_pub, keys.x25519PublicKeyBase64);
      assert.strictEqual(data.signSecretKey, undefined);
      assert.strictEqual(data.boxSecretKey, undefined);
    } finally {
      server.close();
    }
  });

  it("GET /attestation returns remote attestation quote and code hash", async () => {
    const { server, baseUrl, attestation } = await createServerFixture();
    try {
      const res = await fetch(`${baseUrl}/attestation`);
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;

      assert.strictEqual(data.code_hash, attestation.code_hash);
      assert.strictEqual(data.ed25519_pub, attestation.ed25519_pub);
      assert.strictEqual(data.x25519_pub, attestation.x25519_pub);
      assert.strictEqual(data.report_data_hash, attestation.report_data_hash);
      assert.strictEqual(data.quote_b64, attestation.quote_b64);
    } finally {
      server.close();
    }
  });

  it("GET /keys returns public encryption keys for the web client", async () => {
    const { server, baseUrl, keys } = await createServerFixture();
    try {
      const res = await fetch(`${baseUrl}/keys`);
      assert.strictEqual(res.status, 200);
      const data = (await res.json()) as any;

      assert.strictEqual(data.ed25519_pub, keys.nearPublicKey);
      assert.strictEqual(data.x25519_pub, keys.x25519PublicKeyBase64);
      assert.strictEqual(data.secret_key, undefined);
    } finally {
      server.close();
    }
  });
});
