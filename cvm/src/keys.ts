import nacl from "tweetnacl";
import bs58 from "bs58";

/**
 * Ephemeral In-Enclave Cryptographic Keys (Ed25519 + X25519).
 *
 * Security Requirements:
 * - Private keys are generated strictly in memory upon boot.
 * - Private keys NEVER leave the enclave, are never written to disk, and are never logged.
 */
export class EnclaveKeys {
  private readonly signSecretKey: Uint8Array;
  private readonly boxSecretKey: Uint8Array;

  public readonly signPublicKey: Uint8Array;
  public readonly boxPublicKey: Uint8Array;

  private constructor(
    signKeyPair: nacl.SignKeyPair,
    boxKeyPair: nacl.BoxKeyPair
  ) {
    this.signSecretKey = signKeyPair.secretKey;
    this.signPublicKey = signKeyPair.publicKey;

    this.boxSecretKey = boxKeyPair.secretKey;
    this.boxPublicKey = boxKeyPair.publicKey;
  }

  /**
   * Generates new in-memory ephemeral keys using OS CSPRNG.
   */
  public static generate(): EnclaveKeys {
    const signKp = nacl.sign.keyPair();
    const boxKp = nacl.box.keyPair();
    return new EnclaveKeys(signKp, boxKp);
  }

  /**
   * Formats the Ed25519 public key for NEAR Protocol ("ed25519:<base58>")
   */
  public get nearPublicKey(): string {
    return `ed25519:${bs58.encode(this.signPublicKey)}`;
  }

  /**
   * Returns the Base64 representation of the X25519 encryption public key.
   */
  public get x25519PublicKeyBase64(): string {
    return Buffer.from(this.boxPublicKey).toString("base64");
  }

  /**
   * Signs a message using the in-enclave Ed25519 private key.
   * Returns a 64-byte Ed25519 signature.
   */
  public sign(message: Uint8Array): Uint8Array {
    return nacl.sign.detached(message, this.signSecretKey);
  }

  /**
   * Signs round settlement payload: (round_id_le_bytes [8 bytes] || 32_byte_seed)
   */
  public signSettle(roundId: bigint, seed: Uint8Array): Uint8Array {
    if (seed.length !== 32) {
      throw new Error("Seed must be exactly 32 bytes");
    }
    const msg = new Uint8Array(8 + 32);
    const view = new DataView(msg.buffer);
    view.setBigUint64(0, roundId, true); // Little-endian u64
    msg.set(seed, 8);
    return this.sign(msg);
  }

  /**
   * Decrypts a player pick encrypted via NaCl box (X25519 + XSalsa20Poly1305).
   * Compatible with @noble/ciphers and tweetnacl in the browser.
   */
  public decryptBox(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    senderPublicKey: Uint8Array
  ): Uint8Array | null {
    if (nonce.length !== 24) {
      return null;
    }
    if (senderPublicKey.length !== 32) {
      return null;
    }
    return nacl.box.open(ciphertext, nonce, senderPublicKey, this.boxSecretKey);
  }

  /**
   * Redact private keys from JSON serialization and console logs.
   */
  public toJSON() {
    return {
      nearPublicKey: this.nearPublicKey,
      x25519PublicKey: this.x25519PublicKeyBase64,
      signSecretKey: "[REDACTED_IN_TEE]",
      boxSecretKey: "[REDACTED_IN_TEE]",
    };
  }

  public toString() {
    return `EnclaveKeys(near=${this.nearPublicKey}, x25519=${this.x25519PublicKeyBase64})`;
  }
}
