import { describe, it } from "node:test";
import assert from "node:assert";
import { EnclaveKeys } from "./keys.js";
import { AttestationProvider, getAppComposeMeasurement } from "./attestation.js";
import { sha256 } from "@noble/hashes/sha256";

describe("Phase 2 Requirement 2: CVM Attestation and Code Hash Binding", () => {
  it("generates an attestation report with deterministic app code measurement", async () => {
    const keys = EnclaveKeys.generate();
    const provider = new AttestationProvider();
    const report = await provider.generateAttestation(keys);

    assert.ok(report.quote.length >= 64, "TDX quote must be at least 64 bytes");
    assert.strictEqual(report.ed25519_pub, keys.nearPublicKey);
    assert.strictEqual(report.x25519_pub, keys.x25519PublicKeyBase64);

    // Code hash is 64-char hex string representing Docker compose / RTMR3 measurement
    assert.match(report.code_hash, /^[0-9a-f]{64}$/);

    const expectedComposeMeasurement = getAppComposeMeasurement().hashHex;
    assert.strictEqual(report.code_hash, expectedComposeMeasurement);
  });

  it("binds ed25519_pub || x25519_pub in report_data and quote bytes", async () => {
    const keys = EnclaveKeys.generate();
    const provider = new AttestationProvider();
    const report = await provider.generateAttestation(keys);

    // Recompute expected report_data: sha256(signPublicKey [32B] || boxPublicKey [32B])
    const combinedPub = new Uint8Array(64);
    combinedPub.set(keys.signPublicKey, 0);
    combinedPub.set(keys.boxPublicKey, 32);
    const expectedReportDataHash = Buffer.from(sha256(combinedPub)).toString("hex");

    assert.strictEqual(report.report_data_hash, expectedReportDataHash);

    // Verify quote bytes at offset 64..96 contain the report data
    const quoteReportData = Buffer.from(report.quote.slice(64, 96)).toString("hex");
    assert.strictEqual(quoteReportData, expectedReportDataHash);
  });

  it("code hash is stable across distinct ephemeral keys (unlike sha256(quote))", async () => {
    const keys1 = EnclaveKeys.generate();
    const keys2 = EnclaveKeys.generate();
    const provider = new AttestationProvider();

    const report1 = await provider.generateAttestation(keys1);
    const report2 = await provider.generateAttestation(keys2);

    // Code hash MUST be identical because the code running has not changed
    assert.strictEqual(report1.code_hash, report2.code_hash);

    // While report_data differs because ephemeral keys differ
    assert.notStrictEqual(report1.report_data_hash, report2.report_data_hash);
  });

  it("SECURITY: Strictly refuses to generate mock attestation when NODE_ENV=production", async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      const keys = EnclaveKeys.generate();
      // Force simulator mode to test production rejection
      const provider = new AttestationProvider(true);

      await assert.rejects(
        async () => {
          await provider.generateAttestation(keys);
        },
        /FATAL SECURITY ERROR: Mock attestation is strictly disabled in production!/
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });
});
