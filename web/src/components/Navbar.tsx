import React from "react";
import { ShieldCheck, HelpCircle, ExternalLink, LogOut, Wallet, Cpu } from "lucide-react";
import { CONFIG } from "../config";

interface NavbarProps {
  accountId: string | null;
  onConnectWallet: () => void;
  onDisconnectWallet: () => void;
  onOpenAttestation: () => void;
  onOpenHowToPlay: () => void;
  currentBlock: number | null;
}

export const Navbar: React.FC<NavbarProps> = ({
  accountId,
  onConnectWallet,
  onDisconnectWallet,
  onOpenAttestation,
  onOpenHowToPlay,
  currentBlock,
}) => {
  return (
    <header className="border-b border-[#1e2638] bg-[#0d111a]/80 backdrop-blur sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <span className="text-xl font-black text-black">💎</span>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xl font-extrabold tracking-tight text-white">AMSTR</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-medium">
                TESTNET
              </span>
            </div>
            <div className="flex items-center space-x-2 text-xs text-slate-400">
              <span className="flex items-center space-x-1">
                <Cpu className="w-3 h-3 text-cyan-400" />
                <span>Intel TDX Enclave</span>
              </span>
              <span>•</span>
              {currentBlock ? (
                <span className="font-mono text-[11px] text-slate-300">
                  Block #{currentBlock.toLocaleString()}
                </span>
              ) : (
                <span className="animate-pulse">Connecting...</span>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {/* Faucet Link (Req 6) */}
          <a
            href={CONFIG.FAUCET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#161d2d] text-amber-300 border border-amber-500/30 hover:bg-[#1c2438] hover:border-amber-500/50 transition-colors shadow-sm"
            title="Get free NEAR Testnet tokens for betting"
          >
            <span>🚰 Faucet</span>
            <ExternalLink className="w-3 h-3" />
          </a>

          {/* How to Play Guide (Req 6) */}
          <button
            onClick={onOpenHowToPlay}
            className="flex items-center space-x-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#161d2d] text-slate-300 hover:text-white border border-[#1e2638] hover:border-slate-600 transition-colors"
          >
            <HelpCircle className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden sm:inline">How to Play</span>
          </button>

          {/* Intel TDX Attestation (Req 4) */}
          <button
            onClick={onOpenAttestation}
            className="flex items-center space-x-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#161d2d] text-slate-300 hover:text-white border border-[#1e2638] hover:border-emerald-500/40 transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">TEE Attestation</span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          </button>

          {/* Wallet Connection */}
          {accountId ? (
            <div className="flex items-center space-x-2 bg-[#161d2d] border border-emerald-500/40 rounded-lg p-1 pl-3">
              <span className="font-mono text-xs text-emerald-300 max-w-[120px] sm:max-w-[180px] truncate">
                {accountId}
              </span>
              <button
                onClick={onDisconnectWallet}
                className="p-1 rounded hover:bg-[#20293d] text-slate-400 hover:text-rose-400 transition-colors"
                title="Disconnect Wallet"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={onConnectWallet}
              className="flex items-center space-x-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black shadow-lg shadow-emerald-500/20 transition-all"
            >
              <Wallet className="w-4 h-4" />
              <span>Connect Wallet</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
