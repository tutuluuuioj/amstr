import React from "react";
import { RoundView, EntryView, formatYoctoNear } from "../services/near";

interface RoundsPageProps {
  rounds: RoundView[];
  accountId: string | null;
  currentBlock: number | null;
  userEntries?: Record<number, EntryView | null>;
  onVerifyFairness: (round: RoundView) => void;
  onClaim?: (roundId: number) => Promise<void>;
  onReclaimStorage?: (roundId: number) => Promise<void>;
  onRefundExpired?: (roundId: number) => Promise<void>;
  onInspectRound?: (round: RoundView) => void;
}

export const RoundsPage: React.FC<RoundsPageProps> = ({
  rounds,
  accountId,
  currentBlock,
  userEntries,
  onVerifyFairness,
  onClaim,
  onReclaimStorage,
  onRefundExpired,
  onInspectRound,
}) => {
  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-fraunces text-2xl font-bold text-[#EDE6DA]">
            Round History
          </h1>
          <p className="text-xs text-[#8C8478] mt-0.5">
            Cryptographically settled rounds on NEAR Testnet
          </p>
        </div>
      </div>

      {/* Rounds Table */}
      <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm overflow-x-auto shadow-xl">
        <table className="w-full text-left text-xs">
          {/* #1A1815 header */}
          <thead className="bg-[#141210] border-b border-[#2A2620] text-[#8C8478] uppercase text-[11px] font-semibold tracking-wider">
            <tr>
              <th className="py-3 px-3 sm:px-4">Round</th>
              <th className="py-3 px-3 sm:px-4">Winning Tile</th>
              <th className="py-3 px-4 hidden md:table-cell">Net Pot</th>
              <th className="py-3 px-4 hidden sm:table-cell">Players</th>
              <th className="py-3 px-3 sm:px-4 min-w-[130px]">Status</th>
              <th className="py-3 px-4 min-w-[170px]">Your Result & Actions</th>
              <th className="py-3 px-3 sm:px-4 text-right">Fairness</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2A2620]">
            {rounds.map((r) => {
              // Consistent window closed and expiration logic matching RoundPanel
              const isWindowClosed = currentBlock !== null && r.status === "Open" && currentBlock > r.close_height;
              const isRoundExpired =
                r.status === "Refunded" ||
                ((r.status === "Revealing" || isWindowClosed) &&
                  currentBlock !== null &&
                  currentBlock > r.close_height + 600);

              // Status pill
              let statusPill = (
                <span className="px-2 py-0.5 rounded-sm text-[11px] font-medium border border-[#C8763A]/40 text-[#C8763A] bg-[#C8763A]/10">
                  Open
                </span>
              );

              if (r.status === "Settled") {
                if (r.entry_count === 0) {
                  statusPill = (
                    <span className="px-2 py-0.5 rounded-sm text-[11px] font-medium border border-[#2A2620] text-[#8C8478] bg-[#2A2620]/20">
                      No players
                    </span>
                  );
                } else {
                  statusPill = (
                    <span className="px-2 py-0.5 rounded-sm text-[11px] font-medium border border-[#5FA88A]/40 text-[#5FA88A] bg-[#5FA88A]/10">
                      Settled
                    </span>
                  );
                }
              } else if (r.status === "Refunded") {
                statusPill = (
                  <span className="px-2 py-0.5 rounded-sm text-[11px] font-medium border border-[#C2483D]/40 text-[#C2483D] bg-[#C2483D]/10">
                    Refunded
                  </span>
                );
              } else if (isRoundExpired) {
                if (r.entry_count === 0) {
                  statusPill = (
                    <span className="px-2 py-0.5 rounded-sm text-[11px] font-medium border border-[#2A2620] text-[#8C8478] bg-[#2A2620]/20">
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
              } else if (isWindowClosed) {
                statusPill = (
                  <span className="px-2 py-0.5 rounded-sm text-[11px] font-medium border border-[#2A2620] text-[#8C8478] bg-[#2A2620]/20">
                    {r.entry_count === 0 ? "No players" : "Closed"}
                  </span>
                );
              } else if (r.status === "Revealing") {
                statusPill = (
                  <span className="px-2 py-0.5 rounded-sm text-[11px] font-medium border border-[#2A2620] text-[#8C8478]">
                    Revealing
                  </span>
                );
              }

              // Winning tile (hide tile number if 0 players joined)
              const winningTileDisplay =
                (r.status === "Settled" || isRoundExpired || isWindowClosed) && r.entry_count === 0 ? (
                  <span className="text-[#8C8478]">—</span>
                ) : r.winning_tile !== null ? (
                  <span className="font-mono font-bold text-[#E3C07A]">
                    Tile #{r.winning_tile}
                  </span>
                ) : (
                  <span className="text-[#8C8478]">—</span>
                );

              // User result & action button
              const entry = userEntries?.[r.round_id];
              let userResult = <span className="text-[#8C8478]">—</span>;

              if (entry) {
                if (r.status === "Settled" && r.winning_tile !== null) {
                  const isWinner = entry.mask !== null && ((entry.mask & (1 << r.winning_tile)) !== 0);
                  if (isWinner) {
                    if (entry.claimed) {
                      userResult = (
                        <span className="text-[#5FA88A] font-mono text-[11px] font-semibold">
                          Won (Claimed ✓)
                        </span>
                      );
                    } else {
                      userResult = (
                        <div className="flex items-center space-x-2">
                          <span className="text-[#E3C07A] font-bold font-mono">Won!</span>
                          {onClaim && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onClaim(r.round_id);
                              }}
                              className="py-1 px-2.5 rounded-sm bg-[#E3C07A] hover:bg-[#ebd299] text-[#0E0D0B] text-[11px] font-bold transition-colors shadow-sm"
                            >
                              Claim Payout
                            </button>
                          )}
                        </div>
                      );
                    }
                  } else {
                    // Player lost
                    if (entry.claimed) {
                      userResult = (
                        <span className="text-[#8C8478] font-mono text-[11px]">
                          Lost (Reclaimed ✓)
                        </span>
                      );
                    } else {
                      userResult = (
                        <div className="flex items-center space-x-2">
                          <span className="text-[#C2483D] font-mono text-[11px]">Lost</span>
                          {onReclaimStorage && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onReclaimStorage(r.round_id);
                              }}
                              className="py-1 px-2.5 rounded-sm border border-[#C8763A]/60 hover:border-[#C8763A] bg-[#C8763A]/10 text-[#EDE6DA] text-[11px] font-medium transition-colors"
                              title="Reclaim your 0.01 NEAR entry storage deposit"
                            >
                              Reclaim 0.01 NEAR
                            </button>
                          )}
                        </div>
                      );
                    }
                  }
                } else if (r.status === "Refunded" || isRoundExpired) {
                  if (entry.refunded) {
                    userResult = (
                      <span className="text-[#8C8478] font-mono text-[11px]">Refunded ✓</span>
                    );
                  } else {
                    userResult = (
                      <div className="flex items-center space-x-2">
                        <span className="text-[#C8763A] font-mono text-[11px]">Expired</span>
                        {onRefundExpired && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRefundExpired(r.round_id);
                            }}
                            className="py-1 px-2.5 rounded-sm bg-[#C8763A] hover:bg-[#d88244] text-[#0E0D0B] text-[11px] font-bold transition-colors"
                          >
                            Refund 100%
                          </button>
                        )}
                      </div>
                    );
                  }
                } else {
                  userResult = (
                    <span className="text-[#E3C07A] font-mono text-[11px]">
                      Entry Sealed 🔒
                    </span>
                  );
                }
              }

              return (
                <tr
                  key={r.round_id}
                  onClick={() => onInspectRound?.(r)}
                  className="hover:bg-[#1f1d19] transition-colors cursor-pointer"
                  title="Click to view round on Play board"
                >
                  <td className="py-3.5 px-3 sm:px-4 font-mono font-bold text-[#EDE6DA]">
                    #{r.round_id}
                  </td>
                  <td className="py-3.5 px-3 sm:px-4">{winningTileDisplay}</td>
                  <td className="py-3.5 px-4 font-mono text-[#EDE6DA] hidden md:table-cell">
                    <div>{formatYoctoNear(r.total_net, 3)} NEAR</div>
                    {r.status === "Settled" && r.entry_count > 0 && r.winning_tile !== null && r.per_tile_totals?.[r.winning_tile] === "0" && (
                      <div className="text-[10px] text-[#C8763A] font-mono">
                        Rolled over ➔ #{r.round_id + 1}
                      </div>
                    )}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-[#8C8478] hidden sm:table-cell">
                    {r.entry_count}
                  </td>
                  <td className="py-3.5 px-3 sm:px-4">{statusPill}</td>
                  <td className="py-3.5 px-4">{userResult}</td>
                  <td className="py-3.5 px-3 sm:px-4 text-right">
                    {r.status === "Settled" && r.entry_count > 0 ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onVerifyFairness(r);
                        }}
                        className="py-1 px-3 rounded-sm border border-[#5FA88A] hover:bg-[#5FA88A]/10 text-[#5FA88A] text-xs font-semibold transition-colors"
                      >
                        Verify
                      </button>
                    ) : r.status === "Refunded" ? (
                      <span className="text-[#8C8478] text-[11px] font-mono">Refunded</span>
                    ) : (
                      <span className="text-[#8C8478] text-[11px]">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
