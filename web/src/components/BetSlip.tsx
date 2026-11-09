import React, { useState, useEffect } from "react";
import { RoundView, EntryView, formatYoctoNear } from "../services/near";
import { Lock, Loader2, ExternalLink, Zap, CheckCircle2 } from "lucide-react";
import util from "tweetnacl-util";
import { getPickSalt } from "../crypto/cvm";
import { CONFIG } from "../config";
import { sessionKeyService } from "../services/sessionKey";
import { walletService } from "../services/wallet";
import { CrossChainModal } from "./CrossChainModal";

interface BetSlipProps {
  accountId: string | null;
  round: RoundView | null;
  entry: EntryView | null;
  currentBlock: number | null;
  selectedTiles: Set<number>;
  onRemoveTile: (tileIndex: number) => void;
  onDeploy: (stakeNear: string, referralCode?: string) => Promise<void>;
  onClaim: () => Promise<void>;
  onReclaimStorage: () => Promise<void>;
  onRefundExpired: () => Promise<void>;
  onConnectWallet: () => void;
  isDeploying: boolean;
  isViewingPastRound?: boolean;
  onBackToLiveRound?: () => void;
}

export const BetSlip: React.FC<BetSlipProps> = ({
  accountId,
  round,
  entry,
  currentBlock,
  selectedTiles,
  onRemoveTile,
  onDeploy,
  onClaim,
  onReclaimStorage,
  onRefundExpired,
  onConnectWallet,
  isDeploying,
  isViewingPastRound = false,
  onBackToLiveRound,
}) => {
  const [stakeAmount, setStakeAmount] = useState<string>("0.1");
  const [referralCode, setReferralCode] = useState<string>("");
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
  const [showCrossChainModal, setShowCrossChainModal] = useState<boolean>(false);
  const [isSessionActive, setIsSessionActive] = useState<boolean>(() =>
    accountId ? sessionKeyService.getSessionState(accountId).isActive : false
  );
  const [enablingSession, setEnablingSession] = useState<boolean>(false);

  useEffect(() => {
    return sessionKeyService.subscribe(accountId, (state) => {
      setIsSessionActive(state.isActive);
    });
  }, [accountId]);

  const handleToggleSessionKey = async () => {
    if (!accountId) return;
    setEnablingSession(true);
    try {
      if (isSessionActive) {
        await walletService.disableSessionKey();
      } else {
        await walletService.enableSessionKey(24, "5");
      }
    } catch (err: any) {
      console.warn("Session key toggle warning:", err.message);
    } finally {
      setEnablingSession(false);
    }
  };

  const [connectedChain, setConnectedChain] = useState<"near" | "solana" | "evm">(() =>
    walletService.getConnectedChain()
  );
  const [foreignAddress, setForeignAddress] = useState<string | null>(() =>
    walletService.getForeignAddress()
  );

  useEffect(() => {
    return walletService.subscribe((state) => {
      setConnectedChain(state.connectedChain || "near");
      setForeignAddress(state.foreignAddress || null);
    });
  }, []);

  // Derive chain type with bulletproof fallback based on accountId prefix
  const activeChain =
    connectedChain === "evm" || accountId?.startsWith("evm_")
      ? "evm"
      : connectedChain === "solana" || accountId?.startsWith("sol_")
      ? "solana"
      : "near";

  const isEvm = activeChain === "evm";
  const isSolana = activeChain === "solana";

  const currencySymbol = isEvm ? "ETH" : isSolana ? "SOL" : "NEAR";
  const stakePresets = isEvm ? ["0.001", "0.005", "0.01"] : isSolana ? ["0.01", "0.05", "0.1"] : ["0.1", "0.5", "1"];

  const faucetLink = isEvm 
    ? "https://faucet.quicknode.com/base/sepolia" 
    : isSolana 
    ? "https://faucet.solana.com/" 
    : CONFIG.FAUCET_URL;

  const faucetLabel = isEvm 
    ? "Get Base Sepolia ETH" 
    : isSolana 
    ? "Get Solana Devnet SOL" 
    : "Get Testnet NEAR";

  useEffect(() => {
    if (isEvm) setStakeAmount("0.001");
    else if (isSolana) setStakeAmount("0.01");
    else setStakeAmount("0.1");
  }, [activeChain]);

  const isConnected = !!accountId;
  const isWindowClosed = currentBlock !== null && round ? currentBlock > round.close_height : false;
  const isRoundOpen = round?.status === "Open" && !isWindowClosed;
  const isSettled = round?.status === "Settled";
  const isRevealing = round?.status === "Revealing";

  // Check if player won or lost
  let hasWon = false;
  let hasLost = false;
  if (isSettled && entry && round?.winning_tile !== null) {
    const winningTile = round.winning_tile;
    if (entry.mask !== null && entry.mask !== undefined) {
      hasWon = (entry.mask & (1 << winningTile)) !== 0;
      hasLost = !hasWon;
    } else {
      const localPick = accountId && round ? getPickSalt(round.round_id, accountId) : null;
      if (localPick) {
        hasWon = (localPick.mask & (1 << winningTile)) !== 0;
        hasLost = !hasWon;
      }
    }
  }

  // Check timeout refund: only eligible if marked Refunded or after full on-chain timeout (+600 blocks)
  const isTimeout =
    round &&
    round.status !== "Settled" &&
    (round.status === "Refunded" ||
      (currentBlock !== null && currentBlock > round.close_height + 600));

  // Breakdown calculations
  const stakeVal = parseFloat(stakeAmount) || 0;
  const fee10Pct = (stakeVal * 0.1).toFixed(3);
  const totalNear = (stakeVal + 0.01).toFixed(3); // stake + 0.01 NEAR entry storage

  // Handle Deploy
  const handleDeployClick = async () => {
    if (!isConnected) {
      onConnectWallet();
      return;
    }
    await onDeploy(stakeAmount, referralCode.trim() || undefined);
  };

  // State: My Entry (already entered)
  if (entry) {
    return (
      <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#2A2620]">
          <h3 className="font-fraunces text-base font-bold text-[#EDE6DA]">My Entry</h3>
          <span className="font-mono text-xs text-[#8C8478]">Round #{round?.round_id}</span>
        </div>

        {/* Won State: gold "Won" with amount + gold Claim button */}
        {hasWon && (
          <div className="space-y-3 pt-1">
            <div className="p-3 bg-[#E3C07A]/10 border border-[#E3C07A]/30 rounded-sm">
              <div className="text-xs font-bold text-[#E3C07A] uppercase tracking-wider">Result</div>
              <div className="font-fraunces text-xl font-black text-[#E3C07A] mt-0.5">
                Won on Tile #{round?.winning_tile}
              </div>
              <div className="font-mono text-xs text-[#EDE6DA] mt-1">
                Pot share: {isEvm
                  ? `~${((parseFloat(formatYoctoNear(round?.total_net || "0", 4)) || 0) / 1000).toFixed(4)} ETH (${formatYoctoNear(round?.total_net || "0", 3)} NEAR)`
                  : isSolana
                  ? `~${((parseFloat(formatYoctoNear(round?.total_net || "0", 4)) || 0) / 100).toFixed(4)} SOL (${formatYoctoNear(round?.total_net || "0", 3)} NEAR)`
                  : `${formatYoctoNear(round?.total_net || "0", 3)} NEAR`}
              </div>
            </div>

            {entry.claimed ? (
              <div className="p-3 bg-[#5FA88A]/10 border border-[#5FA88A]/30 rounded-sm space-y-1.5 text-center">
                <div className="font-fraunces text-sm font-bold text-[#5FA88A]">
                  Claimed {isEvm ? "ETH" : isSolana ? "SOL" : `${formatYoctoNear(round?.total_net || "0", 2)} NEAR`}
                </div>
                <div className="flex items-center justify-center space-x-1 text-[11px] font-mono">
                  <span className="text-[#8C8478]">Payout sent to wallet</span>
                  <span>•</span>
                  <a
                    href={`${CONFIG.EXPLORER_URL}/address/${accountId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#C8763A] hover:underline inline-flex items-center space-x-0.5"
                  >
                    <span>View on Nearblocks</span>
                    <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
                  </a>
                </div>
              </div>
            ) : (
              <button
                onClick={async () => {
                  if (isEvm || isSolana) {
                    setShowCrossChainModal(true);
                    return;
                  }
                  setIsActionLoading(true);
                  try {
                    await onClaim();
                  } finally {
                    setIsActionLoading(false);
                  }
                }}
                disabled={isActionLoading}
                className="w-full py-2.5 rounded-sm bg-[#E3C07A] hover:bg-[#ebd299] text-[#0E0D0B] font-bold text-xs transition-colors flex items-center justify-center space-x-1.5 shadow-sm"
              >
                {isActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Claim Payout in {currencySymbol}</span>
              </button>
            )}
          </div>
        )}

        {/* Lost State: brick-red "Lost" with no glow */}
        {hasLost && (
          <div className="space-y-3 pt-1">
            <div className="p-3 bg-[#C2483D]/10 border border-[#C2483D]/30 rounded-sm">
              <div className="text-xs font-bold text-[#C2483D] uppercase tracking-wider">Result</div>
              <div className="font-fraunces text-lg font-bold text-[#C2483D] mt-0.5">
                Lost (Tile #{round?.winning_tile})
              </div>
            </div>

            {entry.claimed ? (
              <div className="p-3 bg-[#1A1815] border border-[#2A2620] rounded-sm space-y-1.5 text-center">
                <div className="font-mono text-xs font-semibold text-[#8C8478]">
                  Storage Deposit Reclaimed (0.01 NEAR)
                </div>
                <div className="flex items-center justify-center space-x-1 text-[11px] font-mono">
                  <span className="text-[#8C8478]">Returned to wallet</span>
                  <span>•</span>
                  <a
                    href={`${CONFIG.EXPLORER_URL}/address/${accountId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#C8763A] hover:underline inline-flex items-center space-x-0.5"
                  >
                    <span>View on Nearblocks</span>
                    <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
                  </a>
                </div>
              </div>
            ) : (
              <button
                onClick={async () => {
                  setIsActionLoading(true);
                  try {
                    await onReclaimStorage();
                  } finally {
                    setIsActionLoading(false);
                  }
                }}
                disabled={isActionLoading}
                className="w-full py-2.5 rounded-sm border border-[#2A2620] hover:border-[#8C8478] text-[#EDE6DA] font-medium text-xs transition-colors flex items-center justify-center space-x-1.5"
              >
                {isActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Reclaim 0.01 NEAR Storage</span>
              </button>
            )}
          </div>
        )}

        {/* Timeout Expired State: copper Refund button */}
        {isTimeout && !entry.refunded && !hasWon && !hasLost && (
          <div className="space-y-3 pt-1">
            <div className="p-3 bg-[#1A1815] border border-[#C8763A]/40 rounded-sm">
              <div className="text-xs font-bold text-[#C8763A] uppercase tracking-wider">Timeout Reached</div>
              <div className="text-xs text-[#EDE6DA] mt-1">
                Round did not settle in time. 100% of your deposit is refundable with 0 fees.
              </div>
            </div>

            <button
              onClick={async () => {
                setIsActionLoading(true);
                try {
                  await onRefundExpired();
                } finally {
                  setIsActionLoading(false);
                }
              }}
              disabled={isActionLoading}
              className="w-full py-2.5 rounded-sm bg-[#C8763A] hover:bg-[#d88244] text-[#0E0D0B] font-bold text-xs transition-colors flex items-center justify-center space-x-1.5"
            >
              {isActionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              <span>Refund 100% ({formatYoctoNear(entry.gross_stake)} NEAR)</span>
            </button>
          </div>
        )}

        {/* Sealed State (Round Open or Revealing) */}
        {!hasWon && !hasLost && !isTimeout && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#8C8478]">Selected Picks:</span>
              <span className="font-mono text-sm tracking-widest text-[#C8763A]">••••••••</span>
            </div>

            <div className="space-y-1.5 p-3 bg-[#0E0D0B] border border-[#2A2620] rounded-sm text-xs font-mono">
              <div className="flex justify-between text-[#8C8478]">
                <span>Stake:</span>
                <span className="text-[#EDE6DA]">{formatYoctoNear(entry.gross_stake)} NEAR</span>
              </div>
              <div className="flex justify-between text-[#8C8478]">
                <span>Net in Pot:</span>
                <span className="text-[#EDE6DA]">{formatYoctoNear(entry.net_stake)} NEAR</span>
              </div>
              <div className="pt-1.5 border-t border-[#2A2620] text-[10px] text-[#8C8478] truncate">
                Commit: {util.encodeBase64(new Uint8Array(entry.commit))}
              </div>
            </div>

            <div className="text-[11px] text-[#8C8478] leading-tight">
              {isRevealing
                ? "TEE is decrypting picks and calculating winning tile..."
                : "Picks are sealed and hidden. Only the TEE can decrypt them once the deposit window closes."}
            </div>
          </div>
        )}
      </div>
    );
  }

  // State: Bet Slip (placing a bet)
  return (
    <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm p-5 space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-[#2A2620]">
        <h3 className="font-fraunces text-base font-bold text-[#EDE6DA]">Bet Slip</h3>
        <span className="text-xs font-mono text-[#8C8478]">
          {selectedTiles.size} {selectedTiles.size === 1 ? "tile" : "tiles"}
        </span>
      </div>

      {/* Historical / Closed Round Notice */}
      {isViewingPastRound && (
        <div className="p-3 bg-[#0E0D0B] border border-[#E3C07A]/40 rounded-sm text-xs text-[#E3C07A] flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-[#E3C07A] flex-shrink-0 animate-pulse"></span>
          <span>Viewing past Round #{round?.round_id}. Betting is closed for historical rounds.</span>
        </div>
      )}

      {/* Selected tiles as small copper chips */}
      <div className={isViewingPastRound || !isRoundOpen ? "opacity-25 pointer-events-none" : ""}>
        <div className="text-[11px] text-[#8C8478] uppercase tracking-wider mb-1.5">
          Selected Tiles
        </div>
        {isViewingPastRound ? (
          <div className="text-xs text-[#8C8478] italic">No active selection • Return to live round to place bets</div>
        ) : selectedTiles.size > 0 ? (
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {Array.from(selectedTiles).sort((a, b) => a - b).map((tile) => (
              <span
                key={tile}
                onClick={() => {
                  if (isViewingPastRound || !isRoundOpen) return;
                  onRemoveTile(tile);
                }}
                className={`px-2 py-0.5 rounded-sm bg-[#C8763A]/10 border border-[#C8763A]/40 text-[#C8763A] font-mono text-xs transition-colors ${
                  isViewingPastRound || !isRoundOpen ? "cursor-not-allowed" : "cursor-pointer hover:bg-[#C8763A]/20"
                }`}
                title={isViewingPastRound || !isRoundOpen ? "Selection locked" : "Click to remove"}
              >
                #{tile} ×
              </span>
            ))}
          </div>
        ) : (
          <div className="text-xs text-[#8C8478] italic">Click tiles on the grid to select</div>
        )}
      </div>

      {/* Stake Amount Input with quick buttons */}
      <div className={`space-y-2 ${isViewingPastRound || !isRoundOpen ? "opacity-25 pointer-events-none" : ""}`}>
        <label className="block text-[11px] text-[#8C8478] uppercase tracking-wider">
          Stake Amount ({currencySymbol}{isEvm ? " on Base" : isSolana ? " on Solana" : ""})
        </label>
        <div className="flex items-center space-x-2">
          {stakePresets.map((p) => (
            <button
              key={p}
              type="button"
              disabled={isViewingPastRound || !isRoundOpen}
              onClick={() => setStakeAmount(p)}
              className={`flex-1 py-1 px-2 rounded-sm border text-xs font-mono transition-colors ${
                stakeAmount === p
                  ? isEvm
                    ? "border-[#0052FF] text-[#0052FF] bg-[#0052FF]/10 font-bold"
                    : isSolana
                    ? "border-[#9945FF] text-[#9945FF] bg-[#9945FF]/10 font-bold"
                    : "border-[#C8763A] text-[#C8763A] bg-[#C8763A]/10 font-bold"
                  : "border-[#2A2620] text-[#8C8478] hover:text-[#EDE6DA]"
              } disabled:cursor-not-allowed`}
            >
              {p}
            </button>
          ))}
        </div>
        <input
          type="number"
          step={isEvm ? "0.0005" : isSolana ? "0.005" : "0.01"}
          min={isEvm ? "0.0001" : isSolana ? "0.001" : "0.01"}
          max="20"
          disabled={isViewingPastRound || !isRoundOpen}
          value={stakeAmount}
          onChange={(e) => setStakeAmount(e.target.value)}
          className="w-full bg-[#0E0D0B] border border-[#2A2620] focus:border-[#C8763A] rounded-sm px-3 py-1.5 text-xs font-mono text-[#EDE6DA] focus:outline-none disabled:cursor-not-allowed"
        />
      </div>

      {/* Optional referral code field */}
      <div className={isViewingPastRound || !isRoundOpen ? "opacity-25 pointer-events-none" : ""}>
        <label className="block text-[11px] text-[#8C8478] uppercase tracking-wider mb-1">
          Referral Code (Optional)
        </label>
        <input
          type="text"
          disabled={isViewingPastRound || !isRoundOpen}
          value={referralCode}
          onChange={(e) => setReferralCode(e.target.value)}
          placeholder="e.g. alice.testnet"
          className="w-full bg-[#0E0D0B] border border-[#2A2620] focus:border-[#C8763A] rounded-sm px-3 py-1.5 text-xs font-mono text-[#EDE6DA] focus:outline-none placeholder-[#8C8478]/50 disabled:cursor-not-allowed"
        />
      </div>

      {/* Fee breakdown in muted mono, total in #EDE6DA */}
      <div className={`pt-2 border-t border-[#2A2620] space-y-1 font-mono text-xs ${
        isViewingPastRound || !isRoundOpen ? "opacity-25" : ""
      }`}>
        <div className="flex justify-between text-[#8C8478]">
          <span>Stake Amount:</span>
          <span>{stakeVal.toFixed(isEvm || isSolana ? 4 : 3)} {currencySymbol}</span>
        </div>
        <div className="flex justify-between text-[#8C8478]">
          <span>Net Pot Allocation (90%):</span>
          <span>{(stakeVal * 0.9).toFixed(isEvm || isSolana ? 4 : 3)} {currencySymbol}</span>
        </div>
        <div className="flex justify-between text-[#8C8478] text-[11px]">
          <span>Gas & State Storage:</span>
          <span className="text-[#22C55E]">Sponsored / Refunded</span>
        </div>
        <div className="flex justify-between text-[#EDE6DA] font-semibold pt-1 border-t border-[#2A2620]">
          <span>Total Stake:</span>
          <span>{stakeVal.toFixed(isEvm || isSolana ? 4 : 3)} {currencySymbol}</span>
        </div>
        <div className="text-[10px] text-[#8C8478]/80 text-right">
          {isEvm || isSolana
            ? `*Universal cross-chain settlement • Winnings claimable directly in ${currencySymbol}`
            : "*Includes 0.01 NEAR entry storage automatically returned on draw"}
        </div>
      </div>

      {/* 1-Click Fast Play Session Banner (NEAR only) */}
      {!isEvm && !isSolana && isConnected && !isViewingPastRound && (
        <div className="flex items-center justify-between p-2 rounded-sm bg-[#0E0D0B] border border-[#2A2620] text-xs">
          <div className="flex items-center space-x-1.5">
            <Zap className={`w-3.5 h-3.5 ${isSessionActive ? "text-[#22C55E]" : "text-[#8C8478]"}`} />
            <span className="text-[#EDE6DA] text-[11px] font-mono">
              {isSessionActive ? "1-Click Fast Play: Active" : "1-Click Fast Play: Off"}
            </span>
          </div>
          <button
            type="button"
            onClick={handleToggleSessionKey}
            disabled={enablingSession}
            className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-sm transition-colors border ${
              isSessionActive
                ? "border-[#2A2620] text-[#8C8478] hover:text-[#EDE6DA]"
                : "border-[#22C55E]/60 text-[#22C55E] bg-[#22C55E]/10 hover:bg-[#22C55E]/20"
            }`}
          >
            {enablingSession ? "Updating..." : isSessionActive ? "Disable" : "⚡ Enable"}
          </button>
        </div>
      )}

      {/* Quick Account Address & Faucet Bar */}
      {isConnected && (
        <div className="flex items-center justify-between text-[11px] font-mono text-[#8C8478] px-1 py-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const toCopy = foreignAddress || accountId;
              if (toCopy) {
                navigator.clipboard.writeText(toCopy);
              }
            }}
            className="hover:text-[#EDE6DA] flex items-center space-x-1 transition-colors group text-left"
            title="Click to copy account address"
          >
            <span className="text-[#8C8478]">
              {isEvm ? "Base:" : isSolana ? "Solana:" : "NEAR:"}
            </span>
            <span className="text-[#EDE6DA] group-hover:text-[#C8763A] underline truncate max-w-[130px] sm:max-w-[150px]">
              {foreignAddress ? `${foreignAddress.slice(0, 6)}...${foreignAddress.slice(-4)}` : accountId}
            </span>
          </button>
          <a
            href={faucetLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#C8763A] hover:text-[#d88244] hover:underline flex items-center space-x-1 transition-colors"
            title={`Get free testnet ${currencySymbol}`}
          >
            <span>{faucetLabel}</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      )}

      {/* Big Action Button */}
      {isViewingPastRound ? (
        <button
          type="button"
          onClick={() => onBackToLiveRound?.()}
          className="w-full py-3 rounded-sm bg-[#C8763A] hover:bg-[#d88244] text-[#0E0D0B] font-bold text-xs tracking-wider transition-colors uppercase flex items-center justify-center space-x-2 shadow-md"
        >
          <span>← Back to Live Round to Play</span>
        </button>
      ) : isEvm || isSolana ? (
        <button
          type="button"
          onClick={() => setShowCrossChainModal(true)}
          disabled={!isRoundOpen || selectedTiles.size === 0}
          className={`w-full py-3 rounded-sm font-bold text-xs tracking-wider transition-all uppercase flex items-center justify-center space-x-2 shadow-md ${
            isEvm 
              ? "bg-[#0052FF] hover:bg-[#0045d8] text-white" 
              : "bg-[#9945FF] hover:bg-[#8338eb] text-white"
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          <Zap className="w-4 h-4 fill-current" />
          <span>
            {selectedTiles.size === 0 
              ? "Select Tiles to Bet"
              : isEvm 
              ? `⚡ Pay ${stakeAmount} ETH with MetaMask (Base)` 
              : `⚡ Pay ${stakeAmount} SOL with Phantom (Solana)`}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleDeployClick}
          disabled={isDeploying || !isRoundOpen}
          className="w-full py-3 rounded-sm bg-[#C8763A] hover:bg-[#d88244] disabled:opacity-40 text-[#0E0D0B] font-bold text-xs tracking-wider transition-colors uppercase flex items-center justify-center space-x-2"
        >
          {isDeploying ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Encrypting & Deploying...</span>
            </>
          ) : !isRoundOpen ? (
            isWindowClosed && round?.status === "Open" ? (
              <span>Closing…</span>
            ) : isRevealing ? (
              <span>Drawing…</span>
            ) : (
              <span>Next round opens soon…</span>
            )
          ) : !isConnected ? (
            <span>Connect Wallet to Deploy</span>
          ) : isSessionActive ? (
            <span className="flex items-center space-x-1.5">
              <Zap className="w-3.5 h-3.5 text-[#0E0D0B] fill-current" />
              <span>⚡ Deploy Bet (Instant • No Popups)</span>
            </span>
          ) : (
            <span>Encrypt & Deploy</span>
          )}
        </button>
      )}

      {/* Track 1: Pay with Base / Solana Button (NEAR mode only) */}
      {!isEvm && !isSolana && isConnected && !isViewingPastRound && isRoundOpen && (
        <button
          type="button"
          onClick={() => setShowCrossChainModal(true)}
          className="w-full py-2.5 rounded-sm border border-[#2A2620] hover:border-[#22C55E]/60 bg-[#0E0D0B] text-[#EDE6DA] hover:text-[#22C55E] text-xs font-mono transition-colors flex items-center justify-center space-x-1.5 shadow-sm"
        >
          <span className="text-[#22C55E]">⚡</span>
          <span>Pay from Base / EVM / Solana</span>
        </button>
      )}

      {/* Under it: lock line or historical note */}
      <div className="flex items-center justify-center space-x-1.5 text-[11px] text-[#8C8478] pt-1">
        <Lock className="w-3 h-3 text-[#8C8478] flex-shrink-0" />
        <span>
          {isViewingPastRound
            ? "Deposits are only accepted on the active live round."
            : "Picks are encrypted in your browser. Only the TEE can decrypt them."}
        </span>
      </div>

      <CrossChainModal
        isOpen={showCrossChainModal}
        onClose={() => setShowCrossChainModal(false)}
        accountId={accountId}
        roundId={round?.round_id}
        selectedTiles={Array.from(selectedTiles)}
        stakeNear={stakeVal}
        expectedAmount={stakeAmount}
      />
    </div>
  );
};
