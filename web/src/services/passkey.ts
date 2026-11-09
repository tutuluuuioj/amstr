import { KeyPair, connect, keyStores, utils } from "near-api-js";
import { sha256 } from "@noble/hashes/sha256";
import nacl from "tweetnacl";
import { CONFIG } from "../config";

export interface PasskeyAccount {
  accountId: string;
  credentialId: string;
  publicKey: string;
  createdAt: number;
}

const PASSKEY_STORAGE_KEY = "amstr_passkey_account";

/**
 * Derive deterministic, valid Ed25519 KeyPair from 32-byte seed material
 */
export function deriveNearKeyPairFromSeed(seed32Bytes: Uint8Array): KeyPair {
  const naclKp = nacl.sign.keyPair.fromSeed(seed32Bytes);
  const base58Secret = utils.serialize.base_encode(naclKp.secretKey);
  return KeyPair.fromString(`ed25519:${base58Secret}`);
}

class PasskeyService {
  private keyStore: keyStores.BrowserLocalStorageKeyStore;

  constructor() {
    this.keyStore = new keyStores.BrowserLocalStorageKeyStore();
  }

  /**
   * Check if the client device supports WebAuthn / Passkeys
   */
  public isPasskeySupported(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.PublicKeyCredential !== "undefined" &&
      typeof navigator.credentials !== "undefined"
    );
  }

  /**
   * Retrieve saved passkey account
   */
  public getSavedPasskeyAccount(): PasskeyAccount | null {
    try {
      const raw = localStorage.getItem(PASSKEY_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Register a new account using Touch ID / Face ID / WebAuthn Passkey
   */
  public async createPasskeyAccount(username?: string): Promise<PasskeyAccount> {
    if (!this.isPasskeySupported()) {
      throw new Error("Passkeys/WebAuthn are not supported on this browser or device.");
    }

    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const cleanUsername = username
      ? username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "")
      : `player_${Math.random().toString(36).substring(2, 8)}`;

    const accountId = `${cleanUsername}.testnet`;

    // Trigger native browser biometric registration (Touch ID / Face ID)
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name: "AMSTR Confidential Gaming",
          id: window.location.hostname || "localhost",
        },
        user: {
          id: new TextEncoder().encode(accountId),
          name: accountId,
          displayName: `AMSTR Player (${cleanUsername})`,
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" }, // ES256
          { alg: -257, type: "public-key" }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform", // Touch ID / Face ID / Windows Hello
          userVerification: "preferred",
          residentKey: "preferred",
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential;

    if (!credential) {
      throw new Error("Passkey registration cancelled or failed.");
    }

    const credentialId = credential.id;

    // Derive deterministic in-memory NEAR ed25519 keypair for the passkey session
    const seedMaterial = sha256(new TextEncoder().encode(`${credentialId}:${accountId}`));
    const keyPair = deriveNearKeyPairFromSeed(seedMaterial);
    const publicKey = keyPair.getPublicKey().toString();

    // Store in BrowserLocalStorageKeyStore for seamless RPC transaction execution
    await this.keyStore.setKey(CONFIG.NETWORK_ID, accountId, keyPair);

    const passkeyAccount: PasskeyAccount = {
      accountId,
      credentialId,
      publicKey,
      createdAt: Date.now(),
    };

    localStorage.setItem(PASSKEY_STORAGE_KEY, JSON.stringify(passkeyAccount));
    await this.ensureOnChainAccount(passkeyAccount);
    return passkeyAccount;
  }

  /**
   * Ensure the passkey account exists on NEAR Testnet blockchain.
   * If it does not exist yet, calls official NEAR Testnet Helper to create and fund it with 10 free NEAR!
   */
  public async ensureOnChainAccount(account: PasskeyAccount): Promise<boolean> {
    try {
      // 1. Check if account already exists on-chain
      const checkRes = await fetch("https://near-testnet.drpc.org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "check-acc",
          method: "query",
          params: {
            request_type: "view_account",
            finality: "final",
            account_id: account.accountId,
          },
        }),
      });
      const checkData = await checkRes.json();
      if (checkData.result?.amount) {
        return true;
      }

      // 2. Account does not exist on-chain: auto-create and fund via official NEAR Helper
      console.log(`[Passkey] Auto-creating on-chain account ${account.accountId}...`);
      const helperRes = await fetch("https://helper.testnet.near.org/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newAccountId: account.accountId,
          newAccountPublicKey: account.publicKey,
        }),
      });

      return helperRes.ok;
    } catch (err: any) {
      console.warn("ensureOnChainAccount notice:", err.message);
      return false;
    }
  }

  /**
   * Authenticate using an existing Passkey (Touch ID / Face ID)
   */
  public async loginWithPasskey(): Promise<PasskeyAccount> {
    if (!this.isPasskeySupported()) {
      throw new Error("Passkeys/WebAuthn are not supported on this browser or device.");
    }

    const saved = this.getSavedPasskeyAccount();
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const credential = (await navigator.credentials.get({
      publicKey: {
        challenge,
        timeout: 60000,
        userVerification: "preferred",
        rpId: window.location.hostname || "localhost",
        ...(saved?.credentialId
          ? {
              allowCredentials: [
                {
                  id: new TextEncoder().encode(saved.credentialId),
                  type: "public-key",
                },
              ],
            }
          : {}),
      },
    })) as PublicKeyCredential;

    if (!credential) {
      throw new Error("Passkey biometric verification failed or was cancelled.");
    }

    if (saved) {
      this.ensureOnChainAccount(saved).catch(() => {});
      return saved;
    }

    // Recover or generate deterministic account for newly authenticated device
    const accountId = `player_${credential.id.slice(0, 8)}.testnet`;
    const seedMaterial = sha256(new TextEncoder().encode(`${credential.id}:${accountId}`));
    const keyPair = deriveNearKeyPairFromSeed(seedMaterial);
    const publicKey = keyPair.getPublicKey().toString();

    await this.keyStore.setKey(CONFIG.NETWORK_ID, accountId, keyPair);

    const passkeyAccount: PasskeyAccount = {
      accountId,
      credentialId: credential.id,
      publicKey,
      createdAt: Date.now(),
    };

    localStorage.setItem(PASSKEY_STORAGE_KEY, JSON.stringify(passkeyAccount));
    await this.ensureOnChainAccount(passkeyAccount);
    return passkeyAccount;
  }

  /**
   * Log out and clear saved passkey session
   */
  public async logoutPasskey(accountId?: string): Promise<void> {
    if (accountId) {
      try {
        await this.keyStore.removeKey(CONFIG.NETWORK_ID, accountId);
      } catch {}
    }
    localStorage.removeItem(PASSKEY_STORAGE_KEY);
  }
}

export const passkeyService = new PasskeyService();
