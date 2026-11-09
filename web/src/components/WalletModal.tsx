import React, { useState } from "react";
import { X, Wallet, UserCheck, ExternalLink, Sparkles, Fingerprint, Zap, Loader2 } from "lucide-react";
import { walletService } from "../services/wallet";
import { CONFIG } from "../config";

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const WalletModal: React.FC<WalletModalProps> = ({ isOpen, onClose }) => {
  const [loadingPasskey, setLoadingPasskey] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

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
      try {
        await walletService.loginWithPasskey();
      } catch (loginErr: any) {
        // If login failed or no existing passkey, create a fresh passkey account
        await walletService.connectWithPasskey();
      }
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Passkey biometric authentication failed.");
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
      <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm max-w-sm w-full p-6 shadow-2xl relative space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#2A2620]">
          <div>
            <h2 className="font-fraunces text-lg font-bold text-[#EDE6DA]">
              Connect Wallet
            </h2>
            <p className="text-xs text-[#8C8478] mt-0.5">
              Select your NEAR Testnet account or wallet
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[#8C8478] hover:text-[#EDE6DA] p-1 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="p-2.5 rounded-sm bg-red-950/40 border border-red-800/60 text-red-200 text-xs">
            {errorMsg}
          </div>
        )}

        {/* Options */}
        <div className="space-y-2.5">
          {/* Option 0: Passkey / Biometrics (No NEAR Know-How / Chain Abstraction) */}
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

          {/* Option 1: Meteor Wallet (Primary Modern Wallet) */}
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

          {/* Option 2: Open All NEAR Wallets (Selector Modal: Meteor, Here, MyNearWallet) */}
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

              {/* Option 3: Alice Dev Account */}
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

              {/* Option 4: Bob Dev Account */}
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

        <div className="text-[11px] text-[#8C8478] text-center pt-1 border-t border-[#2A2620]">
          Connect Meteor Wallet extension or use a pre-funded testnet account.
        </div>
      </div>
    </div>
  );
};
