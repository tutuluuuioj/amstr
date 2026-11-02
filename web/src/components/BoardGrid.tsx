import React from "react";
import { Sparkles, Gem, Check, Lock } from "lucide-react";
import { RoundView, formatYoctoNear } from "../services/near";

interface BoardGridProps {
  selectedTiles: Set<number>;
  onToggleTile: (tileIndex: number) => void;
  round: RoundView | null;
  playerMask: number | null;
  disabled: boolean;
}

export const BoardGrid: React.FC<BoardGridProps> = ({
  selectedTiles,
  onToggleTile,
  round,
  playerMask,
  disabled,
}) => {
  const isSettled = round?.status === "Settled";
  const winningTile = round?.winning_tile ?? null;

  return (
    <div className="w-full">
      {/* 5x5 Grid */}
      <div className="grid grid-cols-5 gap-2 sm:gap-3 aspect-square max-w-[420px] mx-auto p-3 sm:p-4 rounded-2xl bg-[#0f1422] border border-[#1e2638] shadow-2xl relative">
        {Array.from({ length: 25 }).map((_, index) => {
          const isSelected = selectedTiles.has(index);
          const isWinningTile = isSettled && winningTile === index;
          const playerHadTile = playerMask !== null && (playerMask & (1 << index)) !== 0;

          // Tile total stake from live round
          const tileStakeYocto = round?.per_tile_totals?.[index];
          const hasStake = tileStakeYocto && tileStakeYocto !== "0";

          // Dynamic styling based on state
          let tileBg = "bg-[#141b2c] border-[#1e273b] hover:border-slate-500 hover:bg-[#1a233a]";
          let textColor = "text-slate-300";

          if (isWinningTile) {
            tileBg = "bg-gradient-to-br from-amber-500/20 to-yellow-600/30 border-amber-400 ring-2 ring-amber-400/50 shadow-lg shadow-amber-500/30 animate-pulse";
            textColor = "text-amber-300 font-extrabold";
          } else if (isSelected) {
            tileBg = "bg-gradient-to-br from-emerald-500/20 to-green-600/20 border-emerald-500 shadow-md shadow-emerald-500/20";
            textColor = "text-emerald-300 font-bold";
          } else if (playerHadTile && !isSettled) {
            tileBg = "bg-emerald-950/40 border-emerald-500/40";
            textColor = "text-emerald-400";
          }

          return (
            <button
              key={index}
              type="button"
              disabled={disabled}
              onClick={() => onToggleTile(index)}
              className={`relative rounded-xl border flex flex-col items-center justify-center transition-all duration-200 select-none ${tileBg} ${
                disabled ? "cursor-default" : "cursor-pointer active:scale-95"
              }`}
            >
              {/* Tile Index Number */}
              <span className={`text-xs sm:text-sm font-mono ${textColor}`}>
                #{index}
              </span>

              {/* Status Icons */}
              {isWinningTile ? (
                <div className="flex flex-col items-center">
                  <Gem className="w-5 h-5 text-amber-400 animate-bounce mt-0.5" />
                  <span className="text-[9px] font-black uppercase text-amber-300 tracking-wider font-sans">
                    WIN
                  </span>
                </div>
              ) : isSelected ? (
                <Check className="w-4 h-4 text-emerald-400 mt-0.5" />
              ) : null}

              {/* Per-Tile Live Stake Display (Req 2: from testnet contract) */}
              {hasStake && (
                <span className="absolute bottom-1 text-[9px] font-mono text-slate-400 px-1 rounded bg-[#0b0e17]/80">
                  {formatYoctoNear(tileStakeYocto, 2)}N
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Grid Quick Helper */}
      <div className="flex items-center justify-between text-xs text-slate-400 max-w-[420px] mx-auto mt-3 px-2">
        <div className="flex items-center space-x-1.5">
          <span className="w-2.5 h-2.5 rounded bg-emerald-500/40 border border-emerald-500"></span>
          <span>Selected ({selectedTiles.size}/24)</span>
        </div>
        <div className="flex items-center space-x-1.5">
          <Gem className="w-3.5 h-3.5 text-amber-400" />
          <span>Winning Tile (Settled)</span>
        </div>
      </div>
    </div>
  );
};
