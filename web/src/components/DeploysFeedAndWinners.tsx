import React from "react";
import { RoundView, EntryView, formatYoctoNear } from "../services/near";

interface DeploysFeedAndWinnersProps {
  entries: EntryView[];
  recentRounds: RoundView[];
  onSelectRound: (round: RoundView) => void;
  currentRound?: RoundView | null;
}

export const DeploysFeedAndWinnersProps: React.FC<DeploysFeedAndWinnersProps> = ({
  entries,
  recentRounds,
  onSelectRound,
  currentRound,
}) => {
  // Recent winning tiles (settled rounds with winning tile)
  const settledWithWinners = recentRounds.filter(
    (r) => r.status === "Settled" && r.winning_tile !== null
  );

  return (
    <div className="w-full max-w-[500px] mt-6 space-y-4">
      {/* Strip of recent winning tiles, like 22, 11, 7 */}
      {settledWithWinners.length > 0 && (
        <div className="flex items-center space-x-2 text-xs">
          <span className="text-[#8C8478] font-medium text-[11px] uppercase tracking-wider">
            Recent Winners:
          </span>
          <div className="flex items-center space-x-1.5 overflow-x-auto">
            {settledWithWinners.slice(0, 8).map((r) => {
              const isSelected = currentRound?.round_id === r.round_id;
              return (
                <button
                  key={r.round_id}
                  onClick={() => onSelectRound(r)}
                  className={`w-7 h-7 rounded-sm border font-mono text-xs font-bold flex items-center justify-center transition-all flex-shrink-0 ${
                    isSelected
                      ? "bg-[#E3C07A] text-[#0E0D0B] border-[#E3C07A] shadow-[0_0_10px_rgba(227,192,122,0.6)] scale-105"
                      : "bg-[#1A1815] border-[#2A2620] hover:border-[#E3C07A] text-[#E3C07A]"
                  }`}
                  title={`Round #${r.round_id}: Winning Tile #${r.winning_tile}`}
                >
                  {r.winning_tile}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Live Deploys Feed: account in #EDE6DA, stake in mono, and "🔒 encrypted" in muted text */}
      <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm p-4">
        <div className="text-[11px] text-[#8C8478] uppercase tracking-wider mb-2.5 flex items-center justify-between">
          <span>Live Deploys Feed</span>
          <span className="font-mono text-[10px]">{entries.length} recorded</span>
        </div>

        {entries.length > 0 ? (
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {entries.slice(-5).reverse().map((e, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between text-xs py-1 border-b border-[#2A2620]/60 last:border-b-0"
              >
                <span className="font-mono text-[#EDE6DA] truncate max-w-[150px]">
                  {e.account_id}
                </span>
                <span className="font-mono text-[#8C8478]">
                  {formatYoctoNear(e.gross_stake, 2)} NEAR
                </span>
                {currentRound?.status === "Settled" && currentRound.winning_tile !== null && e.mask !== null ? (
                  (e.mask & (1 << currentRound.winning_tile)) !== 0 ? (
                    <span className="text-[11px] text-[#E3C07A] font-bold font-mono">
                      🏆 Won (#{currentRound.winning_tile})
                    </span>
                  ) : (
                    <span className="text-[11px] text-[#8C8478] font-mono">
                      Missed
                    </span>
                  )
                ) : (
                  <span className="text-[11px] text-[#8C8478] font-mono">
                    🔒 encrypted
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-[#8C8478] italic text-center py-2">
            {currentRound?.status === "Settled" || currentRound?.status === "Refunded"
              ? `No players entered Round #${currentRound.round_id}. Pot carried over to the next round.`
              : "No deploys in this round yet. Be the first to deploy!"}
          </div>
        )}
      </div>
    </div>
  );
};
