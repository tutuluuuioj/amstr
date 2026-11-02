import React from "react";
import { Clock, Shield, Coins, Users, Trophy, Flame } from "lucide-react";
import { RoundView, formatYoctoNear } from "../services/near";

interface RoundStatusCardProps {
  round: RoundView | null;
  currentBlock: number | null;
  carryoverNear: string;
}

export const RoundStatusCard: React.FC<RoundStatusCardProps> = ({
  round,
  currentBlock,
  carryoverNear,
}) => {
  if (!round) {
    return (
      <div className="p-6 rounded-2xl bg-[#0f1422] border border-[#1e2638] animate-pulse">
        <div className="h-6 w-32 bg-slate-800 rounded mb-4"></div>
        <div className="h-10 w-48 bg-slate-800 rounded"></div>
      </div>
    );
  }

  // Calculate blocks remaining until close or timeout
  let blocksRemaining = 0;
  if (currentBlock && round.status === "Open") {
    blocksRemaining = Math.max(0, round.close_height - currentBlock);
  }

  const isWildcatRound = round.round_id > 0 && round.round_id % 25 === 0;

  return (
    <div className="p-5 sm:p-6 rounded-2xl bg-[#0f1422] border border-[#1e2638] shadow-2xl relative overflow-hidden">
      {/* Background Accent Gradient */}
      <div className="absolute top-0 right-0 -mt-8 -mr-8 w-44 h-44 rounded-full bg-emerald-500/5 blur-3xl pointer-events-none"></div>

      {/* Top Header: Round ID & Status */}
      <div className="flex items-center justify-between pb-4 border-b border-[#1e2638]">
        <div className="flex items-center space-x-2.5">
          <span className="text-xl sm:text-2xl font-black text-white tracking-tight">
            Round #{round.round_id}
          </span>
          {isWildcatRound && (
            <span className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold text-xs border border-amber-500/40 animate-pulse">
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              <span>WILDCAT 25X</span>
            </span>
          )}
        </div>

        {/* Status Pill */}
        <div>
          {round.status === "Open" && (
            <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>OPEN FOR BETS</span>
            </span>
          )}
          {round.status === "Revealing" && (
            <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              <span>TEE UNSEALING</span>
            </span>
          )}
          {round.status === "Settled" && (
            <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30 text-xs font-bold">
              <span>SETTLED</span>
            </span>
          )}
          {round.status === "Refunded" && (
            <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30 text-xs font-bold">
              <span>REFUNDED</span>
            </span>
          )}
        </div>
      </div>

      {/* Main Metrics: Live Pot & Timer */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 my-5">
        {/* Metric 1: Net Pot */}
        <div className="p-3.5 rounded-xl bg-[#141b2c] border border-[#1e273b]">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
            <Coins className="w-3.5 h-3.5 text-emerald-400" />
            <span>Net Winners Pot</span>
          </div>
          <div className="mt-1 flex items-baseline space-x-1">
            <span className="text-xl sm:text-2xl font-black text-white font-mono">
              {formatYoctoNear(round.total_net, 3)}
            </span>
            <span className="text-xs font-bold text-emerald-400">NEAR</span>
          </div>
        </div>

        {/* Metric 2: Timer / Blocks Remaining */}
        <div className="p-3.5 rounded-xl bg-[#141b2c] border border-[#1e273b]">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
            <Clock className="w-3.5 h-3.5 text-blue-400" />
            <span>Time Window</span>
          </div>
          <div className="mt-1 flex items-baseline space-x-1">
            {round.status === "Open" ? (
              <>
                <span className="text-xl sm:text-2xl font-black text-white font-mono">
                  {blocksRemaining}
                </span>
                <span className="text-xs font-medium text-slate-400">blocks (~{blocksRemaining}s)</span>
              </>
            ) : round.status === "Revealing" ? (
              <span className="text-sm font-bold text-amber-300">Decrypting...</span>
            ) : (
              <span className="text-sm font-bold text-slate-400">Closed</span>
            )}
          </div>
        </div>

        {/* Metric 3: Players Joined */}
        <div className="col-span-2 sm:col-span-1 p-3.5 rounded-xl bg-[#141b2c] border border-[#1e273b]">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
            <Users className="w-3.5 h-3.5 text-purple-400" />
            <span>Active Players</span>
          </div>
          <div className="mt-1 flex items-baseline space-x-1">
            <span className="text-xl sm:text-2xl font-black text-white font-mono">
              {round.entry_count}
            </span>
            <span className="text-xs font-medium text-slate-400">deposits</span>
          </div>
        </div>
      </div>

      {/* Requirement 8: Precise Terminology Banner */}
      <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center space-x-2.5">
        <Shield className="w-4 h-4 text-emerald-400 flex-shrink-0" />
        <p className="text-xs text-emerald-200/90 font-medium">
          Picks are encrypted in your browser and only the TEE can decrypt them.
        </p>
      </div>
    </div>
  );
};
