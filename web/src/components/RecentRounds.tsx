import React from "react";
import { Calculator, Trophy, Gem, ExternalLink, History } from "lucide-react";
import { RoundView, formatYoctoNear } from "../services/near";
import { CONFIG } from "../config";

interface RecentRoundsProps {
  rounds: RoundView[];
  onSelectRoundForFairness: (round: RoundView) => void;
}

export const RecentRounds: React.FC<RecentRoundsProps> = ({
  rounds,
  onSelectRoundForFairness,
}) => {
  if (rounds.length === 0) {
    return null;
  }

  return (
    <div className="mt-10 p-6 rounded-2xl bg-[#0f1422] border border-[#1e2638] shadow-2xl">
      <div className="flex items-center justify-between pb-4 border-b border-[#1e2638] mb-5">
        <div className="flex items-center space-x-2.5">
          <History className="w-5 h-5 text-purple-400" />
          <h3 className="text-base font-black text-white">Settled Rounds History</h3>
        </div>
        <span className="text-xs text-slate-400 font-mono">
          Showing last {rounds.length} rounds
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rounds.map((r) => {
          const isSettled = r.status === "Settled";
          const isRefunded = r.status === "Refunded";

          return (
            <div
              key={r.round_id}
              className="p-4 rounded-xl bg-[#141b2c] border border-[#1e273b] hover:border-slate-500 transition-colors flex flex-col justify-between"
            >
              <div>
                {/* Round Header */}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-white font-mono">
                    Round #{r.round_id}
                  </span>
                  {isSettled ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30 font-semibold">
                      Settled
                    </span>
                  ) : (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30 font-semibold">
                      Refunded
                    </span>
                  )}
                </div>

                {/* Metrics */}
                <div className="space-y-2 text-xs mb-4">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Winning Tile:</span>
                    {r.winning_tile !== null ? (
                      <span className="flex items-center space-x-1 font-mono font-extrabold text-amber-300">
                        <Gem className="w-3.5 h-3.5 text-amber-400" />
                        <span>Tile #{r.winning_tile}</span>
                      </span>
                    ) : (
                      <span className="text-slate-500">None</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-slate-400">
                    <span>Net Pot:</span>
                    <span className="font-mono font-bold text-white">
                      {formatYoctoNear(r.total_net, 3)} NEAR
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-slate-400">
                    <span>Entries:</span>
                    <span className="font-mono text-slate-300">{r.entry_count} players</span>
                  </div>
                </div>
              </div>

              {/* Requirement 3: Prominent Fairness Button on Every Settled Round */}
              {isSettled ? (
                <button
                  onClick={() => onSelectRoundForFairness(r)}
                  className="w-full py-2 px-3 rounded-lg bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-purple-300 hover:text-purple-200 text-xs font-bold transition-all flex items-center justify-center space-x-1.5"
                >
                  <Calculator className="w-3.5 h-3.5" />
                  <span>Verify Fairness</span>
                </button>
              ) : (
                <a
                  href={`${CONFIG.EXPLORER_URL}/address/${CONFIG.CONTRACT_ID}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2 px-3 rounded-lg bg-[#1a2236] hover:bg-[#202a42] border border-[#2a3652] text-slate-400 hover:text-slate-200 text-xs font-medium transition-all flex items-center justify-center space-x-1"
                >
                  <span>View Refund on Explorer</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
