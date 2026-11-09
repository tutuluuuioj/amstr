import React, { useState, useEffect } from "react";
import { RoundView, EntryView, JackpotPoolView, formatYoctoNear } from "../services/near";
import { walletService } from "../services/wallet";

interface RoundPanelProps {
  round: RoundView | null;
  currentBlock: number | null;
  jackpotPools: JackpotPoolView[] | null;
  entries?: EntryView[];
}

export const RoundPanel: React.FC<RoundPanelProps> = ({
  round,
  currentBlock,
  jackpotPools,
  entries = [],
}) => {
  const [connectedChain, setConnectedChain] = useState<"near" | "solana" | "evm">(() =>
    walletService.getConnectedChain()
  );

  useEffect(() => {
    return walletService.subscribe((state) => {
      setConnectedChain(state.connectedChain || "near");
    });
  }, []);

  if (!round) {
    return (
      <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm p-5 space-y-4">
        <div className="text-xs text-[#8C8478] animate-pulse">Loading round from testnet…</div>
      </div>
    );
  }

  // Calculate remaining seconds / blocks
  let blocksRemaining = 0;
  const isWindowClosed = currentBlock !== null && round.status === "Open" && currentBlock >= round.close_height;
  const isEffectivelyOpen = round.status === "Open" && !isWindowClosed;

  if (currentBlock && isEffectivelyOpen) {
    blocksRemaining = Math.max(0, round.close_height - currentBlock);
  }
  const isLast10Sec = isEffectivelyOpen && blocksRemaining <= 10;

  // Format blocks into M:SS (e.g. 180s -> 3:00)
  const formatTimer = (blocks: number): string => {
    const m = Math.floor(blocks / 60);
    const s = blocks % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Check timeout / expired (+600 blocks on-chain timeout)
  const isExpired =
    (round.status === "Revealing" || isWindowClosed) &&
    currentBlock !== null &&
    currentBlock > round.close_height + 600;

  // Status pill styling:
  // Open is copper #C8763A, Closing is amber #E3C07A, Drawing is emerald #5FA88A, Settled is #5FA88A, Expired/Refunded is red
  let statusPill = (
    <span className="px-2 py-0.5 rounded-sm text-[11px] font-medium border border-[#C8763A]/40 text-[#C8763A] bg-[#C8763A]/10">
      Open
    </span>
  );
  if (isExpired) {
    if (round.entry_count === 0) {
      statusPill = (
        <span className="px-2 py-0.5 rounded-sm text-[11px] font-medium border border-[#2A2620] text-[#8C8478] bg-[#0E0D0B]">
          No players
        </span>
      );
    } else {
      statusPill = (
        <span className="px-2 py-0.5 rounded-sm text-[11px] font-medium border border-[#C8763A]/40 text-[#C8763A] bg-[#C8763A]/10">
          Expired, refund available
        </span>
      );
    }
  } else if (isWindowClosed && round.status === "Open") {
    statusPill = (
      <span className="px-2 py-0.5 rounded-sm text-[11px] font-medium border border-[#E3C07A]/40 text-[#E3C07A] bg-[#E3C07A]/10 animate-pulse">
        Closing…
      </span>
    );
  } else if (round.status === "Revealing") {
    statusPill = (
      <span className="px-2 py-0.5 rounded-sm text-[11px] font-medium border border-[#5FA88A]/40 text-[#5FA88A] bg-[#5FA88A]/10 animate-pulse">
        Drawing…
      </span>
    );
  } else if (round.status === "Settled") {
    statusPill = (
      <span className="px-2 py-0.5 rounded-sm text-[11px] font-bold border border-[#E3C07A]/50 text-[#E3C07A] bg-[#E3C07A]/15 flex items-center space-x-1 shadow-sm">
        <span>🏆 Settled #{round.winning_tile ?? "?"}</span>
      </span>
    );
  } else if (round.status === "Refunded") {
    statusPill = (
      <span className="px-2 py-0.5 rounded-sm text-[11px] font-medium border border-[#C2483D]/40 text-[#C2483D] bg-[#C2483D]/10">
        Refunded
      </span>
    );
  }

  // Jackpot pool balances
  const shardBal = jackpotPools?.[0]?.near_balance ? formatYoctoNear(jackpotPools[0].near_balance, 3) : "0.004";
  const veinBal = jackpotPools?.[1]?.near_balance ? formatYoctoNear(jackpotPools[1].near_balance, 3) : "0.000";
  const coreBal = jackpotPools?.[2]?.near_balance ? formatYoctoNear(jackpotPools[2].near_balance, 3) : "0.000";

  return (
    <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm p-5 space-y-5">
      {/* Round Header & Status */}
      <div className="flex items-center justify-between">
        <h2 className="font-fraunces text-2xl font-bold text-[#EDE6DA]">
          Round {round.round_id}
        </h2>
        {statusPill}
      </div>

      {/* Big Countdown Timer in JetBrains Mono / Result Display */}
      <div className="pt-1">
        <div className="text-[11px] text-[#8C8478] uppercase tracking-wider mb-1">
          {isEffectivelyOpen
            ? "Deposit Window Closes"
            : round.status === "Settled"
            ? "Winning Tile Drawn"
            : "Round Phase"}
        </div>
        <div
          className={`font-mono text-3xl sm:text-4xl font-bold tracking-tight ${
            isLast10Sec
              ? "text-[#C8763A] animate-pulse"
              : isWindowClosed && round.status === "Open"
              ? "text-[#E3C07A] animate-pulse"
              : round.status === "Revealing"
              ? "text-[#5FA88A] animate-pulse"
              : round.status === "Settled"
              ? "text-[#E3C07A] font-extrabold flex items-center space-x-2"
              : "text-[#EDE6DA]"
          }`}
        >
          {isEffectivelyOpen
            ? formatTimer(blocksRemaining)
            : isExpired
            ? (round.entry_count === 0 ? "No players" : "Timeout Reached")
            : isWindowClosed && round.status === "Open"
            ? "Closing…"
            : round.status === "Revealing"
            ? (currentBlock && currentBlock > round.close_height + 25 ? "Drawing (Finalizing)…" : "Drawing…")
            : round.status === "Settled"
            ? `Tile #${round.winning_tile ?? "?"}`
            : round.entry_count === 0
            ? "No players"
            : round.status}
        </div>
      </div>

      {/* Universal Multi-Chain Pot */}
      {(() => {
        const isEvm = connectedChain === "evm";
        const isSolana = connectedChain === "solana";
        const nearAmount = parseFloat(formatYoctoNear(round.total_net, 4)) || 0;

        let primaryValue = `${formatYoctoNear(round.total_net, 3)} NEAR`;
        let subText: string | null = null;

        if (isEvm) {
          const ethVal = (nearAmount / 1000).toFixed(4);
          primaryValue = `~${ethVal} ETH`;
          subText = `${formatYoctoNear(round.total_net, 3)} NEAR`;
        } else if (isSolana) {
          const solVal = (nearAmount / 100).toFixed(4);
          primaryValue = `~${solVal} SOL`;
          subText = `${formatYoctoNear(round.total_net, 3)} NEAR`;
        }

        return (
          <div className="pt-2 border-t border-[#2A2620]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-[#8C8478] uppercase tracking-wider">
                Total Net Pot
              </span>
              {(isEvm || isSolana) && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm border border-[#2A2620] text-[#5FA88A] bg-[#5FA88A]/10">
                  🌐 Multichain Pool
                </span>
              )}
            </div>
            <div className="font-fraunces text-3xl font-extrabold text-[#E3C07A]">
              {primaryValue}
            </div>
            <div className="text-xs text-[#8C8478] mt-1 flex items-center justify-between">
              <span>
                {round.entry_count} {round.entry_count === 1 ? "player" : "players"} joined
              </span>
              {subText && (
                <span className="font-mono text-[11px] text-[#8C8478]/80">
                  ({subText})
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* Settled Round Winner & Outcome Showcase */}
      {round.status === "Settled" && (
        <div className="pt-3 border-t border-[#2A2620] space-y-2">
          <div className="text-[11px] text-[#8C8478] uppercase tracking-wider">
            Round Outcome
          </div>
          {(() => {
            const winners = entries.filter(
              (e) => round.winning_tile !== null && e.mask !== null && ((e.mask & (1 << round.winning_tile)) !== 0)
            );
            if (winners.length > 0) {
              return (
                <div className="p-3 bg-[#E3C07A]/10 border border-[#E3C07A]/40 rounded-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#E3C07A]">🏆 Winner</span>
                    <span className="font-mono text-xs font-bold text-[#E3C07A]">
                      Tile #{round.winning_tile}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {winners.map((w, i) => (
                      <div key={i} className="flex items-center justify-between text-xs font-mono">
                        <span className="text-[#EDE6DA] truncate max-w-[140px] font-medium" title={w.account_id}>
                          {w.account_id}
                        </span>
                        <span className={w.claimed ? "text-[#5FA88A] text-[11px]" : "text-[#E3C07A] text-[11px]"}>
                          {w.claimed ? "Claimed ✓" : "Pending Claim"}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="text-[11px] text-[#8C8478] pt-1.5 border-t border-[#E3C07A]/20 flex items-center justify-between font-mono">
                    <span>Payout:</span>
                    <span className="text-[#EDE6DA] font-bold">
                      {connectedChain === "evm"
                        ? `~${((parseFloat(formatYoctoNear(round.total_net, 4)) || 0) / 1000).toFixed(4)} ETH`
                        : connectedChain === "solana"
                        ? `~${((parseFloat(formatYoctoNear(round.total_net, 4)) || 0) / 100).toFixed(4)} SOL`
                        : `${formatYoctoNear(round.total_net, 3)} NEAR`}
                    </span>
                  </div>
                </div>
              );
            }
            return (
              <div className="p-3 bg-[#1A1815] border border-[#C8763A]/40 rounded-sm text-xs space-y-1.5">
                <div className="flex items-center justify-between text-[#EDE6DA] font-medium">
                  <span>No Winner (Tile #{round.winning_tile})</span>
                  <span className="font-mono text-[#E3C07A] font-bold">
                    +{connectedChain === "evm"
                      ? `~${((parseFloat(formatYoctoNear(round.total_net, 4)) || 0) / 1000).toFixed(4)} ETH`
                      : connectedChain === "solana"
                      ? `~${((parseFloat(formatYoctoNear(round.total_net, 4)) || 0) / 100).toFixed(4)} SOL`
                      : `${formatYoctoNear(round.total_net, 3)} NEAR`}
                  </span>
                </div>
                <div className="text-[11px] text-[#C8763A] font-mono font-semibold">
                  ➔ Pot rolled over to Round #{round.round_id + 1}
                </div>
                <div className="text-[10px] text-[#8C8478] leading-tight">
                  Accumulates into the community carryover pool until a winning tile is drawn.
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Jackpot Pools (Shard, Vein, Core) in small gold mono */}
      <div className="pt-3 border-t border-[#2A2620] space-y-1.5">
        <div className="text-[11px] text-[#8C8478] uppercase tracking-wider">
          Jackpot Pools
        </div>
        <div className="font-mono text-xs text-[#E3C07A] flex justify-between">
          <span>Shard (1:300):</span>
          <span>{shardBal} NEAR</span>
        </div>
        <div className="font-mono text-xs text-[#E3C07A] flex justify-between">
          <span>Vein (1:1,000):</span>
          <span>{veinBal} NEAR</span>
        </div>
        <div className="font-mono text-xs text-[#E3C07A] flex justify-between">
          <span>Core (1:3,000):</span>
          <span>{coreBal} NEAR</span>
        </div>
        <div className="pt-2 border-t border-[#2A2620]/60 flex items-center justify-between text-[11px] font-mono">
          <span className="text-[#8C8478]">Wildcat (60% Bonus):</span>
          <span className={round.round_id % 25 === 0 ? "text-[#E3C07A] font-bold tracking-wider" : "text-[#8C8478]"}>
            {round.round_id % 25 === 0 ? "ACTIVE ROUND" : `in ${25 - (round.round_id % 25)} rounds`}
          </span>
        </div>
      </div>
    </div>
  );
};
