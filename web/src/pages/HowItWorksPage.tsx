import React from "react";
import { ExternalLink } from "lucide-react";
import { CONFIG } from "../config";

export const HowItWorksPage: React.FC = () => {
  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="font-fraunces text-2xl font-bold text-[#EDE6DA]">
          How AMSTR Works
        </h1>
        <p className="text-xs text-[#8C8478] mt-0.5">
          Decentralized confidential mining on NEAR Protocol secured by Intel TDX
        </p>
      </div>

      {/* Three step cards with copper numbers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Step 1 */}
        <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm p-5 space-y-3 shadow-xl">
          <div className="w-8 h-8 rounded-full bg-[#C8763A] text-[#0E0D0B] font-fraunces font-bold flex items-center justify-center text-sm">
            1
          </div>
          <h2 className="font-fraunces text-base font-bold text-[#EDE6DA]">
            Pick Tiles
          </h2>
          <p className="text-xs text-[#8C8478] leading-relaxed">
            Select 1 to 25 tiles on the 5x5 mine grid. Picks are encrypted in your browser and only the TEE can decrypt them.
          </p>
        </div>

        {/* Step 2 */}
        <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm p-5 space-y-3 shadow-xl">
          <div className="w-8 h-8 rounded-full bg-[#C8763A] text-[#0E0D0B] font-fraunces font-bold flex items-center justify-center text-sm">
            2
          </div>
          <h2 className="font-fraunces text-base font-bold text-[#EDE6DA]">
            TEE Draws Winning Tile
          </h2>
          <p className="text-xs text-[#8C8478] leading-relaxed">
            Deposit window closes and locks on-chain NEAR block entropy. The confidential enclave unseals picks and computes the winning tile.
          </p>
        </div>

        {/* Step 3 */}
        <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm p-5 space-y-3 shadow-xl">
          <div className="w-8 h-8 rounded-full bg-[#C8763A] text-[#0E0D0B] font-fraunces font-bold flex items-center justify-center text-sm">
            3
          </div>
          <h2 className="font-fraunces text-base font-bold text-[#EDE6DA]">
            Winners Split Pot
          </h2>
          <p className="text-xs text-[#8C8478] leading-relaxed">
            Winners split 90% of all stakes proportionally plus AMSTR token rewards. Losers reclaim their 0.01 NEAR entry storage.
          </p>
        </div>
      </div>

      {/* Wildcat Bonus & Jackpots Card */}
      <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm p-6 space-y-4">
        <div className="flex items-center space-x-2">
          <span className="px-2 py-0.5 rounded-sm bg-[#E3C07A]/10 border border-[#E3C07A]/40 text-[#E3C07A] text-[11px] font-mono font-bold">
            1 IN 25 ROUNDS
          </span>
          <h2 className="font-fraunces text-lg font-bold text-[#EDE6DA]">
            The Wildcat Bonus & Jackpot Pools
          </h2>
        </div>
        <p className="text-xs text-[#8C8478] leading-relaxed">
          AMSTR features on-chain deflationary incentives and high-multiplier bonus draws:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          {/* Wildcat Round */}
          <div className="p-4 bg-[#0E0D0B] border border-[#2A2620] rounded-sm space-y-1.5">
            <div className="text-xs font-fraunces font-bold text-[#E3C07A] flex items-center justify-between">
              <span>Wildcat Round</span>
              <span className="font-mono text-[10px] text-[#C8763A]">Rounds #25, #50, #75...</span>
            </div>
            <p className="text-[11px] text-[#8C8478] leading-relaxed">
              Every 25th round triggers the Wildcat draw. A single stake-weighted winner among the round's winners receives a massive <strong className="text-[#EDE6DA]">60% bonus</strong> of the entire round's AMSTR token emissions, while the remaining 40% is distributed pro-rata.
            </p>
          </div>

          {/* Three Jackpot Tiers */}
          <div className="p-4 bg-[#0E0D0B] border border-[#2A2620] rounded-sm space-y-1.5">
            <div className="text-xs font-fraunces font-bold text-[#E3C07A]">
              Three Jackpot Tiers
            </div>
            <div className="text-[11px] font-mono space-y-1 text-[#8C8478]">
              <div className="flex justify-between">
                <span className="text-[#EDE6DA]">Shard (1:300 odds):</span>
                <span>Cap: 200N / 5K AMSTR</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#EDE6DA]">Vein (1:1,000 odds):</span>
                <span>Cap: 1KN / 20K AMSTR</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#EDE6DA]">Core (1:3,000 odds):</span>
                <span>Cap: 5KN / 100K AMSTR</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Protocol Fee Split: thin bar: 6% burn in copper, 2% jackpots in gold, 2% treasury in muted */}
      <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm p-6 space-y-4">
        <h2 className="font-fraunces text-lg font-bold text-[#EDE6DA]">
          Protocol Fee Split (10%)
        </h2>
        <p className="text-xs text-[#8C8478]">
          90% of every stake goes straight to winning players. The remaining 10% protocol fee is routed:
        </p>

        {/* Thin Bar */}
        <div className="w-full h-3 rounded-sm overflow-hidden flex bg-[#0E0D0B]">
          <div className="bg-[#C8763A] h-full" style={{ width: "60%" }} title="6% Buyback & Burn"></div>
          <div className="bg-[#E3C07A] h-full" style={{ width: "20%" }} title="2% Jackpot Pools"></div>
          <div className="bg-[#8C8478] h-full" style={{ width: "20%" }} title="2% Ecosystem Treasury"></div>
        </div>

        {/* Legend */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono pt-1">
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-sm bg-[#C8763A]"></span>
            <span className="text-[#EDE6DA]">6% Buyback & Burn</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-sm bg-[#E3C07A]"></span>
            <span className="text-[#EDE6DA]">2% Jackpots (Shard/Vein/Core)</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-3 h-3 rounded-sm bg-[#8C8478]"></span>
            <span className="text-[#EDE6DA]">2% Ecosystem Treasury</span>
          </div>
        </div>
      </div>

      {/* Refund Promise & Faucet Link */}
      <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm p-6 space-y-4">
        <h2 className="font-fraunces text-lg font-bold text-[#EDE6DA]">
          Fail-Safe Refund Promise
        </h2>
        <p className="text-xs text-[#8C8478] leading-relaxed">
          If the Intel TDX enclave crashes, restarts, or fails to settle within 600 blocks (~10 minutes), the smart contract unlocks 100% full refunds. Players can claim their entire deposit back with zero fees deducted.
        </p>

        <div className="pt-2 border-t border-[#2A2620] flex items-center justify-between text-xs">
          <span className="text-[#8C8478]">Need testnet NEAR to play?</span>
          <a
            href={CONFIG.FAUCET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#C8763A] hover:underline font-semibold inline-flex items-center space-x-1"
          >
            <span>Get Free Tokens from Testnet Faucet</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
};
