import React, { useState } from "react";
import { X, Wallet, UserCheck, ExternalLink, Sparkles, Fingerprint, Zap, Loader2, ShieldCheck } from "lucide-react";
import { walletService } from "../services/wallet";
import { passkeyService } from "../services/passkey";
import { CONFIG } from "../config";

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export type WalletModalTab = "solana" | "evm" | "near";

export const WalletModal: React.FC<WalletModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<WalletModalTab>("solana");
  const [loadingPasskey, setLoadingPasskey] = useState(false);
  const [loadingWallet, setLoadingWallet] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConnectPhantom = async () => {
    setLoadingWallet(true);
    setErrorMsg(null);
    try {
      const provider = (window as any).solana;
      if (!provider || !provider.isPhantom) {
        window.open("https://phantom.app/", "_blank");
        setErrorMsg("Phantom wallet extension not detected. Opening phantom.app download...");
        return;
      }
      const resp = await provider.connect();
      const solAddress = resp.publicKey.toString();
      walletService.connectSolanaWallet(solAddress);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to connect Phantom wallet");
    } finally {
      setLoadingWallet(false);
    }
  };

  const handleConnectSolflare = async () => {
    setLoadingWallet(true);
    setErrorMsg(null);
    try {
      const provider = (window as any).solflare || (window as any).solana;
      if (!provider) {
        window.open("https://solflare.com/", "_blank");
        setErrorMsg("Solflare wallet extension not detected. Opening solflare.com download...");
        return;
      }
      await provider.connect();
      const solAddress = provider.publicKey.toString();
      walletService.connectSolanaWallet(solAddress);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to connect Solflare wallet");
    } finally {
      setLoadingWallet(false);
    }
  };

  const handleConnectMetaMask = async () => {
    setLoadingWallet(true);
    setErrorMsg(null);
    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) {
        window.open("https://metamask.io/download/", "_blank");
        setErrorMsg("MetaMask or Web3 extension not detected. Opening metamask.io...");
        return;
      }
      const accounts = await ethereum.request({ method: "eth_requestAccounts" });
      if (accounts && accounts[0]) {
        walletService.connectEvmWallet(accounts[0]);
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to connect EVM wallet");
    } finally {
      setLoadingWallet(false);
    }
  };

  const handleSelectDev = (accountId: string) => {
    walletService.connectDevAccount(accountId);
    onClose();
  };

  const handleSelectMeteorWallet = async () => {
    onClose();
    await walletService.signInWithWallet("meteor-wallet");
  };

  const handleOpenWalletSelector = () => {
    onClose();
    walletService.showModal();
  };

  const handlePasskeyAuth = async () => {
    setLoadingPasskey(true);
    setErrorMsg(null);
    try {
      const saved = passkeyService.getSavedPasskeyAccount();
      if (saved) {
        await walletService.loginWithPasskey();
      } else {
        await walletService.connectWithPasskey();
      }
      onClose();
    } catch (err: any) {
      console.warn("Passkey auth error:", err);
      const msg = err.message || "";
      if (msg.includes("NotAllowedError") || msg.includes("cancelled")) {
        setErrorMsg("Biometric verification cancelled or timed out.");
      } else {
        setErrorMsg(msg || "Passkey biometric authentication failed.");
      }
    } finally {
      setLoadingPasskey(false);
    }
  };

  const handleInstantGuest = async () => {
    const guestId = `guest_${Math.random().toString(36).substring(2, 7)}.testnet`;
    walletService.connectDevAccount(guestId);
    try {
      await walletService.enableSessionKey(24, "5");
    } catch {}
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 flex items-center justify-center p-4">
      <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm max-w-sm w-full p-6 shadow-2xl relative space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#2A2620]">
          <div>
            <h2 className="font-fraunces text-lg font-bold text-[#EDE6DA]">
              Connect Wallet
            </h2>
            <p className="text-xs text-[#8C8478] mt-0.5">
              Choose your native blockchain ecosystem
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[#8C8478] hover:text-[#EDE6DA] p-1 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 3 Chain Selector Tabs */}
        <div className="grid grid-cols-3 gap-1 p-1 bg-[#0E0D0B] border border-[#2A2620] rounded-sm text-xs font-mono">
          <button
            type="button"
            onClick={() => { setActiveTab("solana"); setErrorMsg(null); }}
            className={`py-2 px-1 rounded-sm transition-all flex items-center justify-center space-x-1.5 ${
              activeTab === "solana"
                ? "bg-[#9945FF]/20 border border-[#9945FF] text-[#EDE6DA] font-bold shadow-sm"
                : "text-[#8C8478] hover:text-[#EDE6DA] border border-transparent"
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[#9945FF]"></span>
            <span>Solana</span>
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab("evm"); setErrorMsg(null); }}
            className={`py-2 px-1 rounded-sm transition-all flex items-center justify-center space-x-1.5 ${
              activeTab === "evm"
                ? "bg-[#0052FF]/20 border border-[#0052FF] text-[#EDE6DA] font-bold shadow-sm"
                : "text-[#8C8478] hover:text-[#EDE6DA] border border-transparent"
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[#0052FF]"></span>
            <span>EVM</span>
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab("near"); setErrorMsg(null); }}
            className={`py-2 px-1 rounded-sm transition-all flex items-center justify-center space-x-1.5 ${
              activeTab === "near"
                ? "bg-[#22C55E]/20 border border-[#22C55E] text-[#EDE6DA] font-bold shadow-sm"
                : "text-[#8C8478] hover:text-[#EDE6DA] border border-transparent"
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[#22C55E]"></span>
            <span>NEAR</span>
          </button>
        </div>

        {errorMsg && (
          <div className="p-2.5 rounded-sm bg-red-950/40 border border-red-800/60 text-red-200 text-xs">
            {errorMsg}
          </div>
        )}

        {/* Tab 1: Solana Wallets */}
        {activeTab === "solana" && (
          <div className="space-y-2.5">
            <button
              onClick={handleConnectPhantom}
              disabled={loadingWallet}
              className="w-full flex items-center justify-between p-3 rounded-sm bg-[#0E0D0B] border border-[#9945FF]/60 hover:border-[#9945FF] bg-[#9945FF]/5 transition-colors text-left group"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-sm bg-[#9945FF]/20 border border-[#9945FF]/50 flex items-center justify-center text-[#9945FF] font-bold">
                  {loadingWallet ? <Loader2 className="w-4 h-4 animate-spin" /> : "👻"}
                </div>
                <div>
                  <div className="text-xs font-mono font-bold text-[#EDE6DA] group-hover:text-[#9945FF] transition-colors flex items-center space-x-1.5">
                    <span>Phantom Wallet</span>
                    <span className="text-[10px] uppercase font-sans tracking-wider px-1.5 py-0.2 rounded-sm bg-[#9945FF]/20 text-[#9945FF] font-bold">
                      Popular
                    </span>
                  </div>
                  <div className="text-[11px] text-[#8C8478]">Connect Phantom on Solana Devnet</div>
                </div>
              </div>
              <span className="text-[11px] font-mono text-[#9945FF] font-medium">Connect →</span>
            </button>

            <button
              onClick={handleConnectSolflare}
              disabled={loadingWallet}
              className="w-full flex items-center justify-between p-3 rounded-sm bg-[#0E0D0B] border border-[#2A2620] hover:border-[#9945FF] transition-colors text-left group"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-sm bg-[#2A2620]/40 border border-[#2A2620] flex items-center justify-center text-[#EDE6DA] font-bold">
                  ☀️
                </div>
                <div>
                  <div className="text-xs font-mono font-bold text-[#EDE6DA] group-hover:text-[#9945FF] transition-colors">
                    Solflare / Other Solana
                  </div>
                  <div className="text-[11px] text-[#8C8478]">Connect any Solana browser wallet</div>
                </div>
              </div>
              <span className="text-[11px] font-mono text-[#8C8478] group-hover:text-[#EDE6DA]">Connect →</span>
            </button>

            <div className="p-2.5 rounded-sm bg-[#0E0D0B] border border-[#2A2620] text-[11px] text-[#8C8478] space-y-1">
              <div className="flex items-center space-x-1.5 text-[#9945FF] font-bold">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Zero NEAR Needed</span>
              </div>
              <p>
                Connect your Solana wallet to bet with SOL and claim winnings directly on Solana. NEAR is used purely as a decentralized settlement engine.
              </p>
            </div>
          </div>
        )}

        {/* Tab 2: EVM Wallets */}
        {activeTab === "evm" && (
          <div className="space-y-2.5">
            <button
              onClick={handleConnectMetaMask}
              disabled={loadingWallet}
              className="w-full flex items-center justify-between p-3 rounded-sm bg-[#0E0D0B] border border-[#0052FF]/60 hover:border-[#0052FF] bg-[#0052FF]/5 transition-colors text-left group"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-sm bg-[#0052FF]/20 border border-[#0052FF]/50 flex items-center justify-center text-[#0052FF] font-bold">
                  {loadingWallet ? <Loader2 className="w-4 h-4 animate-spin" /> : "🦊"}
                </div>
                <div>
                  <div className="text-xs font-mono font-bold text-[#EDE6DA] group-hover:text-[#0052FF] transition-colors flex items-center space-x-1.5">
                    <span>MetaMask / Injected</span>
                    <span className="text-[10px] uppercase font-sans tracking-wider px-1.5 py-0.2 rounded-sm bg-[#0052FF]/20 text-[#0052FF] font-bold">
                      Base / ETH
                    </span>
                  </div>
                  <div className="text-[11px] text-[#8C8478]">Connect MetaMask, Coinbase, or Rabby</div>
                </div>
              </div>
              <span className="text-[11px] font-mono text-[#0052FF] font-medium">Connect →</span>
            </button>

            <div className="p-2.5 rounded-sm bg-[#0E0D0B] border border-[#2A2620] text-[11px] text-[#8C8478] space-y-1">
              <div className="flex items-center space-x-1.5 text-[#0052FF] font-bold">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Zero NEAR Needed</span>
              </div>
              <p>
                Connect your EVM wallet to bet with ETH on Base and receive payouts directly to your EVM address via NEAR Chain Signatures.
              </p>
            </div>
          </div>
        )}

        {/* Tab 3: Native NEAR Options */}
        {activeTab === "near" && (
          <div className="space-y-2.5">
            {/* Option 0: Passkey / Biometrics */}
            <button
              onClick={handlePasskeyAuth}
              disabled={loadingPasskey}
              className="w-full flex items-center justify-between p-3 rounded-sm bg-[#0E0D0B] border border-[#22C55E]/60 hover:border-[#22C55E] bg-[#22C55E]/5 transition-colors text-left group"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-sm bg-[#22C55E]/20 border border-[#22C55E]/50 flex items-center justify-center text-[#22C55E]">
                  {loadingPasskey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
                </div>
                <div>
                  <div className="text-xs font-mono font-bold text-[#EDE6DA] group-hover:text-[#22C55E] transition-colors flex items-center space-x-1.5">
                    <span>Face ID / Touch ID</span>
                    <span className="text-[10px] uppercase font-sans tracking-wider px-1.5 py-0.2 rounded-sm bg-[#22C55E]/20 text-[#22C55E] font-bold">
                      Zero Seed Phrase
                    </span>
                  </div>
                  <div className="text-[11px] text-[#8C8478]">WebAuthn Passkey • 1-Click Biometric Login</div>
                </div>
              </div>
              <span className="text-[11px] font-mono text-[#22C55E] font-medium">Play →</span>
            </button>

            {/* Option 0.5: Instant 1-Click Guest Play */}
            <button
              onClick={handleInstantGuest}
              className="w-full flex items-center justify-between p-3 rounded-sm bg-[#0E0D0B] border border-[#C8763A]/40 hover:border-[#C8763A] bg-[#C8763A]/5 transition-colors text-left group"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-sm bg-[#C8763A]/20 border border-[#C8763A]/50 flex items-center justify-center text-[#C8763A]">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-mono font-bold text-[#EDE6DA] group-hover:text-[#C8763A] transition-colors flex items-center space-x-1.5">
                    <span>1-Click Instant Guest</span>
                    <span className="text-[10px] uppercase font-sans tracking-wider px-1.5 py-0.2 rounded-sm bg-[#C8763A]/20 text-[#C8763A]">
                      Instant Start
                    </span>
                  </div>
                  <div className="text-[11px] text-[#8C8478]">Auto-provisioned session • Zero setup</div>
                </div>
              </div>
              <span className="text-[11px] font-mono text-[#C8763A] font-medium">Start →</span>
            </button>

            {/* Option 1: Meteor Wallet */}
            <button
              onClick={handleSelectMeteorWallet}
              className="w-full flex items-center justify-between p-3 rounded-sm bg-[#0E0D0B] border border-[#C8763A]/60 hover:border-[#C8763A] bg-[#C8763A]/5 transition-colors text-left group"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-sm bg-[#C8763A]/20 border border-[#C8763A]/50 flex items-center justify-center text-[#C8763A]">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-mono font-bold text-[#EDE6DA] group-hover:text-[#C8763A] transition-colors flex items-center space-x-1.5">
                    <span>Meteor Wallet</span>
                    <span className="text-[10px] uppercase font-sans tracking-wider px-1.5 py-0.2 rounded-sm bg-[#C8763A]/20 text-[#C8763A]">
                      Recommended
                    </span>
                  </div>
                  <div className="text-[11px] text-[#8C8478]">Chrome Extension & Web Wallet</div>
                </div>
              </div>
              <span className="text-[11px] font-mono text-[#C8763A] font-medium">Connect →</span>
            </button>

            {/* Option 2: Open All NEAR Wallets */}
            <button
              onClick={handleOpenWalletSelector}
              className="w-full flex items-center justify-between p-3 rounded-sm bg-[#0E0D0B] border border-[#2A2620] hover:border-[#8C8478] transition-colors text-left group"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-sm bg-[#2A2620]/40 border border-[#2A2620] flex items-center justify-center text-[#8C8478]">
                  <Wallet className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-medium text-[#EDE6DA]">
                    All NEAR Wallets
                  </div>
                  <div className="text-[11px] text-[#8C8478]">Meteor, Here, MyNearWallet</div>
                </div>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-[#8C8478]" />
            </button>

            {/* Dev accounts - Gated behind CONFIG.ENABLE_DEV_ACCOUNTS (?dev=true) */}
            {CONFIG.ENABLE_DEV_ACCOUNTS && (
              <>
                <div className="pt-2 pb-1">
                  <div className="text-[10px] uppercase tracking-wider text-[#8C8478] font-bold text-center">
                    Dev Only: 1-Click Funded Accounts
                  </div>
                </div>

                <button
                  onClick={() => handleSelectDev("alice.amstr-admin-zxlhcx.testnet")}
                  className="w-full flex items-center justify-between p-3 rounded-sm bg-[#0E0D0B] border border-[#2A2620] hover:border-[#5FA88A] transition-colors text-left group"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-sm bg-[#5FA88A]/10 border border-[#5FA88A]/40 flex items-center justify-center text-[#5FA88A]">
                      <UserCheck className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-mono font-bold text-[#EDE6DA] group-hover:text-[#5FA88A] transition-colors">
                        alice.amstr-admin-zxlhcx.testnet
                      </div>
                      <div className="text-[11px] text-[#8C8478]">Instant 1-Click • Funded Testnet</div>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-[#5FA88A] font-medium">Play →</span>
                </button>

                <button
                  onClick={() => handleSelectDev("bob.amstr-admin-zxlhcx.testnet")}
                  className="w-full flex items-center justify-between p-3 rounded-sm bg-[#0E0D0B] border border-[#2A2620] hover:border-[#5FA88A] transition-colors text-left group"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-sm bg-[#5FA88A]/10 border border-[#5FA88A]/40 flex items-center justify-center text-[#5FA88A]">
                      <UserCheck className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-mono font-bold text-[#EDE6DA] group-hover:text-[#5FA88A] transition-colors">
                        bob.amstr-admin-zxlhcx.testnet
                      </div>
                      <div className="text-[11px] text-[#8C8478]">Instant 1-Click • Funded Testnet</div>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-[#5FA88A] font-medium">Play →</span>
                </button>
              </>
            )}
          </div>
        )}

        <div className="text-[11px] text-[#8C8478] text-center pt-1 border-t border-[#2A2620]">
          Connect your native wallet directly — AMSTR abstracts cross-chain execution automatically.
        </div>
      </div>
    </div>
  );
};
