import { KeyPair, connect, keyStores, transactions, utils } from "near-api-js";
import { CONFIG } from "../config";
import { nearRpc } from "./near";

export interface SessionKeyState {
  isActive: boolean;
  accountId: string | null;
  publicKey: string | null;
  createdAt: number | null;
  expiresAt: number | null;
  allowanceNear: string | null;
  remainingAllowanceYocto?: string | null;
}

const STORAGE_PREFIX = "amstr_session_key_";

class SessionKeyService {
  private keyStore: keyStores.BrowserLocalStorageKeyStore;
  private listeners: ((state: SessionKeyState) => void)[] = [];

  constructor() {
    this.keyStore = new keyStores.BrowserLocalStorageKeyStore();
  }

  /**
   * Get storage key for the given account
   */
  private getStorageKey(accountId: string): string {
    return `${STORAGE_PREFIX}${accountId}`;
  }

  /**
   * Retrieve active session key metadata from local storage
   */
  public getSessionState(accountId: string | null): SessionKeyState {
    if (!accountId) {
      return {
        isActive: false,
        accountId: null,
        publicKey: null,
        createdAt: null,
        expiresAt: null,
        allowanceNear: null,
      };
    }

    try {
      const raw = localStorage.getItem(this.getStorageKey(accountId));
      if (!raw) {
        return {
          isActive: false,
          accountId,
          publicKey: null,
          createdAt: null,
          expiresAt: null,
          allowanceNear: null,
        };
      }

      const parsed = JSON.parse(raw);
      const isExpired = parsed.expiresAt && Date.now() > parsed.expiresAt;
      return {
        isActive: !isExpired && Boolean(parsed.publicKey),
        accountId,
        publicKey: parsed.publicKey,
        createdAt: parsed.createdAt,
        expiresAt: parsed.expiresAt,
        allowanceNear: parsed.allowanceNear || "5",
      };
    } catch {
      return {
        isActive: false,
        accountId,
        publicKey: null,
        createdAt: null,
        expiresAt: null,
        allowanceNear: null,
      };
    }
  }

  /**
   * Check if on-chain access key actually exists for this session key
   */
  public async verifyOnChainSessionKey(accountId: string): Promise<boolean> {
    const state = this.getSessionState(accountId);
    if (!state.isActive || !state.publicKey) return false;

    try {
      const accessKeys = await nearRpc.getAccessKeys(accountId);
      const match = accessKeys.find((k: any) => k.public_key === state.publicKey);
      if (!match) {
        // Key was removed on chain
        this.clearSession(accountId);
        return false;
      }
      return true;
    } catch (err) {
      console.warn("verifyOnChainSessionKey error:", err);
      return false;
    }
  }

  /**
   * Create a new ephemeral session keypair for the account
   */
  public async createSessionKeyPair(
    accountId: string,
    durationHours = 24,
    allowanceNear = "5"
  ): Promise<{ keyPair: KeyPair; publicKey: string }> {
    const keyPair = KeyPair.fromRandom("ed25519");
    const publicKey = keyPair.getPublicKey().toString();

    // Store in BrowserLocalStorageKeyStore for near-api-js usage
    await this.keyStore.setKey(CONFIG.NETWORK_ID, accountId, keyPair);

    const now = Date.now();
    const expiresAt = now + durationHours * 3600 * 1000;

    const meta = {
      publicKey,
      createdAt: now,
      expiresAt,
      allowanceNear,
      networkId: CONFIG.NETWORK_ID,
    };

    localStorage.setItem(this.getStorageKey(accountId), JSON.stringify(meta));
    this.notify(this.getSessionState(accountId));

    return { keyPair, publicKey };
  }

  /**
   * Sign and execute a contract method directly using the local session key
   * Completely bypasses wallet popups and confirmations!
   */
  public async executeWithSessionKey(
    accountId: string,
    methodName: string,
    args: Record<string, any>,
    gas = 150000000000000n, // 150 TGas
    attachedDeposit = 0n
  ): Promise<any> {
    const state = this.getSessionState(accountId);
    if (!state.isActive || !state.publicKey) {
      throw new Error("No active 1-Click Session key found. Please enable 1-Click Fast Play.");
    }

    const keyPair = await this.keyStore.getKey(CONFIG.NETWORK_ID, accountId);
    if (!keyPair) {
      throw new Error("Local session private key missing from secure browser storage.");
    }

    const near = await connect({
      networkId: CONFIG.NETWORK_ID,
      nodeUrl: CONFIG.RPC_ENDPOINTS[0] || "https://near-testnet.drpc.org",
      keyStore: this.keyStore,
    });

    const account = await near.account(accountId);
    return await account.functionCall({
      contractId: CONFIG.CONTRACT_ID,
      methodName,
      args,
      gas,
      attachedDeposit: attachedDeposit as any,
    });
  }

  /**
   * Clear and revoke local session key
   */
  public async clearSession(accountId: string): Promise<void> {
    try {
      await this.keyStore.removeKey(CONFIG.NETWORK_ID, accountId);
    } catch {}
    localStorage.removeItem(this.getStorageKey(accountId));
    this.notify(this.getSessionState(accountId));
  }

  /**
   * Subscribe to session state updates
   */
  public subscribe(accountId: string | null, cb: (state: SessionKeyState) => void): () => void {
    this.listeners.push(cb);
    cb(this.getSessionState(accountId));
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notify(state: SessionKeyState): void {
    for (const cb of this.listeners) {
      cb(state);
    }
  }
}

export const sessionKeyService = new SessionKeyService();
