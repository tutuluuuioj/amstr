import React from "react";
import { RoundView, formatYoctoNear } from "../services/near";

interface MobileStickyBarProps {
  round: RoundView | null;
  currentBlock: number | null;
}

export const MobileStickyBar: React.FC<MobileStickyBarProps> = ({ round, currentBlock }) => {
  if (!round) return null;

  const isWindowClosed = currentBlock !== null && round.status === "Open" && currentBlock >= round.close_height;
  const isEffectivelyOpen = round.status === "Open" && !isWindowClosed;

  let blocksRemaining = 0;
  if (currentBlock && isEffectivelyOpen) {
    blocksRemaining = Math.max(0, round.close_height - currentBlock);
  }

  const formatTimer = (blocks: number): string => {
    const m = Math.floor(blocks / 60);
    const s = blocks % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const isExpired =
    (round.status === "Revealing" || isWindowClosed) &&
    currentBlock !== null &&
    currentBlock > round.close_height + 600;

  return (
    <div className="md:hidden sticky top-14 z-30 bg-[#0E0D0B] border-b border-[#2A2620] px-4 py-2 flex items-center justify-between">
      <div>
        <span className="text-[10px] text-[#8C8478] uppercase mr-1">Round {round.round_id}:</span>
        <span className="font-mono text-xs font-bold text-[#C8763A]">
          {isEffectivelyOpen
            ? formatTimer(blocksRemaining)
            : isWindowClosed && round.status === "Open"
            ? "Closing…"
            : round.status === "Revealing"
            ? "Drawing…"
            : round.status === "Settled"
            ? (round.entry_count === 0 ? "No players" : "Settled")
            : isExpired
            ? (round.entry_count === 0 ? "No players" : "Expired")
            : round.status}
        </span>
      </div>
      <div>
        <span className="text-[10px] text-[#8C8478] uppercase mr-1">Pot:</span>
        <span className="font-fraunces text-sm font-bold text-[#E3C07A]">
          {formatYoctoNear(round.total_net, 2)} NEAR
        </span>
      </div>
    </div>
  );
};
