import React, { useState } from "react";
import { Wallet, ShieldCheck, Lock, AlertTriangle, Trophy, Skull, RefreshCw, CheckCircle, ArrowRight, Loader2 } from "lucide-react";
import confetti from "canvas-confetti";
import { RoundView, EntryView, formatYoctoNear, nearRpc } from "../services/near";
import { verifyCvmKeyMatch, computeCommit, encryptClientPick, savePickSalt, getPickSalt } from "../crypto/cvm";
import { walletService } from "../services/wallet";
import util from "tweetnacl-util";
import { CONFIG } from "../config";

interface PlayerActionCardProps {
  accountId: string | null;
  round: RoundView | null;
  entry: EntryView | null;
  currentBlock: number | null;
  selectedTiles: Set<number>;
  onConnectWallet: () => void;
  onRefreshData: () => void;
}

export const PlayerActionCard: React.FC<PlayerActionCardProps> = ({
  accountId,
  round,
  entry,
  currentBlock,
  selectedTiles,
  onConnectWallet,
  onRefreshData,
}) => {
  const [stakeAmount, setStakeAmount] = useState<string>("0.1");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Quick stake buttons
  const STAKE_PRESETS = ["0.05", "0.1", "0.5", "1.0"];

  // Determine player state
  const isConnected = !!accountId;
  const hasEntered = !!entry;
  const isRoundOpen = round?.status === "Open";
  const isRevealing = round?.status === "Revealing";
  const isSettled = round?.status === "Settled";
  const isRefunded = round?.status === "Refunded";

  // Check if player won or lost
  let hasWon = false;
  let hasLost = false;
  if (isSettled && entry && round?.winning_tile !== null) {
    const winningTile = round.winning_tile;
    if (entry.mask !== null && entry.mask !== undefined) {
      hasWon = (entry.mask & (1 << winningTile)) !== 0;
      hasLost = !hasWon;
    } else {
      // If mask not yet in entry view, try localStorage
      const localPick = accountId && round ? getPickSalt(round.round_id, accountId) : null;
      if (localPick) {
        hasWon = (localPick.mask & (1 << winningTile)) !== 0;
        hasLost = !hasWon;
      }
    }
  }

  // Check if timeout refund is eligible (only if marked Refunded or after full on-chain timeout (+600 blocks))
  const isTimeout =
    round &&
    round.status !== "Settled" &&
    (round.status === "Refunded" ||
      (currentBlock !== null && currentBlock > round.close_height + 600));

  /**
   * Requirement 1: Check CVM key before encrypting & store salt in localStorage
   */
  const handleDeployBet = async () => {
    if (!accountId || !round) return;
    if (selectedTiles.size === 0) {
      setActionError("Please select at least 1 tile on the 5x5 grid.");
      return;
    }
    if (selectedTiles.size > 24) {
      setActionError("You cannot select all 25 tiles (max 24).");
      return;
    }

    const stakeVal = parseFloat(stakeAmount);
    if (isNaN(stakeVal) || stakeVal < 0.01) {
      setActionError("Minimum stake is 0.01 NEAR.");
      return;
    }

    setIsSubmitting(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      // Step 1: Check CVM key before encrypting (Req 1)
      const [contractCvm, cvmKeys] = await Promise.all([
        nearRpc.getCvmKey(),
        nearRpc.fetchCvmKeys(),
      ]);

      if (!contractCvm) {
        throw new Error("No CVM is registered on the smart contract!");
      }

      const keyCheck = verifyCvmKeyMatch(contractCvm.x25519_pub, cvmKeys.x25519_pub);
      if (!keyCheck.isValid) {
        throw new Error(keyCheck.error || "CVM key verification failed!");
      }

      // Step 2: Compute pick bitmask (bits 0..24)
      let mask = 0;
      for (const tile of selectedTiles) {
        mask |= 1 << tile;
      }

      // Step 3: Encrypt pick using verified CVM key
      const cvmX25519PubBytes = util.decodeBase64(cvmKeys.x25519_pub);
      const encrypted = encryptClientPick(cvmX25519PubBytes, mask);

      // Step 4: Compute on-chain commit hash
      const commit = computeCommit(accountId, round.round_id, mask, encrypted.salt);

      // Step 5: Save salt & pick in browser localStorage until round settles (Req 1)
      savePickSalt(round.round_id, accountId, encrypted.salt, mask, commit);

      // Securely notify keeper of confidential entry secret for automated on-chain reveal
      try {
        fetch(`${CONFIG.KEEPER_URL}/player/entry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            round_id: round.round_id,
            account_id: accountId,
            mask,
            salt: util.encodeBase64(encrypted.salt),
            commit: util.encodeBase64(commit),
          }),
        }).catch(() => {});
      } catch (_) {}

      // Step 6: Submit on-chain via NEAR wallet
      const ciphertextBase64 = util.encodeBase64(encrypted.ciphertext);
      const commitBase64 = util.encodeBase64(commit);

      await walletService.deploy(round.round_id, ciphertextBase64, commitBase64, stakeAmount);

      setActionSuccess("Confidential bet placed! Pick sealed in Phala Intel TDX.");
      onRefreshData();
    } catch (err: any) {
      setActionError(err.message || String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Requirement 5: One-click claim for winners
   */
  const handleClaim = async () => {
    if (!round) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await walletService.claim([round.round_id]);
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      setActionSuccess("Payout claimed successfully! Payout & tokens sent to your account.");
      onRefreshData();
    } catch (err: any) {
      setActionError(err.message || String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Requirement 5: One-click storage reclaim for losers
   */
  const handleReclaimStorage = async () => {
    if (!round) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await walletService.reclaimStorage([round.round_id]);
      setActionSuccess("0.01 NEAR entry storage deposit reclaimed successfully!");
      onRefreshData();
    } catch (err: any) {
      setActionError(err.message || String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Requirement 5: One-click refund for expired rounds
   */
  const handleRefundExpired = async () => {
    if (!round) return;
    setIsSubmitting(true);
    setActionError(null);
    try {
      await walletService.refundExpired(round.round_id);
      setActionSuccess("100% deposit refunded with zero fees!");
      onRefreshData();
    } catch (err: any) {
      setActionError(err.message || String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // 1. Not connected state
  if (!isConnected) {
    return (
      <div className="p-6 rounded-2xl bg-[#0f1422] border border-[#1e2638] text-center shadow-2xl">
        <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4 text-emerald-400">
          <Wallet className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-white mb-1">Connect Wallet to Play</h3>
        <p className="text-xs text-slate-400 max-w-sm mx-auto mb-5">
          Connect your NEAR Testnet account to place confidential bets and win NEAR + AMSTR rewards.
        </p>
        <button
          onClick={onConnectWallet}
          className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center space-x-2"
        >
          <Wallet className="w-4 h-4" />
          <span>Connect NEAR Wallet</span>
        </button>
      </div>
    );
  }

  // 2. Won state (Req 5)
  if (hasWon) {
    return (
      <div className="p-6 rounded-2xl bg-gradient-to-br from-amber-950/30 via-[#0f1422] to-[#0f1422] border border-amber-500/40 shadow-2xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-3 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-400 animate-bounce">
            <Trophy className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-amber-400">Round Result</div>
            <h3 className="text-xl font-black text-white">🏆 YOU WON!</h3>
          </div>
        </div>

        <p className="text-xs text-slate-300 mb-5 leading-relaxed">
          Your pick included Winning Tile <strong>#{round?.winning_tile}</strong>! Your share of the net pot is ready to claim.
        </p>

        {entry?.claimed ? (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center space-x-2 text-emerald-400 text-xs font-bold">
            <CheckCircle className="w-4 h-4" />
            <span>Payout & AMSTR tokens already claimed!</span>
          </div>
        ) : (
          <button
            onClick={handleClaim}
            disabled={isSubmitting}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-black font-black text-xs shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center space-x-2"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trophy className="w-4 h-4" />}
            <span>One-Click Claim Payout</span>
          </button>
        )}
      </div>
    );
  }

  // 3. Lost state (Req 5: One-click storage reclaim)
  if (hasLost) {
    return (
      <div className="p-6 rounded-2xl bg-[#0f1422] border border-[#1e2638] shadow-2xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-3 rounded-xl bg-slate-800 text-slate-400">
            <Skull className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Round Result</div>
            <h3 className="text-lg font-black text-white">💀 You Missed Tile #{round?.winning_tile}</h3>
          </div>
        </div>

        <p className="text-xs text-slate-400 mb-5 leading-relaxed">
          Better luck next round! You can reclaim your 0.01 NEAR entry storage deposit back to your wallet.
        </p>

        {entry?.claimed ? (
          <div className="p-3.5 rounded-xl bg-slate-800/60 border border-[#1e2638] flex items-center space-x-2 text-slate-400 text-xs font-medium">
            <CheckCircle className="w-4 h-4" />
            <span>Storage already reclaimed.</span>
          </div>
        ) : (
          <button
            onClick={handleReclaimStorage}
            disabled={isSubmitting}
            className="w-full py-3 rounded-xl bg-[#1c2438] hover:bg-[#25304b] text-slate-200 font-bold text-xs border border-[#2a3654] transition-all flex items-center justify-center space-x-2"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span>One-Click Reclaim 0.01 NEAR Storage</span>
          </button>
        )}
      </div>
    );
  }

  // 4. Timeout refund available (Req 5)
  if (isTimeout && hasEntered && !entry?.refunded) {
    return (
      <div className="p-6 rounded-2xl bg-rose-950/20 border border-rose-500/40 shadow-2xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-3 rounded-xl bg-rose-500/20 text-rose-400">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-rose-400">Safety Guarantee</div>
            <h3 className="text-base font-black text-white">Round Expired (Timeout Reached)</h3>
          </div>
        </div>

        <p className="text-xs text-slate-300 mb-5 leading-relaxed">
          The Intel TDX CVM did not settle within the timeout window. <strong>100% of your deposit is fully refundable with zero fees.</strong>
        </p>

        <button
          onClick={handleRefundExpired}
          disabled={isSubmitting}
          className="w-full py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg shadow-rose-600/20 transition-all flex items-center justify-center space-x-2"
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span>One-Click 100% Refund ({formatYoctoNear(entry.gross_stake)} NEAR)</span>
        </button>
      </div>
    );
  }

  // 5. Waiting for reveal state (Req 5)
  if (hasEntered && isRevealing) {
    return (
      <div className="p-6 rounded-2xl bg-[#0f1422] border border-amber-500/30 shadow-2xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 animate-spin">
            <RefreshCw className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-amber-400">Round Progress</div>
            <h3 className="text-base font-black text-white">Intel TDX Unsealing Picks...</h3>
          </div>
        </div>
        <p className="text-xs text-slate-400 mb-4 leading-relaxed">
          Deposit window is closed. The confidential enclave is unsealing the batch in hardware memory and drawing the winning tile.
        </p>
        <div className="p-3 rounded-xl bg-[#141b2c] border border-[#1e2638] text-[11px] font-mono text-slate-400 truncate">
          Commit: {util.encodeBase64(new Uint8Array(entry.commit))}
        </div>
      </div>
    );
  }

  // 6. Joined (Picks Sealed) state (Req 5)
  if (hasEntered && isRoundOpen) {
    return (
      <div className="p-6 rounded-2xl bg-[#0f1422] border border-emerald-500/30 shadow-2xl">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400">
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-400">Status: Entered</div>
            <h3 className="text-base font-black text-white">Picks Sealed in Intel TDX</h3>
          </div>
        </div>

        <p className="text-xs text-slate-300 mb-4 leading-relaxed">
          Your pick is locked and encrypted. Nobody on NEAR can inspect your chosen tiles until the round closes!
        </p>

        <div className="space-y-2 p-3.5 rounded-xl bg-[#141b2c] border border-[#1e2638] text-xs font-mono">
          <div className="flex justify-between text-slate-400">
            <span>Your Stake:</span>
            <span className="text-white font-bold">{formatYoctoNear(entry.gross_stake)} NEAR</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Net Pot Share:</span>
            <span className="text-emerald-400">{formatYoctoNear(entry.net_stake)} NEAR</span>
          </div>
          <div className="pt-2 border-t border-[#1e2638] text-[11px] text-slate-500 truncate">
            Commit: {util.encodeBase64(new Uint8Array(entry.commit))}
          </div>
        </div>
      </div>
    );
  }

  // 7. Not joined state: Betting Panel (Req 1 & 5)
  const oddsMultiplier = selectedTiles.size > 0 ? (25 / selectedTiles.size).toFixed(2) : "0.00";

  return (
    <div className="p-5 sm:p-6 rounded-2xl bg-[#0f1422] border border-[#1e2638] shadow-2xl">
      <div className="flex items-center justify-between pb-3 border-b border-[#1e2638] mb-4">
        <div className="flex items-center space-x-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <h3 className="text-base font-black text-white">Place Confidential Bet</h3>
        </div>
        <div className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
          {oddsMultiplier}x Multiplier
        </div>
      </div>

      {actionError && (
        <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {actionSuccess && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center space-x-2">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Stake Selection */}
      <div className="space-y-3 mb-5">
        <label className="block text-xs font-semibold text-slate-300">
          Stake Amount (NEAR)
        </label>
        <div className="grid grid-cols-4 gap-2">
          {STAKE_PRESETS.map((val) => (
            <button
              key={val}
              type="button"
              onClick={() => setStakeAmount(val)}
              className={`py-2 rounded-lg text-xs font-mono font-bold border transition-colors ${
                stakeAmount === val
                  ? "bg-emerald-500 text-black border-emerald-400"
                  : "bg-[#141b2c] text-slate-300 border-[#1e2638] hover:border-slate-500"
              }`}
            >
              {val}N
            </button>
          ))}
        </div>

        <input
          type="number"
          step="0.01"
          min="0.01"
          max="20"
          value={stakeAmount}
          onChange={(e) => setStakeAmount(e.target.value)}
          placeholder="Custom stake in NEAR..."
          className="w-full bg-[#141b2c] border border-[#1e2638] rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
        />
        <div className="text-[11px] text-slate-500 flex justify-between">
          <span>Storage Deposit: 0.01 NEAR (100% refundable)</span>
          <span>Max Stake: 20 NEAR</span>
        </div>
      </div>

      {/* Action Button */}
      <button
        onClick={handleDeployBet}
        disabled={isSubmitting || !isRoundOpen}
        className={`w-full py-3 rounded-xl font-black text-xs shadow-lg transition-all flex items-center justify-center space-x-2 ${
          isRoundOpen
            ? "bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/20 active:scale-98"
            : "bg-[#1c2438] text-slate-500 cursor-not-allowed border border-[#2a3652]"
        }`}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Verifying CVM & Encrypting...</span>
          </>
        ) : (
          <>
            <Lock className="w-4 h-4" />
            <span>
              {isRoundOpen
                ? `Seal Bet (${selectedTiles.size} Tiles, ${stakeAmount} NEAR)`
                : "Round Not Open for Deposits"}
            </span>
          </>
        )}
      </button>
    </div>
  );
};
