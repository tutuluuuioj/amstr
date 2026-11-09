import { setupWalletSelector, WalletSelector, AccountState } from "@near-wallet-selector/core";
import { setupModal, WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { connect, keyStores, KeyPair } from "near-api-js";
import { CONFIG } from "../config";
import { parseNearToYocto, parseAmstrToYocto, nearRpc } from "./near";
import { sessionKeyService, SessionKeyState } from "./sessionKey";
import { passkeyService } from "./passkey";

const DEV_KEY = (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_DEV_PRIVATE_KEY) || "";

export interface WalletContextState {
  selector: WalletSelector | null;
  modal: WalletSelectorModal | null;
  accounts: AccountState[];
  accountId: string | null;
  isSessionActive?: boolean;
  sessionState?: SessionKeyState;
}

class WalletService {
  private selector: WalletSelector | null = null;
  private modal: WalletSelectorModal | null = null;
  private accounts: AccountState[] = [];
  private devAccountId: string | null = null;
  private listeners: ((state: WalletContextState) => void)[] = [];

  public async init(): Promise<WalletContextState> {
    const savedDev = localStorage.getItem("amstr_dev_account");
    if (savedDev) {
      this.devAccountId = savedDev;
    }

    // Auto-verify & fund Passkey account on-chain via official NEAR helper
    const passkeyAcc = passkeyService.getSavedPasskeyAccount();
    if (passkeyAcc) {
      passkeyService.ensureOnChainAccount(passkeyAcc).catch((e) => {
        console.warn("[Passkey Init] Auto-provision notice:", e.message);
      });
    }

    if (this.selector) {
      return this.getState();
    }

    try {
      this.selector = await setupWalletSelector({
        network: CONFIG.NETWORK_ID as any,
        modules: [
          setupMeteorWallet(),
          setupHereWallet(),
          setupMyNearWallet(),
        ],
      });

      this.modal = setupModal(this.selector, {
        contractId: CONFIG.CONTRACT_ID,
        description: "Connect your NEAR Testnet wallet to play AMSTR",
      });

      const state = this.selector.store.getState();
      this.accounts = state.accounts;

      this.selector.store.observable.subscribe((next) => {
        this.accounts = next.accounts;
        this.notify();
      });
    } catch (err) {
      console.warn("WalletSelector setup warning:", err);
    }

    return this.getState();
  }

  public connectDevAccount(accountId: string): void {
    this.devAccountId = accountId;
    localStorage.setItem("amstr_dev_account", accountId);
    this.notify();
  }

  public getState(): WalletContextState {
    const accountId =
      this.devAccountId ||
      this.accounts.find((a) => a.active)?.accountId ||
      this.accounts[0]?.accountId ||
      null;
    const sessionState = sessionKeyService.getSessionState(accountId);
    return {
      selector: this.selector,
      modal: this.modal,
      accounts: this.accounts,
      accountId,
      isSessionActive: sessionState.isActive,
      sessionState,
    };
  }

  public subscribe(cb: (state: WalletContextState) => void): () => void {
    this.listeners.push(cb);
    cb(this.getState());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notify(): void {
    const state = this.getState();
    for (const cb of this.listeners) {
      cb(state);
    }
  }

  public showModal(): void {
    if (this.modal) {
      this.modal.show();
    }
  }

  public async signInWithWallet(walletId: string = "meteor-wallet"): Promise<void> {
    if (this.devAccountId) {
      this.devAccountId = null;
      localStorage.removeItem("amstr_dev_account");
    }
    if (!this.selector) {
      this.showModal();
      return;
    }
    try {
      const wallet = await this.selector.wallet(walletId);
      await (wallet as any).signIn({
        contractId: CONFIG.CONTRACT_ID,
        methodNames: ["deploy", "claim", "reclaim_storage", "bind_referrer", "refund_expired"],
      });
    } catch (e: any) {
      console.warn("Direct wallet sign-in fallback to modal:", e);
      this.showModal();
    }
  }

  public async signOut(): Promise<void> {
    if (this.devAccountId) {
      this.devAccountId = null;
      localStorage.removeItem("amstr_dev_account");
      this.notify();
      return;
    }
    if (!this.selector) return;
    const wallet = await this.selector.wallet();
    await wallet.signOut();
  }

  /**
   * Check if an account has a local full access signing key (Passkey or Dev Account)
   */
  public isDirectLocalAccount(accountId?: string | null): boolean {
    const acc = accountId || this.getState().accountId;
    if (!acc) return false;
    if (this.devAccountId && acc === this.devAccountId) return true;
    if (passkeyService.getPasskeyKeyPair(acc) !== null) return true;
    return false;
  }

  private async getNearAccount(accountId: string) {
    const browserStore = new keyStores.BrowserLocalStorageKeyStore();
    
    // 1. If this is a Passkey account, ensure deterministic key is in browser keystore
    const passkeyKp = passkeyService.getPasskeyKeyPair(accountId);
    if (passkeyKp) {
      await browserStore.setKey(CONFIG.NETWORK_ID, accountId, passkeyKp);
      const nodeUrl = typeof window !== "undefined" && window.location.hostname === "localhost"
        ? `${window.location.origin}/api/near-rpc`
        : CONFIG.RPC_ENDPOINTS[0] || "https://near-testnet.drpc.org";

      const near = await connect({
        networkId: CONFIG.NETWORK_ID,
        keyStore: browserStore,
        nodeUrl,
      });
      return await near.account(accountId);
    }

    const keyPair = await browserStore.getKey(CONFIG.NETWORK_ID, accountId);

    const nodeUrl = typeof window !== "undefined" && window.location.hostname === "localhost"
      ? `${window.location.origin}/api/near-rpc`
      : CONFIG.RPC_ENDPOINTS[0] || "https://near-testnet.drpc.org";

    if (keyPair) {
      const near = await connect({
        networkId: CONFIG.NETWORK_ID,
        keyStore: browserStore,
        nodeUrl,
      });
      return await near.account(accountId);
    }

    // 2. Fallback to local dev private key
    if (DEV_KEY) {
      const memStore = new keyStores.InMemoryKeyStore();
      const kp = KeyPair.fromString(DEV_KEY);
      await memStore.setKey(CONFIG.NETWORK_ID, accountId, kp);
      const near = await connect({
        networkId: CONFIG.NETWORK_ID,
        keyStore: memStore,
        nodeUrl,
      });
      return await near.account(accountId);
    }

    throw new Error(`No signing key found for account ${accountId}. Please re-connect with Face ID / Touch ID or your NEAR wallet.`);
  }

  /**
   * Bind referrer before deploy
   */
  public async bindReferrer(referrerId: string): Promise<any> {
    const activeAccount = this.getState().accountId;
    if (this.isDirectLocalAccount(activeAccount)) {
      const accountId = activeAccount || this.devAccountId!;
      const account = await this.getNearAccount(accountId);
      return await account.functionCall({
        contractId: CONFIG.CONTRACT_ID,
        methodName: "bind_referrer",
        args: { referrer: referrerId },
        gas: 30000000000000n,
      });
    }

    if (!this.selector) throw new Error("Wallet selector not initialized");
    const wallet = await this.selector.wallet();

    return await wallet.signAndSendTransaction({
      receiverId: CONFIG.CONTRACT_ID,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "bind_referrer",
            args: { referrer: referrerId },
            gas: "30000000000000",
            deposit: "0",
          },
        },
      ],
    });
  }

  /**
   * Requirement 1 & 5: Place confidential bet
   * Checks attached deposit = stake + 0.01 NEAR entry storage
   */
  public async deploy(
    roundId: number,
    ciphertextBase64: string,
    commitBase64: string,
    stakeNear: number | string
  ): Promise<any> {
    const stakeYocto = BigInt(parseNearToYocto(stakeNear));
    const storageYocto = 10_000_000_000_000_000_000_000n; // 0.01 NEAR
    const totalDeposit = stakeYocto + storageYocto;
    const activeAccount = this.getState().accountId;

    // 1. Direct Local Execution (Passkey or Dev Account)
    // Instant 1-click execution with full access key, zero wallet popups!
    if (this.isDirectLocalAccount(activeAccount)) {
      const accountId = activeAccount || this.devAccountId!;
      console.log(`[Direct Local Deploy] Signing deploy for ${accountId} with local full access key`);
      const account = await this.getNearAccount(accountId);
      return await account.functionCall({
        contractId: CONFIG.CONTRACT_ID,
        methodName: "deploy",
        args: {
          round_id: roundId,
          ciphertext: ciphertextBase64,
          commit: commitBase64,
        },
        gas: 150000000000000n,
        attachedDeposit: totalDeposit as any,
      });
    }

    // 2. Standard Connected Wallet
    if (!this.selector) throw new Error("Wallet selector not initialized");
    const wallet = await this.selector.wallet();

    return await wallet.signAndSendTransaction({
      receiverId: CONFIG.CONTRACT_ID,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "deploy",
            args: {
              round_id: roundId,
              ciphertext: ciphertextBase64,
              commit: commitBase64,
            },
            gas: "150000000000000", // 150 TGas
            deposit: totalDeposit.toString(),
          },
        },
      ],
    });
  }

  private async executeTransaction(wallet: any, tx: { receiverId: string; actions: any[] }): Promise<any> {
    if (wallet.id === "meteor-wallet" && typeof wallet.signAndSendTransactions === "function") {
      try {
        const res = await wallet.signAndSendTransactions({ transactions: [tx] });
        return Array.isArray(res) ? res[0] : res;
      } catch (err: any) {
        console.warn("wallet.signAndSendTransactions fallback:", err);
      }
    }
    return await wallet.signAndSendTransaction(tx);
  }

  /**
   * Requirement 5: One-click claim for winners
   */
  public async claim(roundIds: number[]): Promise<any> {
    const activeAccount = this.getState().accountId;

    // 1. Direct Local Execution (Passkey or Dev Account)
    if (this.isDirectLocalAccount(activeAccount)) {
      const accountId = activeAccount || this.devAccountId!;
      console.log(`[Direct Local Claim] Signing claim for ${accountId} with local full access key`);
      const account = await this.getNearAccount(accountId);
      return await account.functionCall({
        contractId: CONFIG.CONTRACT_ID,
        methodName: "claim",
        args: { round_ids: roundIds },
        gas: 250000000000000n,
      });
    }

    // 2. 1-Click Session Key: Instant background signing with ZERO wallet popups (for standard wallets)
    if (activeAccount && sessionKeyService.getSessionState(activeAccount).isActive) {
      try {
        console.log(`[1-Click Session] Signing claim with session key for ${activeAccount}`);
        return await sessionKeyService.executeWithSessionKey(
          activeAccount,
          "claim",
          { round_ids: roundIds },
          250000000000000n,
          0n
        );
      } catch (err: any) {
        console.warn("[1-Click Session] Claim fallback to connected wallet:", err.message);
      }
    }

    if (!this.selector) throw new Error("Wallet selector not initialized");
    const wallet = await this.selector.wallet();

    // Ensure recipient is registered on the AMSTR fungible token contract so FT transfers succeed
    if (activeAccount) {
      try {
        const storageBal = await nearRpc.callViewFunction<any>(
          CONFIG.TOKEN_CONTRACT_ID,
          "storage_balance_of",
          { account_id: activeAccount }
        );
        if (!storageBal) {
          console.log(`Registering token storage for ${activeAccount}...`);
          await this.executeTransaction(wallet, {
            receiverId: CONFIG.TOKEN_CONTRACT_ID,
            actions: [
              {
                type: "FunctionCall",
                params: {
                  methodName: "storage_deposit",
                  args: { account_id: activeAccount, registration_only: true },
                  gas: "30000000000000",
                  deposit: "1250000000000000000000", // 0.00125 NEAR
                },
              },
            ],
          });
        }
      } catch (e) {
        console.warn("Token storage pre-check notice:", e);
      }
    }

    return await this.executeTransaction(wallet, {
      receiverId: CONFIG.CONTRACT_ID,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "claim",
            args: { round_ids: roundIds },
            gas: "250000000000000", // 250 TGas
            deposit: "0",
          },
        },
      ],
    });
  }

  /**
   * Requirement 5: One-click storage reclaim for losers
   */
  public async reclaimStorage(roundIds: number[]): Promise<any> {
    const activeAccount = this.getState().accountId;
    if (this.isDirectLocalAccount(activeAccount)) {
      const accountId = activeAccount || this.devAccountId!;
      const account = await this.getNearAccount(accountId);
      return await account.functionCall({
        contractId: CONFIG.CONTRACT_ID,
        methodName: "reclaim_storage",
        args: { round_ids: roundIds },
        gas: 150000000000000n,
      });
    }

    if (!this.selector) throw new Error("Wallet selector not initialized");
    const wallet = await this.selector.wallet();

    return await this.executeTransaction(wallet, {
      receiverId: CONFIG.CONTRACT_ID,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "reclaim_storage",
            args: { round_ids: roundIds },
            gas: "150000000000000",
            deposit: "0",
          },
        },
      ],
    });
  }

  /**
   * Requirement 5: One-click refund for expired rounds
   */
  public async refundExpired(roundId: number, limit = 50): Promise<any> {
    const activeAccount = this.getState().accountId;
    if (this.isDirectLocalAccount(activeAccount)) {
      const accountId = activeAccount || this.devAccountId!;
      const account = await this.getNearAccount(accountId);
      return await account.functionCall({
        contractId: CONFIG.CONTRACT_ID,
        methodName: "refund_expired",
        args: { round_id: roundId, limit },
        gas: 200000000000000n,
      });
    }

    if (!this.selector) throw new Error("Wallet selector not initialized");
    const wallet = await this.selector.wallet();

    return await this.executeTransaction(wallet, {
      receiverId: CONFIG.CONTRACT_ID,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "refund_expired",
            args: { round_id: roundId, limit },
            gas: "200000000000000",
            deposit: "0",
          },
        },
      ],
    });
  }

  /**
   * Staking: ft_transfer_call on AMSTR token contract to staking contract
   */
  public async stake(amountAmstr: string): Promise<any> {
    const yocto = parseAmstrToYocto(amountAmstr);
    if (BigInt(yocto) <= 0n) throw new Error("Amount must be greater than 0");

    const activeAccount = this.getState().accountId;
    if (this.isDirectLocalAccount(activeAccount)) {
      const accountId = activeAccount || this.devAccountId!;
      const account = await this.getNearAccount(accountId);
      return await account.functionCall({
        contractId: CONFIG.TOKEN_CONTRACT_ID,
        methodName: "ft_transfer_call",
        args: {
          receiver_id: CONFIG.STAKING_CONTRACT_ID,
          amount: yocto,
          msg: "",
        },
        gas: 60000000000000n, // 60 TGas
        attachedDeposit: 1n, // 1 yoctoNEAR required by NEP-141
      });
    }

    if (!this.selector) throw new Error("Wallet selector not initialized");
    const wallet = await this.selector.wallet();

    return await this.executeTransaction(wallet, {
      receiverId: CONFIG.TOKEN_CONTRACT_ID,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "ft_transfer_call",
            args: {
              receiver_id: CONFIG.STAKING_CONTRACT_ID,
              amount: yocto,
              msg: "",
            },
            gas: "60000000000000",
            deposit: "1",
          },
        },
      ],
    });
  }

  /**
   * Unstaking: unstake(amount) on staking contract
   */
  public async unstake(amountAmstr: string): Promise<any> {
    const yocto = parseAmstrToYocto(amountAmstr);
    if (BigInt(yocto) <= 0n) throw new Error("Amount must be greater than 0");

    const activeAccount = this.getState().accountId;
    if (this.isDirectLocalAccount(activeAccount)) {
      const accountId = activeAccount || this.devAccountId!;
      const account = await this.getNearAccount(accountId);
      return await account.functionCall({
        contractId: CONFIG.STAKING_CONTRACT_ID,
        methodName: "unstake",
        args: { amount: yocto },
        gas: 60000000000000n,
        attachedDeposit: 0n,
      });
    }

    if (!this.selector) throw new Error("Wallet selector not initialized");
    const wallet = await this.selector.wallet();

    return await this.executeTransaction(wallet, {
      receiverId: CONFIG.STAKING_CONTRACT_ID,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "unstake",
            args: { amount: yocto },
            gas: "60000000000000",
            deposit: "0",
          },
        },
      ],
    });
  }

  /**
   * Claim Yield: claim_rewards() on staking contract
   */
  public async claimStakingYield(): Promise<any> {
    const activeAccount = this.getState().accountId;
    if (this.isDirectLocalAccount(activeAccount)) {
      const accountId = activeAccount || this.devAccountId!;
      const account = await this.getNearAccount(accountId);
      return await account.functionCall({
        contractId: CONFIG.STAKING_CONTRACT_ID,
        methodName: "claim_rewards",
        args: {},
        gas: 60000000000000n,
        attachedDeposit: 0n,
      });
    }

    if (!this.selector) throw new Error("Wallet selector not initialized");
    const wallet = await this.selector.wallet();

    return await this.executeTransaction(wallet, {
      receiverId: CONFIG.STAKING_CONTRACT_ID,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "claim_rewards",
            args: {},
            gas: "60000000000000",
            deposit: "0",
          },
        },
      ],
    });
  }

  /**
   * MCP Agent Helper: Fund an implicit or sub-account for autonomous agent betting
   */
  public async fundAgentAccount(targetAccountId: string, amountNear: string | number): Promise<any> {
    const yocto = parseNearToYocto(amountNear);
    const activeAccount = this.getState().accountId;
    if (this.isDirectLocalAccount(activeAccount)) {
      const accountId = activeAccount || this.devAccountId!;
      const account = await this.getNearAccount(accountId);
      return await account.sendMoney(targetAccountId, BigInt(yocto));
    }
    if (!this.selector) throw new Error("Wallet not connected");
    const wallet = await this.selector.wallet();
    return await this.executeTransaction(wallet, {
      receiverId: targetAccountId,
      actions: [
        {
          type: "Transfer",
          params: {
            deposit: yocto,
          },
        },
      ],
    });
  }

  /**
   * MCP Agent Helper: Add Full Access Key directly to connected wallet account
   */
  public async addAgentKeyToAccount(publicKeyStr: string): Promise<any> {
    const accountId = this.getState().accountId;
    if (!accountId) throw new Error("Wallet not connected");
    if (this.isDirectLocalAccount(accountId)) {
      const targetId = accountId || this.devAccountId!;
      const account = await this.getNearAccount(targetId);
      return await account.addKey(publicKeyStr);
    }
    if (!this.selector) throw new Error("Wallet not connected");
    const wallet = await this.selector.wallet();
    return await this.executeTransaction(wallet, {
      receiverId: accountId,
      actions: [
        {
          type: "AddKey",
          params: {
            publicKey: publicKeyStr,
            accessKey: {
              permission: "FullAccess",
            },
          },
        },
      ],
    });
  }

  /**
   * Chain Abstraction: Enable 1-Click Session Keys (No wallet popups for bets/claims)
   */
  public async enableSessionKey(durationHours = 24, allowanceNear = "5"): Promise<string> {
    const accountId = this.getState().accountId;
    if (!accountId) throw new Error("Please connect a wallet first to authorize 1-Click Fast Play.");

    const { publicKey } = await sessionKeyService.createSessionKeyPair(
      accountId,
      durationHours,
      allowanceNear
    );

    if (this.isDirectLocalAccount(accountId)) {
      try {
        const targetId = accountId || this.devAccountId!;
        const account = await this.getNearAccount(targetId);
        await account.addKey(
          publicKey,
          CONFIG.CONTRACT_ID,
          ["deploy", "claim"],
          BigInt(parseNearToYocto(allowanceNear))
        );
      } catch (err: any) {
        console.warn("Direct account addKey notice:", err.message);
      }
      this.notify();
      return publicKey;
    }

    if (!this.selector) throw new Error("Wallet not connected");
    const wallet = await this.selector.wallet();

    await this.executeTransaction(wallet, {
      receiverId: accountId,
      actions: [
        {
          type: "AddKey",
          params: {
            publicKey,
            accessKey: {
              allowance: parseNearToYocto(allowanceNear),
              receiverId: CONFIG.CONTRACT_ID,
              methodNames: ["deploy", "claim"],
            },
          },
        },
      ],
    });

    this.notify();
    return publicKey;
  }

  /**
   * Chain Abstraction: Disable and clear local session key
   */
  public async disableSessionKey(): Promise<void> {
    const accountId = this.getState().accountId;
    if (accountId) {
      await sessionKeyService.clearSession(accountId);
      this.notify();
    }
  }

  /**
   * Chain Abstraction: Connect using WebAuthn / Biometric Passkey (Touch ID / Face ID)
   */
  public async connectWithPasskey(username?: string): Promise<string> {
    const passkeyAcc = await passkeyService.createPasskeyAccount(username);
    this.devAccountId = passkeyAcc.accountId;
    localStorage.setItem("amstr_dev_account", passkeyAcc.accountId);
    await passkeyService.ensureKeyInKeyStore(passkeyAcc.accountId);
    await sessionKeyService.createSessionKeyPair(passkeyAcc.accountId, 48, "10");
    this.notify();
    return passkeyAcc.accountId;
  }

  /**
   * Chain Abstraction: Authenticate with existing Biometric Passkey
   */
  public async loginWithPasskey(): Promise<string> {
    const passkeyAcc = await passkeyService.loginWithPasskey();
    this.devAccountId = passkeyAcc.accountId;
    localStorage.setItem("amstr_dev_account", passkeyAcc.accountId);
    await passkeyService.ensureKeyInKeyStore(passkeyAcc.accountId);
    await sessionKeyService.createSessionKeyPair(passkeyAcc.accountId, 48, "10");
    this.notify();
    return passkeyAcc.accountId;
  }

  /**
   * Chain Abstraction: Relay transaction through Keeper Gasless Relayer
   */
  public async relayCallViaKeeper(
    contractId: string,
    methodName: string,
    args: Record<string, any>,
    depositYocto = "0"
  ): Promise<any> {
    const accountId = this.getState().accountId;
    if (!accountId) throw new Error("Account not connected");

    const keeperUrl = CONFIG.KEEPER_URL || "https://amstr-keeper.fly.dev";
    const res = await fetch(`${keeperUrl}/relayer/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        account_id: accountId,
        contract_id: contractId,
        method_name: methodName,
        args,
        deposit: depositYocto,
        gas_tgas: 150,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Gasless relayer execution failed.");
    }
    return data;
  }
}

export const walletService = new WalletService();
