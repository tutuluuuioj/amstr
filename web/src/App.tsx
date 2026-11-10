import React, { useState, useEffect, useCallback, useRef } from "react";
import { TopBar, NavTab } from "./components/TopBar";
import { RoundPanel } from "./components/RoundPanel";
import { MineGrid } from "./components/MineGrid";
import { BetSlip } from "./components/BetSlip";
import { DeploysFeedAndWinnersProps as DeploysFeedAndWinners } from "./components/DeploysFeedAndWinners";
import { RoundsPage } from "./pages/RoundsPage";
import { ProofPage } from "./pages/ProofPage";
import { StakePage } from "./pages/StakePage";
import { AgentPage } from "./pages/AgentPage";
import { HowItWorksPage } from "./pages/HowItWorksPage";
import { AttestationDrawer } from "./components/AttestationDrawer";
import { FairnessModal } from "./components/FairnessModal";
import { WalletModal } from "./components/WalletModal";
import { ToastContainer, ToastItem } from "./components/Toast";
import { MobileNav } from "./components/MobileNav";
import { MobileStickyBar } from "./components/MobileStickyBar";
import { walletService } from "./services/wallet";
import {
  nearRpc,
  RoundView,
  EntryView,
  JackpotPoolView,
  formatYoctoNear,
} from "./services/near";
import {
  verifyCvmKeyMatch,
  computeCommit,
  encryptClientPick,
  savePickSalt,
  getPickSalt,
} from "./crypto/cvm";
import util from "tweetnacl-util";
import { CONFIG } from "./config";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>("play");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [nearBalance, setNearBalance] = useState<string>("0");
  const [amstrBalance, setAmstrBalance] = useState<string>("0");
  const [currentBlock, setCurrentBlock] = useState<number | null>(null);
  const [isTeeHealthy, setIsTeeHealthy] = useState<boolean | null>(null);

  // Contract State
  const [activeRound, setActiveRound] = useState<RoundView | null>(null);
  const [inspectedRound, setInspectedRound] = useState<RoundView | null>(null);
  const [playerEntry, setPlayerEntry] = useState<EntryView | null>(null);
  const [roundEntries, setRoundEntries] = useState<EntryView[]>([]);
  const [jackpotPools, setJackpotPools] = useState<JackpotPoolView[] | null>(null);
  const [recentRounds, setRecentRounds] = useState<RoundView[]>([]);
  const [userHistoryEntries, setUserHistoryEntries] = useState<Record<number, EntryView | null>>({});

  // Selection & UI State
  const [selectedTiles, setSelectedTiles] = useState<Set<number>>(new Set([7, 11, 22]));
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const lastSeenRoundIdRef = useRef<number | null>(null);
  const [recentSettledBanner, setRecentSettledBanner] = useState<{
    round: RoundView;
    winningTile: number;
  } | null>(null);
  const [settledReveal, setSettledReveal] = useState<{
    round: RoundView;
    winningTile: number;
    nextRoundId: number;
    secondsLeft: number;
  } | null>(null);

  // Modals & Drawers
  const [isWalletModalOpen, setIsWalletModalOpen] = useState<boolean>(false);
  const [isAttestationOpen, setIsAttestationOpen] = useState<boolean>(false);
  const [fairnessRound, setFairnessRound] = useState<RoundView | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = (type: "success" | "pending" | "error", title: string, message?: string, txHash?: string) => {
    const id = `${Date.now()}_${Math.random()}`;
    setToasts((prev) => {
      // Clear out pending spinner toast when success/error arrives
      const filtered = type !== "pending" ? prev.filter((t) => t.type !== "pending") : prev;
      return [...filtered, { id, type, title, message, txHash }];
    });
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, type === "pending" ? 12000 : 7000);
    return id;
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Initialize Wallet Selector
  useEffect(() => {
    walletService
      .init()
      .then((state) => {
        setAccountId(state.accountId);
      })
      .catch((err) => {
        console.error("Wallet Selector Error:", err);
      });

    const unsubscribe = walletService.subscribe((state) => {
      setAccountId(state.accountId);
    });

    return () => unsubscribe();
  }, []);

  // Update Account Balances
  useEffect(() => {
    if (!accountId) {
      setNearBalance("0");
      setAmstrBalance("0");
      return;
    }

    nearRpc.getAccountBalance(accountId).then(setNearBalance).catch(console.warn);
    nearRpc.getAmstrTokenBalance(accountId).then(setAmstrBalance).catch(console.warn);
  }, [accountId]);

  // Poll TEE CVM /health (Requirement 2)
  const pollTeeHealth = useCallback(async () => {
    try {
      const h = await nearRpc.checkCvmHealth();
      setIsTeeHealthy(h.isHealthy);
    } catch {
      setIsTeeHealthy(false);
    }
  }, []);

  // Requirement 2: If TEE server cannot be reached after 10s, mark it offline (red)
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsTeeHealthy((prev) => (prev === null ? false : prev));
    }, 10000);
    return () => clearTimeout(timer);
  }, []);

  // Live contract polling (every 4 seconds)
  const fetchLiveData = useCallback(async () => {
    try {
      const [blockHeight, round, pools] = await Promise.all([
        nearRpc.getBlockHeight(),
        nearRpc.getActiveRound(),
        nearRpc.getJackpotPools().catch(() => null),
      ]);

      setCurrentBlock(blockHeight);
      setActiveRound(round);
      setJackpotPools(pools);

      // Track newly settled round to display the winning tile outcome
      if (round) {
        if (lastSeenRoundIdRef.current !== null && round.round_id > lastSeenRoundIdRef.current) {
          const prevId = lastSeenRoundIdRef.current;
          nearRpc
            .getRound(prevId)
            .then((prevRound) => {
              if (prevRound && prevRound.status === "Settled" && prevRound.winning_tile !== null) {
                // Auto-display the newly settled round on the board for 14s celebration
                setSettledReveal({
                  round: prevRound,
                  winningTile: prevRound.winning_tile,
                  nextRoundId: round.round_id,
                  secondsLeft: 14,
                });
                setRecentSettledBanner({
                  round: prevRound,
                  winningTile: prevRound.winning_tile,
                });
                addToast(
                  "success",
                  `🏆 Round #${prevId} Drawn!`,
                  `Winning Tile was #${prevRound.winning_tile}. Round #${round.round_id} is now open.`
                );
              }
            })
            .catch(console.warn);
        } else if (lastSeenRoundIdRef.current === null && round.round_id > 1) {
          // On initial page load: fetch previous round to show Recent Settled outcome banner
          nearRpc
            .getRound(round.round_id - 1)
            .then((prevRound) => {
              if (prevRound && prevRound.status === "Settled" && prevRound.winning_tile !== null) {
                setRecentSettledBanner({
                  round: prevRound,
                  winningTile: prevRound.winning_tile,
                });
              }
            })
            .catch(console.warn);
        }
        lastSeenRoundIdRef.current = round.round_id;
      }

      // Determine which round is currently displayed
      const targetRound = inspectedRound || round;

      if (targetRound) {
        const entries = await nearRpc.getRoundEntries(targetRound.round_id).catch(() => []);
        setRoundEntries(entries);

        if (accountId) {
          const entry = await nearRpc.getPlayerEntry(targetRound.round_id, accountId).catch(() => null);
          setPlayerEntry(entry);
        } else {
          setPlayerEntry(null);
        }
      }

      setRpcError(null);
    } catch (err: any) {
      console.warn("RPC query error:", err);
      setRpcError(err.message || String(err));
    }
  }, [accountId, inspectedRound]);

  // Load history rounds & user entries
  const fetchHistory = useCallback(async () => {
    try {
      const nextId = await nearRpc.getNextRoundId();
      const past: RoundView[] = [];
      const start = Math.max(1, nextId - 8);

      for (let id = nextId - 1; id >= start; id--) {
        try {
          const r = await nearRpc.getRound(id);
          if (r) past.push(r);
        } catch (_) {}
      }
      setRecentRounds(past);

      // If user is connected, fetch their entry for each past round
      if (accountId) {
        const entriesMap: Record<number, EntryView | null> = {};
        await Promise.all(
          past.map(async (r) => {
            try {
              const e = await nearRpc.getPlayerEntry(r.round_id, accountId);
              if (e) entriesMap[r.round_id] = e;
            } catch (_) {}
          })
        );
        setUserHistoryEntries(entriesMap);
      }
    } catch (err) {
      console.warn("History query error:", err);
    }
  }, [accountId]);

  useEffect(() => {
    fetchLiveData();
    fetchHistory();
    pollTeeHealth();

    const handleBetDeployed = () => {
      fetchLiveData();
      fetchHistory();
    };
    window.addEventListener("amstr:bet_deployed", handleBetDeployed);

    let ticks = 0;
    const interval = setInterval(() => {
      fetchLiveData();
      pollTeeHealth();
      ticks++;
      if (ticks % 2 === 0) {
        fetchHistory();
      }
    }, 4000);

    return () => {
      clearInterval(interval);
      window.removeEventListener("amstr:bet_deployed", handleBetDeployed);
    };
  }, [fetchLiveData, fetchHistory, pollTeeHealth]);

  // Deep linking for round inspection & fairness verification modal
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const roundParam = params.get("round") || params.get("verify_round") || params.get("fairness");
    if (roundParam) {
      const targetId = parseInt(roundParam, 10);
      if (!isNaN(targetId) && targetId > 0) {
        nearRpc
          .getRound(targetId)
          .then((r) => {
            if (r) {
              setInspectedRound(r);
              if (params.get("modal") !== "false") {
                setFairnessRound(r);
              }
            }
          })
          .catch(console.warn);
      }
    }
  }, []);

  // Auto-countdown for settled reveal celebration
  useEffect(() => {
    if (!settledReveal) return;
    if (settledReveal.secondsLeft <= 0) {
      setSettledReveal(null);
      return;
    }
    const timer = setTimeout(() => {
      setSettledReveal((prev) => (prev ? { ...prev, secondsLeft: prev.secondsLeft - 1 } : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [settledReveal]);

  // The round currently shown on the Play board:
  // 1. If user is inspecting a specific past round -> inspectedRound
  // 2. If a round just finished and is in celebration reveal -> settledReveal.round
  // 3. Otherwise -> live active round
  const displayedRound = inspectedRound || (settledReveal ? settledReveal.round : activeRound);
  const isViewingPastRound = inspectedRound !== null || settledReveal !== null;

  // Tile selection handlers (Requirement 4: 1 to 25 tiles selectable)
  const toggleTile = (index: number) => {
    if (settledReveal) {
      // Dismiss reveal and start playing on the new active round
      setSettledReveal(null);
    }
    if ((inspectedRound && !settledReveal) || playerEntry) return;
    if (activeRound?.status !== "Open") return;
    setSelectedTiles((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        if (next.size > 1) next.delete(index);
      } else {
        if (next.size < 25) next.add(index);
      }
      return next;
    });
  };

  const selectRandom5 = () => {
    if (settledReveal) setSettledReveal(null);
    if ((inspectedRound && !settledReveal) || playerEntry || activeRound?.status !== "Open") return;
    const picked = new Set<number>();
    while (picked.size < 5) {
      picked.add(Math.floor(Math.random() * 25));
    }
    setSelectedTiles(picked);
  };

  const selectHalf = () => {
    if (settledReveal) setSettledReveal(null);
    if ((inspectedRound && !settledReveal) || playerEntry || activeRound?.status !== "Open") return;
    const picked = new Set<number>();
    for (let i = 0; i < 12; i++) picked.add(i);
    setSelectedTiles(picked);
  };

  const selectAll = () => {
    if (settledReveal) setSettledReveal(null);
    if ((inspectedRound && !settledReveal) || playerEntry || activeRound?.status !== "Open") return;
    const picked = new Set<number>();
    for (let i = 0; i < 25; i++) picked.add(i);
    setSelectedTiles(picked);
  };

  const clearSelection = () => {
    if (settledReveal) setSettledReveal(null);
    if ((inspectedRound && !settledReveal) || playerEntry || activeRound?.status !== "Open") return;
    setSelectedTiles(new Set([0]));
  };

  /**
   * Requirement 1 & 8: Deploy Pick
   * Checks CVM key before encrypting -> saves salt in localStorage -> deploys on NEAR
   */
  const handleDeploy = async (stakeNear: string, referralCode?: string) => {
    if (!accountId || !displayedRound) return;
    setIsDeploying(true);
    addToast("pending", "Encrypting Pick", "Verifying CVM key & boxing with TweetNaCl...");

    try {
      const [contractCvm, cvmKeys] = await Promise.all([
        nearRpc.getCvmKey(),
        nearRpc.fetchCvmKeys(),
      ]);

      if (!contractCvm) throw new Error("Contract has no registered CVM key!");
      const keyCheck = verifyCvmKeyMatch(contractCvm.x25519_pub, cvmKeys.x25519_pub);
      if (!keyCheck.isValid) {
        throw new Error(keyCheck.error || "CVM key verification failed!");
      }

      let mask = 0;
      for (const t of selectedTiles) mask |= 1 << t;

      const cvmX25519PubBytes = util.decodeBase64(cvmKeys.x25519_pub);
      const encrypted = encryptClientPick(cvmX25519PubBytes, mask);
      const commit = computeCommit(accountId, displayedRound.round_id, mask, encrypted.salt);

      savePickSalt(displayedRound.round_id, accountId, encrypted.salt, mask, commit);

      const ciphertextBase64 = util.encodeBase64(encrypted.ciphertext);
      const commitBase64 = util.encodeBase64(commit);

      // Securely notify keeper of confidential entry secret for automated on-chain reveal
      try {
        fetch(`${CONFIG.KEEPER_URL}/player/entry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            round_id: displayedRound.round_id,
            account_id: accountId,
            mask,
            salt: util.encodeBase64(encrypted.salt),
            commit: commitBase64,
          }),
        }).catch(() => {});
      } catch (_) {}

      // If referral code provided, bind referrer on contract (1% routed from treasury)
      if (referralCode && referralCode.trim() && referralCode.trim() !== accountId) {
        try {
          await walletService.bindReferrer(referralCode.trim());
        } catch (e: any) {
          console.warn("Referrer bind notice:", e.message || String(e));
        }
      }

      // Update toast to prompt user for Meteor / WalletSelector popup approval
      addToast(
        "pending",
        "Awaiting Wallet Approval",
        "Please approve the transaction in your Meteor Wallet extension popup..."
      );

      const txResult = await walletService.deploy(
        displayedRound.round_id,
        ciphertextBase64,
        commitBase64,
        stakeNear
      );

      const txHash =
        txResult?.transaction?.hash ||
        txResult?.transaction_outcome?.id ||
        (Array.isArray(txResult) && txResult[0]?.transaction?.hash) ||
        undefined;
      addToast(
        "success",
        "Confidential Bet Deployed",
        `Round #${displayedRound.round_id} entry confirmed. Picks are sealed.`,
        txHash
      );
      fetchLiveData();
    } catch (err: any) {
      addToast("error", "Deploy Failed", err.message || String(err));
    } finally {
      setIsDeploying(false);
    }
  };

  const handleClaim = async (targetRoundId?: number) => {
    const roundId = targetRoundId ?? displayedRound?.round_id;
    if (!roundId) return;
    addToast("pending", "Claiming Payout", `Submitting claim for Round #${roundId}...`);
    try {
      const txResult = await walletService.claim([roundId]);
      const txHash = txResult?.transaction?.hash;
      addToast("success", "Payout Claimed!", "NEAR and AMSTR tokens transferred to your wallet.", txHash);
      fetchLiveData();
      fetchHistory();
    } catch (err: any) {
      addToast("error", "Claim Failed", err.message || String(err));
    }
  };

  const handleReclaimStorage = async (targetRoundId?: number) => {
    const roundId = targetRoundId ?? displayedRound?.round_id;
    if (!roundId) return;
    addToast("pending", "Reclaiming Storage", `Refunding 0.01 NEAR for Round #${roundId}...`);
    try {
      const txResult = await walletService.reclaimStorage([roundId]);
      const txHash = txResult?.transaction?.hash;
      addToast("success", "Storage Reclaimed", "0.01 NEAR entry storage refunded.", txHash);
      fetchLiveData();
      fetchHistory();
    } catch (err: any) {
      addToast("error", "Storage Reclaim Failed", err.message || String(err));
    }
  };

  const handleRefundExpired = async (targetRoundId?: number) => {
    const roundId = targetRoundId ?? displayedRound?.round_id;
    if (!roundId) return;
    addToast("pending", "Refunding Expired Round", `Requesting 100% deposit refund for Round #${roundId}...`);
    try {
      const txResult = await walletService.refundExpired(roundId);
      const txHash = txResult?.transaction?.hash;
      addToast("success", "Refund Successful", "100% of your deposit was returned with 0 fees.", txHash);
      fetchLiveData();
      fetchHistory();
    } catch (err: any) {
      addToast("error", "Refund Failed", err.message || String(err));
    }
  };

  // Pending actions from past rounds (unclaimed winnings, refunds, or unreclaimed storage)
  const unclaimedRounds = recentRounds
    .filter((r) => {
      // Don't show top banner if user is currently looking at this round on the Play screen
      if (displayedRound && r.round_id === displayedRound.round_id) return false;

      const e = userHistoryEntries[r.round_id];
      if (!e) return false;

      // 1. Settled rounds with unclaimed prize OR unreclaimed storage deposit
      if (r.status === "Settled" && !e.claimed) return true;

      // 2. Refunded rounds that haven't been refunded yet
      if (r.status === "Refunded" && !e.refunded) return true;

      // 3. Timed-out rounds (> 600 blocks past close_height) that haven't settled and haven't refunded
      if (r.status !== "Settled" && currentBlock !== null && currentBlock > r.close_height + 600 && !e.refunded) return true;

      return false;
    })
    .map((r) => {
      const e = userHistoryEntries[r.round_id]!;
      const isSettled = r.status === "Settled";
      const isWinner = isSettled && r.winning_tile !== null && e.mask !== null && ((e.mask & (1 << r.winning_tile)) !== 0);
      const isRefund = !isSettled; // Any non-settled round requiring user action is 100% refund
      return { round: r, entry: e, isWinner, isRefund };
    });

  return (
    <div className="min-h-screen bg-[#0E0D0B] text-[#EDE6DA] flex flex-col font-sans">
      {/* Top Bar (thin, always visible) */}
      <TopBar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
        }}
        accountId={accountId}
        nearBalance={nearBalance}
        amstrBalance={amstrBalance}
        isTeeHealthy={isTeeHealthy}
        onConnectWallet={() => setIsWalletModalOpen(true)}
        onDisconnectWallet={() => walletService.signOut()}
        onOpenAttestation={() => setIsAttestationOpen(true)}
      />

      {/* Sticky Mobile Bar on Play Page */}
      {activeTab === "play" && (
        <MobileStickyBar round={displayedRound} currentBlock={currentBlock} />
      )}

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 pb-20 md:pb-8">
        {/* RPC Error Banner */}
        {rpcError && (
          <div className="mb-6 p-3.5 bg-[#1A1815] border border-[#C2483D] rounded-sm text-xs flex items-center justify-between text-[#EDE6DA]">
            <div>
              <span className="font-semibold text-[#C2483D]">Connection Notice: </span>
              <span>{rpcError}</span>
            </div>
            <button
              onClick={fetchLiveData}
              className="px-2 py-1 bg-[#C2483D]/20 text-[#C2483D] hover:bg-[#C2483D]/30 rounded-sm font-medium text-[11px]"
            >
              Retry
            </button>
          </div>
        )}

        {/* Round Inspector Banner (when inspecting past settled rounds like Round 2) */}
        {inspectedRound && (
          <div className="mb-6 p-3 bg-[#1A1815] border border-[#E3C07A]/50 rounded-sm flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-[#E3C07A]"></span>
              <span className="font-semibold text-[#E3C07A]">
                Inspecting Historical Round #{inspectedRound.round_id}
              </span>
              <span className="text-[#8C8478]">
                {inspectedRound.winning_tile !== null
                  ? `(Winning Tile #${inspectedRound.winning_tile} • ${inspectedRound.entry_count} ${inspectedRound.entry_count === 1 ? "player" : "players joined"})`
                  : `(${inspectedRound.entry_count} ${inspectedRound.entry_count === 1 ? "player" : "players joined"})`}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              {inspectedRound.winning_tile !== null && (
                <button
                  onClick={() => setFairnessRound(inspectedRound)}
                  className="px-2.5 py-1 rounded-sm border border-[#5FA88A] text-[#5FA88A] hover:bg-[#5FA88A]/10 font-medium text-[11px]"
                >
                  Verify Fairness
                </button>
              )}
              <button
                onClick={() => setInspectedRound(null)}
                className="px-2.5 py-1 rounded-sm bg-[#C8763A] text-[#0E0D0B] font-bold text-[11px]"
              >
                ← Back to Live Round
              </button>
            </div>
          </div>
        )}

        {/* Unclaimed Rewards, Refunds & Storage Reclaim Banner */}
        {unclaimedRounds.length > 0 && !inspectedRound && (
          <div className="mb-6 p-3.5 bg-[#1A1815] border border-[#C8763A]/40 rounded-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md">
            <div className="flex items-center space-x-3">
              <span className="text-xl">
                {unclaimedRounds[0].isWinner ? "🏆" : unclaimedRounds[0].isRefund ? "🛡️" : "💎"}
              </span>
              <div>
                <div className="text-xs font-bold text-[#EDE6DA] flex items-center space-x-2">
                  <span>
                    Round #{unclaimedRounds[0].round.round_id}{" "}
                    {unclaimedRounds[0].isRefund
                      ? (unclaimedRounds[0].round.status === "Refunded" ? "Refunded" : "Expired (Timeout)")
                      : "Settled"}
                  </span>
                  {unclaimedRounds[0].isWinner ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#E3C07A] text-[#0E0D0B]">WINNER</span>
                  ) : unclaimedRounds[0].isRefund ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-[#5FA88A]/40 bg-[#5FA88A]/10 text-[#5FA88A]">
                      100% Refund Ready
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-[#C8763A]/40 bg-[#C8763A]/10 text-[#C8763A]">
                      Storage Deposit Ready
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[#8C8478] mt-0.5">
                  {unclaimedRounds[0].isWinner
                    ? "Your pick hit the winning tile! Claim your NEAR payout."
                    : unclaimedRounds[0].isRefund
                    ? `Round did not settle in time. 100% of your deposit (${formatYoctoNear(unclaimedRounds[0].entry.gross_stake)} NEAR) is refundable with 0 fees.`
                    : `Winning Tile #${unclaimedRounds[0].round.winning_tile ?? "?"} was drawn. Reclaim your 0.01 NEAR entry storage deposit back to your wallet.`}
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <button
                onClick={() => {
                  if (unclaimedRounds[0].isWinner) {
                    handleClaim(unclaimedRounds[0].round.round_id);
                  } else if (unclaimedRounds[0].isRefund) {
                    handleRefundExpired(unclaimedRounds[0].round.round_id);
                  } else {
                    handleReclaimStorage(unclaimedRounds[0].round.round_id);
                  }
                }}
                className={`py-1.5 px-3.5 rounded-sm text-xs font-bold transition-colors ${
                  unclaimedRounds[0].isWinner
                    ? "bg-[#E3C07A] hover:bg-[#ebd299] text-[#0E0D0B]"
                    : unclaimedRounds[0].isRefund
                    ? "bg-[#5FA88A] hover:bg-[#72b89c] text-[#0E0D0B]"
                    : "bg-[#C8763A] hover:bg-[#d88244] text-[#0E0D0B]"
                }`}
              >
                {unclaimedRounds[0].isWinner
                  ? "Claim Payout"
                  : unclaimedRounds[0].isRefund
                  ? `Refund 100% (${formatYoctoNear(unclaimedRounds[0].entry.gross_stake)} NEAR)`
                  : "Reclaim 0.01 NEAR"}
              </button>
              <button
                onClick={() => {
                  setInspectedRound(unclaimedRounds[0].round);
                }}
                className="py-1.5 px-3 rounded-sm border border-[#2A2620] hover:border-[#8C8478] text-[#EDE6DA] text-xs font-medium transition-colors"
              >
                View Board
              </button>
            </div>
          </div>
        )}

        {/* Tab 1: PLAY (Home, 3 columns on desktop) */}
        {activeTab === "play" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left column: Round panel (card #1A1815) */}
            <div className="lg:col-span-3 order-2 lg:order-1">
              <RoundPanel
                round={displayedRound}
                currentBlock={currentBlock}
                jackpotPools={jackpotPools}
                entries={roundEntries}
              />
            </div>

            {/* Center column: 5x5 tile grid (hero, biggest element) */}
            <div className="lg:col-span-6 flex flex-col items-center order-1 lg:order-2">
              {/* Live Settled Draw Celebration Banner */}
              {settledReveal && !inspectedRound ? (
                <div className="w-full max-w-[500px] mb-3.5 p-3.5 bg-gradient-to-r from-[#E3C07A]/25 via-[#1A1815] to-[#E3C07A]/25 border-2 border-[#E3C07A] rounded-sm flex items-center justify-between text-xs shadow-2xl">
                  <div className="flex items-center space-x-2.5">
                    <span className="text-2xl animate-bounce">🏆</span>
                    <div>
                      <div className="text-xs font-black text-[#E3C07A] flex items-center space-x-2">
                        <span>ROUND #{settledReveal.round.round_id} DRAW COMPLETE!</span>
                        <span className="px-2 py-0.5 rounded bg-[#E3C07A] text-[#0E0D0B] font-mono font-black text-xs shadow">
                          TILE #{settledReveal.winningTile}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#EDE6DA] mt-0.5">
                        Tile #{settledReveal.winningTile} won! Auto-advancing to Round #{settledReveal.nextRoundId} in {settledReveal.secondsLeft}s...
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setSettledReveal(null)}
                    className="px-3 py-1.5 text-xs font-bold bg-[#C8763A] hover:bg-[#d88244] text-[#0E0D0B] rounded-sm transition-colors whitespace-nowrap shadow font-mono"
                  >
                    Play Round #{settledReveal.nextRoundId} →
                  </button>
                </div>
              ) : recentSettledBanner && !inspectedRound ? (
                <div className="w-full max-w-[500px] mb-3.5 p-3 bg-gradient-to-r from-[#E3C07A]/15 via-[#1A1815] to-[#E3C07A]/15 border border-[#E3C07A]/60 rounded-sm flex items-center justify-between text-xs shadow-lg">
                  <div className="flex items-center space-x-2.5">
                    <span className="text-xl">🏆</span>
                    <div>
                      <div className="text-xs font-bold text-[#E3C07A] flex items-center space-x-1.5">
                        <span>Round #{recentSettledBanner.round.round_id} Draw Complete!</span>
                        <span className="px-1.5 py-0.5 rounded bg-[#E3C07A] text-[#0E0D0B] font-mono font-black text-[11px] shadow-sm">
                          Tile #{recentSettledBanner.winningTile}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#8C8478] mt-0.5">
                        Tile #{recentSettledBanner.winningTile} was drawn. Click to inspect winning board.
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <button
                      onClick={() => setInspectedRound(recentSettledBanner.round)}
                      className="px-2.5 py-1 text-xs font-bold bg-[#E3C07A] hover:bg-[#ebd299] text-[#0E0D0B] rounded-sm transition-colors whitespace-nowrap shadow-sm"
                    >
                      View Board
                    </button>
                    <button
                      onClick={() => setRecentSettledBanner(null)}
                      className="text-[#8C8478] hover:text-[#EDE6DA] p-1 text-xs"
                      title="Dismiss"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ) : null}

              <MineGrid
                selectedTiles={selectedTiles}
                onToggleTile={toggleTile}
                onSelectRandom5={selectRandom5}
                onSelectHalf={selectHalf}
                onSelectAll={selectAll}
                onClear={clearSelection}
                round={displayedRound}
                playerMask={
                  playerEntry?.mask ??
                  (displayedRound && accountId ? getPickSalt(displayedRound.round_id, accountId)?.mask : null) ??
                  null
                }
                disabled={displayedRound?.status !== "Open" || !!playerEntry}
                isViewingPastRound={isViewingPastRound}
              />

              {/* Below the grid: Live deploys feed & recent winners strip */}
              <DeploysFeedAndWinners
                entries={roundEntries}
                recentRounds={recentRounds}
                currentRound={displayedRound}
                onSelectRound={(r) => {
                  setInspectedRound(r);
                }}
              />
            </div>

            {/* Right column: Bet slip (card #1A1815) */}
            <div className="lg:col-span-3 order-3">
              <BetSlip
                accountId={accountId}
                round={displayedRound}
                entry={playerEntry}
                currentBlock={currentBlock}
                selectedTiles={selectedTiles}
                onRemoveTile={(t) => {
                  if (displayedRound?.status !== "Open" || playerEntry) return;
                  setSelectedTiles((prev) => {
                    const next = new Set(prev);
                    if (next.size > 1) next.delete(t);
                    return next;
                  });
                }}
                onDeploy={handleDeploy}
                onClaim={handleClaim}
                onReclaimStorage={handleReclaimStorage}
                onRefundExpired={handleRefundExpired}
                onConnectWallet={() => setIsWalletModalOpen(true)}
                isDeploying={isDeploying}
                isViewingPastRound={isViewingPastRound}
                onBackToLiveRound={() => {
                  setInspectedRound(null);
                  setSettledReveal(null);
                }}
              />
            </div>
          </div>
        )}

        {/* Tab 2: ROUNDS (History) */}
        {activeTab === "rounds" && (
          <RoundsPage
            rounds={recentRounds}
            accountId={accountId}
            currentBlock={currentBlock}
            userEntries={userHistoryEntries}
            onInspectRound={(r) => {
              setInspectedRound(r);
              setActiveTab("play");
            }}
            onVerifyFairness={(r) => setFairnessRound(r)}
            onClaim={(roundId) => handleClaim(roundId)}
            onReclaimStorage={(roundId) => handleReclaimStorage(roundId)}
            onRefundExpired={(roundId) => handleRefundExpired(roundId)}
          />
        )}

        {/* Tab 3: PROOF (Trust Center) */}
        {activeTab === "proof" && <ProofPage />}

        {/* Tab 4: STAKE */}
        {activeTab === "stake" && (
          <StakePage
            accountId={accountId}
            amstrBalance={amstrBalance}
            onConnectWallet={() => setIsWalletModalOpen(true)}
            onRefreshData={fetchLiveData}
          />
        )}

        {/* Tab 5: AI AGENT GATEWAY (MCP) */}
        {activeTab === "agent" && (
          <AgentPage
            accountId={accountId}
            nearBalance={nearBalance}
            onConnectWallet={() => setIsWalletModalOpen(true)}
          />
        )}

        {/* Tab 6: HOW IT WORKS */}
        {activeTab === "how-it-works" && <HowItWorksPage />}
      </main>

      {/* Mobile Bottom Tab Bar */}
      <MobileNav activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Toast Feedback Notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />

      {/* Wallet Connection Modal */}
      <WalletModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
      />

      {/* Attestation Drawer */}
      <AttestationDrawer
        isOpen={isAttestationOpen}
        onClose={() => setIsAttestationOpen(false)}
      />

      {/* Provable Fairness Modal */}
      <FairnessModal
        round={fairnessRound}
        isOpen={!!fairnessRound}
        onClose={() => setFairnessRound(null)}
      />
    </div>
  );
};
