import React from "react";
import { Sparkles, Trophy } from "lucide-react";
import { RoundView, formatYoctoNear } from "../services/near";

interface MineGridProps {
  selectedTiles: Set<number>;
  onToggleTile: (tileIndex: number) => void;
  onSelectRandom5: () => void;
  onSelectHalf: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  round: RoundView | null;
  playerMask: number | null;
  disabled: boolean;
  isViewingPastRound?: boolean;
}

export const MineGrid: React.FC<MineGridProps> = ({
  selectedTiles,
  onToggleTile,
  onSelectRandom5,
  onSelectHalf,
  onSelectAll,
  onClear,
  round,
  playerMask,
  disabled,
  isViewingPastRound = false,
}) => {
  const isSettled = round?.status === "Settled";
  const winningTile = round?.winning_tile ?? null;
  const noPlayers = round?.entry_count === 0;
  const isRoundOpen = round?.status === "Open" && !disabled && !isViewingPastRound;

  return (
    <div className="flex flex-col items-center w-full">
      {/* 5x5 Grid Container */}
      <div className="w-full max-w-[500px] aspect-square grid grid-cols-5 gap-2 sm:gap-2.5 p-3.5 bg-[#1A1815] border border-[#2A2620] rounded-sm shadow-xl select-none">
        {Array.from({ length: 25 }).map((_, index) => {
          // Live round draft selection only outlines tiles when the round is actively open and interactive
          const isSelected = isRoundOpen && selectedTiles.has(index);
          const isPlayerPick = !noPlayers && playerMask !== null && (playerMask & (1 << index)) !== 0;
          const isWinner = isSettled && winningTile === index;
          const isOtherDimmed = isSettled && winningTile !== null && !isWinner;

          const tileStakeYocto = round?.per_tile_totals?.[index];
          let stakeAmount = "";
          if (tileStakeYocto && tileStakeYocto !== "0") {
            try {
              const bi = BigInt(tileStakeYocto);
              if (bi > 0n) {
                const formatted = formatYoctoNear(tileStakeYocto, 3);
                if (formatted !== "0" && formatted !== "0.0" && formatted !== "0.00" && formatted !== "") {
                  stakeAmount = formatted;
                }
              }
            } catch {
              stakeAmount = "";
            }
          }

          // Base style: #1A1815 with #2A2620 border
          let tileClass = isRoundOpen
            ? "bg-[#1A1815] border border-[#2A2620] text-[#8C8478] hover:border-[#C8763A]"
            : "bg-[#1A1815] border border-[#2A2620] text-[#8C8478]";

          // Player's selected tiles: copper border, faint copper fill (#C8763A at 12%), copper text
          if (isSelected || isPlayerPick) {
            tileClass = "border border-[#C8763A] bg-[#C8763A]/[0.12] text-[#C8763A] font-semibold";
          }

          // Winning tile: rich gold #E3C07A gradient, high-contrast glow, glowing ring, scaling
          if (isWinner) {
            tileClass =
              "border-2 border-[#E3C07A] bg-gradient-to-b from-[#E3C07A]/35 via-[#E3C07A]/20 to-[#C8763A]/25 text-[#E3C07A] font-bold shadow-[0_0_25px_rgba(227,192,122,0.65)] ring-2 ring-[#E3C07A] ring-offset-2 ring-offset-[#0E0D0B] z-10 animate-crack-open scale-[1.04]";
          } else if (isOtherDimmed) {
            tileClass += " opacity-35 filter brightness-75";
          }

          return (
            <button
              key={index}
              type="button"
              disabled={disabled || isViewingPastRound}
              onClick={() => onToggleTile(index)}
              className={`relative rounded-sm flex flex-col items-center justify-center p-1 sm:p-2 transition-all ${tileClass} ${
                disabled || isViewingPastRound ? "cursor-default" : "cursor-pointer active:scale-95"
              }`}
            >
              {/* Winning Banner Tag */}
              {isWinner && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-[#E3C07A] text-[#0E0D0B] shadow-[0_0_10px_rgba(227,192,122,0.8)] flex items-center space-x-1 z-20 whitespace-nowrap animate-bounce">
                  <span>🏆</span>
                  <span>WINNER</span>
                </span>
              )}

              {/* Tile Number (Line 1) */}
              <div className="flex items-center space-x-1">
                <span className={`font-mono text-xs sm:text-sm font-semibold ${isWinner ? "text-[#E3C07A] font-black scale-110" : ""}`}>
                  #{index}
                </span>
                {isWinner && <Sparkles className="w-3.5 h-3.5 text-[#E3C07A] animate-pulse" />}
              </div>

              {/* Winning Status / Live Staked NEAR under tile number */}
              <span
                className={`font-mono text-[9px] sm:text-[10px] mt-0.5 max-w-full px-0.5 min-h-[14px] flex items-center justify-center truncate ${
                  isWinner
                    ? "text-[#E3C07A] font-bold"
                    : isSelected
                    ? "text-[#C8763A]"
                    : "text-[#8C8478]"
                }`}
              >
                {isWinner ? (
                  isPlayerPick ? (
                    <span className="text-[#5FA88A] font-black bg-[#5FA88A]/20 px-1 py-0.5 rounded uppercase tracking-wide">
                      YOU WON!
                    </span>
                  ) : stakeAmount ? (
                    <span>{stakeAmount} NEAR</span>
                  ) : (
                    <span className="text-[#E3C07A] font-bold uppercase tracking-wider">
                      DRAWN
                    </span>
                  )
                ) : (
                  stakeAmount && (
                    <>
                      <span>{stakeAmount}</span>
                      <span className="hidden sm:inline ml-0.5">NEAR</span>
                    </>
                  )
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Requirement 4: Quick-select buttons: Random 5, Half, All (25), Clear */}
      <div
        className={`flex items-center justify-center space-x-6 mt-4 text-xs font-medium transition-opacity ${
          disabled || isViewingPastRound
            ? "opacity-30 pointer-events-none cursor-not-allowed text-[#8C8478]"
            : "text-[#8C8478]"
        }`}
      >
        <button
          type="button"
          disabled={disabled || isViewingPastRound}
          onClick={onSelectRandom5}
          className="hover:text-[#EDE6DA] transition-colors disabled:cursor-not-allowed"
        >
          Random 5
        </button>
        <span>•</span>
        <button
          type="button"
          disabled={disabled || isViewingPastRound}
          onClick={onSelectHalf}
          className="hover:text-[#EDE6DA] transition-colors disabled:cursor-not-allowed"
        >
          Half (12)
        </button>
        <span>•</span>
        <button
          type="button"
          disabled={disabled || isViewingPastRound}
          onClick={onSelectAll}
          className="hover:text-[#EDE6DA] transition-colors disabled:cursor-not-allowed"
        >
          All (25)
        </button>
        <span>•</span>
        <button
          type="button"
          disabled={disabled || isViewingPastRound}
          onClick={onClear}
          className="hover:text-[#EDE6DA] transition-colors disabled:cursor-not-allowed"
        >
          Clear
        </button>
      </div>
    </div>
  );
};
