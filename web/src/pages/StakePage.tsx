import React, { useState, useEffect } from "react";
import { formatYoctoAmstr, formatYoctoNear, nearRpc, TreasuryInfoView } from "../services/near";
import { walletService } from "../services/wallet";

interface StakePageProps {
  accountId: string | null;
  amstrBalance: string;
  onConnectWallet: () => void;
  onRefreshData: () => void;
}

export const StakePage: React.FC<StakePageProps> = ({
  accountId,
  amstrBalance,
  onConnectWallet,
  onRefreshData,
}) => {
  const [stakedAmount, setStakedAmount] = useState<string>("0");
  const [pendingRewards, setPendingRewards] = useState<string>("0");
  const [totalSupply, setTotalSupply] = useState<string>("0");
  const [totalMinted, setTotalMinted] = useState<string>("0");
  const [treasuryInfo, setTreasuryInfo] = useState<TreasuryInfoView>({
    nearBalance: "0",
    oraclePrice: "0",
    capBps: 1000,
    devWithdrawn: "0",
  });
  const [inputAmount, setInputAmount] = useState<string>("0.01");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  const refreshStakingData = async () => {
    if (accountId) {
      try {
        const info = await nearRpc.getStakingUserInfo(accountId);
        setStakedAmount(info.staked);
        setPendingRewards(info.rewards);
      } catch (err) {
        console.warn("getStakingUserInfo error:", err);
      }
    }
    nearRpc.getTokenTotalSupply().then(setTotalSupply).catch(console.warn);
    nearRpc.getTotalMintedLifetime().then(setTotalMinted).catch(console.warn);
    nearRpc.getTreasuryInfo().then(setTreasuryInfo).catch(console.warn);
    onRefreshData();
  };

  useEffect(() => {
    refreshStakingData();
  }, [accountId]);

  const handleStake = async () => {
    if (!inputAmount || Number(inputAmount) <= 0) {
      setStatusMsg({ text: "Please enter an amount greater than 0.", isError: true });
      return;
    }
    setIsLoading(true);
    setStatusMsg({ text: `Staking ${inputAmount} AMSTR... Please approve the transaction in your wallet.` });
    try {
      const res = await walletService.stake(inputAmount);
      const txHash = res?.transaction?.hash || (typeof res === "string" ? res : "confirmed");
      setStatusMsg({ text: `Successfully staked ${inputAmount} AMSTR! (Tx: ${txHash.slice(0, 16)}...)` });
      await refreshStakingData();
    } catch (err: any) {
      console.error("Stake error:", err);
      setStatusMsg({ text: err.message?.slice(0, 120) || "Stake transaction failed.", isError: true });
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnstake = async () => {
    if (!inputAmount || Number(inputAmount) <= 0) {
      setStatusMsg({ text: "Please enter an amount greater than 0.", isError: true });
      return;
    }
    setIsLoading(true);
    setStatusMsg({ text: `Unstaking ${inputAmount} AMSTR... Please approve the transaction in your wallet.` });
    try {
      const res = await walletService.unstake(inputAmount);
      const txHash = res?.transaction?.hash || (typeof res === "string" ? res : "confirmed");
      setStatusMsg({ text: `Successfully unstaked ${inputAmount} AMSTR! (Tx: ${txHash.slice(0, 16)}...)` });
      await refreshStakingData();
    } catch (err: any) {
      console.error("Unstake error:", err);
      setStatusMsg({ text: err.message?.slice(0, 120) || "Unstake transaction failed.", isError: true });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClaimYield = async () => {
    if (!pendingRewards || pendingRewards === "0") {
      setStatusMsg({ text: "No claimable yield available at this moment.", isError: true });
      return;
    }
    setIsLoading(true);
    setStatusMsg({ text: "Claiming AMSTR staking yield... Please approve in your wallet." });
    try {
      const res = await walletService.claimStakingYield();
      const txHash = res?.transaction?.hash || (typeof res === "string" ? res : "confirmed");
      setStatusMsg({ text: `Claimed AMSTR yield successfully! (Tx: ${txHash.slice(0, 16)}...)` });
      await refreshStakingData();
    } catch (err: any) {
      console.error("Claim yield error:", err);
      setStatusMsg({ text: err.message?.slice(0, 120) || "Claim yield transaction failed.", isError: true });
    } finally {
      setIsLoading(false);
    }
  };

  // Token math with exact 18 decimals
  const maxCap = 2_000_000;
  // Calculate total burned: minted - supply
  let burnedYocto = 0n;
  try {
    const m = BigInt(totalMinted);
    const s = BigInt(totalSupply);
    if (m > s) burnedYocto = m - s;
  } catch {}

  // Calculate actual circulating AMSTR (18 decimals)
  let currentSupplyAmstr = 0;
  try {
    const s = BigInt(totalSupply);
    currentSupplyAmstr = Number(s / 10n ** 14n) / 10000;
  } catch {}

  const progressPct = Math.min(100, Math.max(0.01, (currentSupplyAmstr / maxCap) * 100));

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="font-fraunces text-2xl font-bold text-[#EDE6DA]">
          AMSTR Staking & Treasury
        </h1>
        <p className="text-xs text-[#8C8478] mt-0.5">
          Zero lock-up staking pool with instantaneous yield distribution
        </p>
      </div>

      {/* Main Staking Balances Card */}
      <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm p-6 space-y-6 shadow-xl">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {/* AMSTR Balance */}
          <div>
            <div className="text-[11px] text-[#8C8478] uppercase tracking-wider mb-1">
              Wallet Balance
            </div>
            <div className="font-fraunces text-3xl font-bold text-[#EDE6DA]">
              {formatYoctoAmstr(amstrBalance, 4)}
            </div>
            <div className="font-mono text-xs text-[#8C8478] mt-1">AMSTR</div>
          </div>

          {/* Staked Amount */}
          <div>
            <div className="text-[11px] text-[#8C8478] uppercase tracking-wider mb-1">
              Staked (Zero Lock-Up)
            </div>
            <div className="font-fraunces text-3xl font-bold text-[#EDE6DA]">
              {formatYoctoAmstr(stakedAmount, 4)}
            </div>
            <div className="font-mono text-xs text-[#8C8478] mt-1">AMSTR</div>
          </div>

          {/* Claimable Rewards in Gold */}
          <div>
            <div className="text-[11px] text-[#8C8478] uppercase tracking-wider mb-1">
              Claimable Yield
            </div>
            <div className="font-fraunces text-3xl font-bold text-[#E3C07A]">
              {formatYoctoAmstr(pendingRewards, 4)}
            </div>
            <div className="font-mono text-xs text-[#E3C07A] mt-1">AMSTR</div>
          </div>
        </div>

        {/* Stake Controls */}
        {accountId ? (
          <div className="pt-4 border-t border-[#2A2620] space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="number"
                step="0.001"
                placeholder="Amount to stake / unstake..."
                value={inputAmount}
                onChange={(e) => setInputAmount(e.target.value)}
                className="flex-1 bg-[#0E0D0B] border border-[#2A2620] focus:border-[#C8763A] rounded-sm px-3 py-2 text-xs font-mono text-[#EDE6DA] focus:outline-none"
              />
              <button
                disabled={isLoading}
                onClick={handleStake}
                className="px-5 py-2 rounded-sm bg-[#C8763A] hover:bg-[#d88244] disabled:opacity-50 text-[#0E0D0B] font-bold text-xs uppercase tracking-wider transition-colors"
              >
                {isLoading ? "Processing…" : "Stake"}
              </button>
              <button
                disabled={isLoading}
                onClick={handleUnstake}
                className="px-5 py-2 rounded-sm border border-[#2A2620] hover:border-[#8C8478] disabled:opacity-50 text-[#EDE6DA] font-semibold text-xs transition-colors"
              >
                Unstake
              </button>
              <button
                disabled={isLoading}
                onClick={handleClaimYield}
                className="px-5 py-2 rounded-sm border border-[#E3C07A]/50 hover:bg-[#E3C07A]/10 disabled:opacity-50 text-[#E3C07A] font-semibold text-xs transition-colors"
              >
                Claim Yield
              </button>
            </div>
            {statusMsg && (
              <div
                className={`p-3 rounded-sm text-xs font-mono border ${
                  statusMsg.isError
                    ? "bg-[#C2483D]/10 border-[#C2483D]/30 text-[#C2483D]"
                    : "bg-[#5FA88A]/10 border-[#5FA88A]/30 text-[#5FA88A]"
                }`}
              >
                {statusMsg.text}
              </div>
            )}
          </div>
        ) : (
          <div className="pt-4 border-t border-[#2A2620] text-center">
            <button
              onClick={onConnectWallet}
              className="px-5 py-2.5 rounded-sm bg-[#C8763A] text-[#0E0D0B] font-bold text-xs"
            >
              Connect Wallet to Stake
            </button>
          </div>
        )}
      </div>

      {/* Treasury Stats Card */}
      <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm p-6 space-y-5">
        <h2 className="font-fraunces text-lg font-bold text-[#EDE6DA]">
          Deflationary Treasury & Supply Cap
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Total Burned */}
          <div className="p-4 bg-[#0E0D0B] border border-[#2A2620] rounded-sm">
            <div className="text-[11px] text-[#8C8478] uppercase tracking-wider mb-1">
              Total Burned (Simulated Buyback)
            </div>
            <div className="font-fraunces text-2xl font-bold text-[#C2483D]">
              {formatYoctoAmstr(burnedYocto.toString(), 4)} AMSTR
            </div>
            <div className="text-[11px] text-[#8C8478] mt-1">Fixed simulated price (1 NEAR = 1 AMSTR, 90% burned)</div>
          </div>

          {/* Treasury Balance */}
          <div className="p-4 bg-[#0E0D0B] border border-[#2A2620] rounded-sm">
            <div className="text-[11px] text-[#8C8478] uppercase tracking-wider mb-1">
              Treasury Balance
            </div>
            <div className="font-fraunces text-2xl font-bold text-[#E3C07A]">
              {formatYoctoNear(treasuryInfo.nearBalance, 3)} NEAR
            </div>
            <div className="text-[11px] text-[#8C8478] mt-1">Total treasury reserves</div>
          </div>
        </div>

        {/* Supply Progress Bar toward 2M cap */}
        <div className="space-y-2 pt-2">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-[#8C8478]">Lifetime Supply Cap Progress</span>
            <span className="text-[#EDE6DA]">
              {formatYoctoAmstr(totalSupply, 4)} / 2,000,000 AMSTR ({progressPct.toFixed(4)}%)
            </span>
          </div>
          <div className="w-full h-2 rounded-sm bg-[#2A2620] overflow-hidden">
            <div
              className="h-full bg-[#C8763A] transition-all duration-500"
              style={{ width: `${Math.max(1, progressPct)}%` }}
            ></div>
          </div>
        </div>
      </div>
    </div>
  );
};
