import React from "react";
import { X, ShieldCheck, Grid, Clock, Gift, RefreshCw, ExternalLink } from "lucide-react";
import { CONFIG } from "../config";

interface HowToPlayModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HowToPlayModal: React.FC<HowToPlayModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0f1420] border border-[#1e2638] rounded-2xl max-w-2xl w-full p-6 shadow-2xl relative my-8">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#1e2638]">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400">
              <Grid className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">How to Play AMSTR</h2>
              <p className="text-xs text-slate-400">Rules, odds, and confidential TEE mining guide</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#1a2133] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="mt-5 space-y-4 text-xs text-slate-300 leading-relaxed">
          {/* Rule 1: The Confidential Grid */}
          <div className="p-4 rounded-xl bg-[#141b2b] border border-[#1e2638] space-y-2">
            <div className="flex items-center space-x-2 text-emerald-400 font-bold text-sm">
              <ShieldCheck className="w-4 h-4" />
              <span>1. Confidential Pick Encryption</span>
            </div>
            <p>
              Select 1 to 24 tiles on the 5x5 mine grid. <strong>Picks are encrypted in your browser and only the TEE can decrypt them.</strong> No competitor, miner, or validator can inspect your chosen tiles before the round closes.
            </p>
            <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-mono">
              Ciphertext = TweetNaCl.box(mask || salt, cvm_x25519_key)
            </div>
          </div>

          {/* Rule 2: 60-Second Cycles */}
          <div className="p-4 rounded-xl bg-[#141b2b] border border-[#1e2638] space-y-2">
            <div className="flex items-center space-x-2 text-blue-400 font-bold text-sm">
              <Clock className="w-4 h-4" />
              <span>2. 60-Second Autonomous Cycles</span>
            </div>
            <p>
              Rounds cycle automatically every 60 seconds:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-slate-400">
              <li><strong className="text-slate-200">Open Window:</strong> Players submit encrypted bets on-chain.</li>
              <li><strong className="text-slate-200">Entropy Lock:</strong> Round closes, locking on-chain NEAR block randomness.</li>
              <li><strong className="text-slate-200">Enclave Reveal:</strong> Intel TDX CVM unseals all picks in hardware memory.</li>
              <li><strong className="text-slate-200">Draw & Settlement:</strong> The winning tile is computed via <code className="text-purple-300">sha256(seed || entropy) % 25</code>.</li>
            </ul>
          </div>

          {/* Rule 3: Payouts & Wildcat Rounds */}
          <div className="p-4 rounded-xl bg-[#141b2b] border border-[#1e2638] space-y-2">
            <div className="flex items-center space-x-2 text-amber-400 font-bold text-sm">
              <Gift className="w-4 h-4" />
              <span>3. Pot Distribution & Wildcat Bonus</span>
            </div>
            <p>
              The net pot (90% of gross deposits) is shared proportionally among all players whose pick mask included the winning tile. Winners also receive newly minted AMSTR governance tokens!
            </p>
            <p className="text-amber-200/90 font-medium">
              🌟 Every 25 rounds is a <strong>Wildcat Round</strong>, where 60% of all winners' AMSTR tokens are awarded as an explosive jackpot to a single stake-weighted lucky player!
            </p>
          </div>

          {/* Rule 4: Timeout Guarantee */}
          <div className="p-4 rounded-xl bg-[#141b2b] border border-[#1e2638] space-y-2">
            <div className="flex items-center space-x-2 text-rose-400 font-bold text-sm">
              <RefreshCw className="w-4 h-4" />
              <span>4. Fail-Safe Timeout Protection</span>
            </div>
            <p>
              If the CVM restarts or fails to settle within 600 blocks (~10 minutes), the contract's fail-safe mechanism unlocks: <strong>100% of your deposit is fully refundable with zero fees deducted</strong> via a single click on "Refund Expired".
            </p>
          </div>
        </div>

        {/* Faucet Callout for Judges (Req 6) */}
        <div className="mt-5 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-amber-300">Need Testnet NEAR?</div>
            <div className="text-[11px] text-amber-200/80">Get free testnet tokens from the official faucet to try the game.</div>
          </div>
          <a
            href={CONFIG.FAUCET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs transition-colors"
          >
            <span>Open Faucet</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition-colors"
          >
            Got It, Let's Play!
          </button>
        </div>
      </div>
    </div>
  );
};
