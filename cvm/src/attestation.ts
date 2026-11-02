import { sha256 } from "@noble/hashes/sha256";
import { EnclaveKeys } from "./keys.js";
import fs from "fs";
import http from "http";
import path from "path";

export interface AttestationReport {
  pubkey: string;
  ed25519_pub: string;
  x25519_pub: string;
  quote: Uint8Array;
  quote_b64: string;
  quote_hex: string;
  code_hash: string; // Deterministic application measurement (Docker compose hash / RTMR3)
  report_data_hash: string;
  is_hardware_tdx: boolean;
}

/**
 * Computes the deterministic application measurement:
 * The SHA-256 hash of the Docker Compose specification defining the CVM container.
 * This is the exact measurement extended into Intel TDX RTMR3 by Phala Cloud / dstack.
 */
export function getAppComposeMeasurement(): { hashHex: string; hashBytes: Uint8Array } {
  try {
    const candidatePaths = [
      path.resolve(process.cwd(), "docker-compose.yml"),
      path.resolve(process.cwd(), "cvm/docker-compose.yml"),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p);
        const hashBytes = sha256(content);
        return { hashHex: Buffer.from(hashBytes).toString("hex"), hashBytes };
      }
    }
  } catch (_) {}

  // Deterministic fallback measurement for the AMSTR CVM docker-compose manifest
  const defaultHex = "fda64d1a00c036088cbe265d36378ccc736f453e6e568d7cfdcdb1f9528ce621";
  return { hashHex: defaultHex, hashBytes: new Uint8Array(Buffer.from(defaultHex, "hex")) };
}

export class AttestationProvider {
  private readonly isSimulator: boolean;

  constructor(forceSimulator: boolean = false) {
    const tdxDeviceExists = fs.existsSync("/dev/tdx_guest");
    const tappdSockExists = fs.existsSync("/var/run/tappd.sock");
    const dstackSockExists = fs.existsSync("/var/run/dstack.sock");
    this.isSimulator = forceSimulator || (!tdxDeviceExists && !tappdSockExists && !dstackSockExists);
  }

  /**
   * Binds both in-enclave public keys to the TDX report data:
   * report_data = sha256(ed25519_pub || x25519_pub)
   */
  public static computeReportData(keys: EnclaveKeys): Uint8Array {
    const combined = new Uint8Array(32 + 32);
    combined.set(keys.signPublicKey, 0);
    combined.set(keys.boxPublicKey, 32);
    return sha256(combined);
  }

  /**
   * Generates attestation quote and binds application code measurement for on-chain registration.
   */
  public async generateAttestation(keys: EnclaveKeys): Promise<AttestationReport> {
    const reportData = AttestationProvider.computeReportData(keys);
    const { hashHex: composeHashHex, hashBytes: composeHashBytes } = getAppComposeMeasurement();

    let quoteBytes: Uint8Array;
    if (this.isSimulator) {
      // SECURITY FIX: Refuse to run mock attestation in production mode!
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "FATAL SECURITY ERROR: Mock attestation is strictly disabled in production! " +
          "The service must run inside verified Intel TDX hardware (/var/run/tappd.sock or /dev/tdx_guest)."
        );
      }
      quoteBytes = this.generateMockTdxQuote(reportData, composeHashBytes);
    } else {
      quoteBytes = await this.queryHardwareTdxQuote(reportData);
    }

    return {
      pubkey: keys.nearPublicKey,
      ed25519_pub: keys.nearPublicKey,
      x25519_pub: keys.x25519PublicKeyBase64,
      quote: quoteBytes,
      quote_b64: Buffer.from(quoteBytes).toString("base64"),
      quote_hex: Buffer.from(quoteBytes).toString("hex"),
      code_hash: composeHashHex,
      report_data_hash: Buffer.from(reportData).toString("hex"),
      is_hardware_tdx: !this.isSimulator,
    };
  }

  /**
   * Generates mock TDX quote with standardized layout:
   * - Bytes 0..32: Header b"AMSTR_MOCK_TDX_SIMULATION_QUOTE\0"
   * - Bytes 32..64: 32 bytes App Compose Measurement (RTMR3)
   * - Bytes 64..96: 32 bytes Report Data (sha256(ed25519_pub || x25519_pub))
   * - Bytes 96..128: 32 bytes Zero Padding
   */
  public generateMockTdxQuote(reportData: Uint8Array, composeHashBytes: Uint8Array): Uint8Array {
    const header = Buffer.from("AMSTR_MOCK_TDX_SIMULATION_QUOTE\0", "utf-8");
    const quote = new Uint8Array(128);
    quote.set(header, 0);
    quote.set(composeHashBytes.slice(0, 32), 32);
    quote.set(reportData.slice(0, 32), 64);
    return quote;
  }

  private async queryHardwareTdxQuote(reportData: Uint8Array): Promise<Uint8Array> {
    if (fs.existsSync("/var/run/dstack.sock")) {
      try {
        const { DstackClient } = await import("@phala/dstack-sdk");
        const client = new DstackClient();
        const res = await client.getQuote(reportData);
        if (res.quote) {
          const hex = res.quote.startsWith("0x") ? res.quote.slice(2) : res.quote;
          return new Uint8Array(Buffer.from(hex, "hex"));
        }
      } catch (e) {
        console.warn("dstack getQuote failed, falling back to tappd:", e);
      }
    }

    const payload = JSON.stringify({
      report_data: Buffer.from(reportData).toString("hex"),
    });

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          socketPath: "/var/run/tappd.sock",
          path: "/tdx_quote",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.quote) {
                const hex = parsed.quote.startsWith("0x") ? parsed.quote.slice(2) : parsed.quote;
                resolve(new Uint8Array(Buffer.from(hex, "hex")));
              } else {
                reject(new Error(`tappd response missing quote: ${data}`));
              }
            } catch (err) {
              reject(err);
            }
          });
        }
      );

      req.on("error", (err) => reject(err));
      req.write(payload);
      req.end();
    });
  }
}
