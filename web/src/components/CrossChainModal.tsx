import React, { useState, useEffect } from "react";
import { X, Copy, Check, ExternalLink, ArrowRight, Loader2, Sparkles, RefreshCw, ShieldCheck } from "lucide-react";
import { crossChainBridge, DepositIntent } from "../services/crosschainBridge";
import { getDerivedForeignAccounts, DerivedForeignAccounts } from "../services/chainSig";
import { CONFIG } from "../config";

interface CrossChainModalProps {
  isOpen: boolean;
  onClose: () => void;
  accountId: string | null;
  roundId?: number;
  selectedTiles?: number[];
  stakeNear?: number;
  ciphertext?: string;
  commit?: string;
}

export const CrossChainModal: React.FC<CrossChainModalProps> = ({
  isOpen,
  onClose,
  accountId,
  roundId,
  selectedTiles = [],
  stakeNear = 0.1,
  ciphertext = "",
  commit = "",
}) => {
  const [activeTab, setActiveTab] = useState<"deposit" | "payout">("deposit");
  const [selectedChain, setSelectedChain] = useState<"base" | "ethereum" | "solana">("base");
  const [derivedAccounts, setDerivedAccounts] = useState<DerivedForeignAccounts | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  
  // Deposit intent state
  const [activeIntent, setActiveIntent] = useState<DepositIntent | null>(null);
  const [isCreatingIntent, setIsCreatingIntent] = useState(false);
  const [manualTxHash, setManualTxHash] = useState("");
  const [isVerifyingManualTx, setIsVerifyingManualTx] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Payout state
  const [payoutRecipient, setPayoutRecipient] = useState("");
  const [payoutAmount, setPayoutAmount] = useState("0.005");
  const [isRequestingPayout, setIsRequestingPayout] = useState(false);
  const [payoutSuccessTx, setPayoutSuccessTx] = useState<string | null>(null);

  useEffect(() => {
    if (accountId) {
      const addrs = crossChainBridge.getDerivedAddresses(accountId);
      setDerivedAccounts(addrs);
    }
  }, [accountId]);

  // Polling for active intent status
  useEffect(() => {
    if (!activeIntent || activeIntent.status === "bet_deployed" || activeIntent.status === "failed") {
      return;
    }

    const interval = setInterval(async () => {
      const updated = await crossChainBridge.getDepositIntentStatus(activeIntent.intentId);
      if (updated) {
        setActiveIntent(updated);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [activeIntent]);

  if (!isOpen) return null;

  const currentAddress =
    selectedChain === "solana"
      ? derivedAccounts?.solana
      : selectedChain === "ethereum"
      ? derivedAccounts?.ethereum
      : derivedAccounts?.base;

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleGenerateIntent = async () => {
    if (!accountId) return;
    setIsCreatingIntent(true);
    setErrorMsg(null);
    try {
      const intent = await crossChainBridge.createDepositIntent({
        accountId,
        targetChain: selectedChain,
        stakeNear,
        roundId: roundId || 0,
        ciphertext,
        commit,
        expectedAmount: selectedChain === "solana" ? "0.01" : "0.001",
      });
      setActiveIntent(intent);
    } catch (err: any) {
      setErrorMsg(err.message || "Could not generate deposit intent");
    } finally {
      setIsCreatingIntent(false);
    }
  };

  const handleVerifyManualTx = async () => {
    if (!activeIntent || !manualTxHash.trim()) return;
    setIsVerifyingManualTx(true);
    setErrorMsg(null);
    try {
      const updated = await crossChainBridge.submitForeignTxHash(activeIntent.intentId, manualTxHash.trim());
      setActiveIntent(updated);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to verify transaction hash");
    } finally {
      setIsVerifyingManualTx(false);
    }
  };

  const handleRequestPayout = async () => {
    if (!payoutRecipient.trim()) {
      setErrorMsg("Please enter an EVM recipient address (0x...)");
      return;
    }
    setIsRequestingPayout(true);
    setErrorMsg(null);
    try {
      const keeperUrl = CONFIG.KEEPER_URL || "https://amstr-keeper.fly.dev";
      const res = await fetch(`${keeperUrl}/multichain/payout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientAddress: payoutRecipient.trim(),
          amountEth: payoutAmount,
          chain: "base",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Cross-chain payout request failed");
      }
      setPayoutSuccessTx(data.payout?.txHash || "0x_confirmed");
    } catch (err: any) {
      setErrorMsg(err.message || "Cross-chain payout request error");
    } finally {
      setIsRequestingPayout(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 flex items-center justify-center p-4">
      <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm max-w-md w-full p-6 shadow-2xl relative space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#2A2620]">
          <div className="flex items-center space-x-2">
            <span className="p-1 rounded bg-[#22C55E]/10 border border-[#22C55E]/40 text-[#22C55E]">
              ⚡
            </span>
            <div>
              <h2 className="font-fraunces text-lg font-bold text-[#EDE6DA]">
                Multichain & Chain Signatures
              </h2>
              <p className="text-xs text-[#8C8478]">
                Pay & claim from Base, Ethereum, and Solana
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#8C8478] hover:text-[#EDE6DA] p-1 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center space-x-1 border-b border-[#2A2620] text-xs font-mono">
          <button
            onClick={() => { setActiveTab("deposit"); setErrorMsg(null); }}
            className={`px-3 py-1.5 border-b-2 font-bold transition-colors ${
              activeTab === "deposit"
                ? "border-[#C8763A] text-[#EDE6DA]"
                : "border-transparent text-[#8C8478] hover:text-[#EDE6DA]"
            }`}
          >
            Pay From Any Chain
          </button>
          <button
            onClick={() => { setActiveTab("payout"); setErrorMsg(null); }}
            className={`px-3 py-1.5 border-b-2 font-bold transition-colors ${
              activeTab === "payout"
                ? "border-[#C8763A] text-[#EDE6DA]"
                : "border-transparent text-[#8C8478] hover:text-[#EDE6DA]"
            }`}
          >
            Claim to Foreign Chain
          </button>
        </div>

        {errorMsg && (
          <div className="p-2.5 rounded-sm bg-red-950/40 border border-red-800/60 text-red-200 text-xs">
            {errorMsg}
          </div>
        )}

        {/* Tab 1: Inbound Deposit */}
        {activeTab === "deposit" && (
          <div className="space-y-4">
            {/* Chain Selector */}
            <div className="flex space-x-2">
              <button
                type="button"
                onClick={() => setSelectedChain("base")}
                className={`flex-1 py-1.5 px-2 rounded-sm border text-xs font-mono transition-colors text-center ${
                  selectedChain === "base"
                    ? "border-[#22C55E] bg-[#22C55E]/10 text-[#22C55E] font-bold"
                    : "border-[#2A2620] text-[#8C8478] hover:text-[#EDE6DA]"
                }`}
              >
                Base (Fastest)
              </button>
              <button
                type="button"
                onClick={() => setSelectedChain("ethereum")}
                className={`flex-1 py-1.5 px-2 rounded-sm border text-xs font-mono transition-colors text-center ${
                  selectedChain === "ethereum"
                    ? "border-[#22C55E] bg-[#22C55E]/10 text-[#22C55E] font-bold"
                    : "border-[#2A2620] text-[#8C8478] hover:text-[#EDE6DA]"
                }`}
              >
                Ethereum
              </button>
              <button
                type="button"
                onClick={() => setSelectedChain("solana")}
                className={`flex-1 py-1.5 px-2 rounded-sm border text-xs font-mono transition-colors text-center ${
                  selectedChain === "solana"
                    ? "border-[#22C55E] bg-[#22C55E]/10 text-[#22C55E] font-bold"
                    : "border-[#2A2620] text-[#8C8478] hover:text-[#EDE6DA]"
                }`}
              >
                Solana
              </button>
            </div>

            {/* Derived Address Card */}
            <div className="p-3 rounded-sm bg-[#0E0D0B] border border-[#2A2620] space-y-2">
              <div className="flex items-center justify-between text-[11px] text-[#8C8478]">
                <span>Your Derived {selectedChain.toUpperCase()} Address:</span>
                <span className="text-[#22C55E] text-[10px] font-mono flex items-center space-x-1">
                  <ShieldCheck className="w-3 h-3" />
                  <span>NEAR MPC Secured</span>
                </span>
              </div>
              <div className="flex items-center justify-between bg-[#1A1815] border border-[#2A2620] p-2 rounded-sm font-mono text-xs text-[#EDE6DA] break-all">
                <span className="truncate mr-2">{currentAddress || "Deriving address..."}</span>
                {currentAddress && (
                  <button
                    onClick={() => handleCopy(currentAddress, "addr")}
                    className="p-1 text-[#8C8478] hover:text-[#EDE6DA] transition-colors"
                    title="Copy Address"
                  >
                    {copiedField === "addr" ? (
                      <Check className="w-4 h-4 text-[#22C55E]" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
              <p className="text-[10px] text-[#8C8478]">
                Derived deterministically from <code className="text-[#EDE6DA]">{accountId}</code> via NEAR Root MPC key. Any funds sent here automatically route into your AMSTR game session.
              </p>
              <div className="flex items-center justify-between text-[10px] pt-1 border-t border-[#2A2620]/60">
                <span className="text-[#8C8478]">Need faucet funds?</span>
                <a
                  href={
                    selectedChain === "solana"
                      ? "https://faucet.solana.com/"
                      : selectedChain === "base"
                      ? "https://faucet.quicknode.com/base/sepolia"
                      : "https://sepoliafaucet.com/"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#C8763A] hover:underline flex items-center"
                >
                  <span>Get {selectedChain === "solana" ? "Solana Devnet SOL" : `${selectedChain.toUpperCase()} Sepolia ETH`}</span>
                  <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </div>
            </div>

            {/* Intent Status Tracker */}
            {activeIntent ? (
              <div className="p-3 rounded-sm bg-[#0E0D0B] border border-[#C8763A]/40 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#EDE6DA]">
                    Deposit Intent Active
                  </span>
                  <span
                    className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded-sm ${
                      activeIntent.status === "bet_deployed"
                        ? "bg-[#22C55E]/20 text-[#22C55E]"
                        : activeIntent.status === "confirming"
                        ? "bg-[#C8763A]/20 text-[#C8763A]"
                        : "bg-[#8C8478]/20 text-[#8C8478]"
                    }`}
                  >
                    {activeIntent.status}
                  </span>
                </div>

                {/* Progress Stepper */}
                <div className="space-y-1.5 text-[11px] font-mono text-[#8C8478]">
                  <div className="flex items-center space-x-2">
                    <span className={activeIntent.status !== "pending_deposit" ? "text-[#22C55E]" : "text-[#C8763A]"}>
                      {activeIntent.status !== "pending_deposit" ? "✓" : "●"}
                    </span>
                    <span>1. Send {activeIntent.expectedAmount} {selectedChain === "solana" ? "SOL" : "ETH"} on {selectedChain.toUpperCase()}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={activeIntent.status === "bet_deployed" ? "text-[#22C55E]" : activeIntent.status === "confirming" ? "text-[#C8763A]" : "text-[#8C8478]"}>
                      {activeIntent.status === "bet_deployed" ? "✓" : activeIntent.status === "confirming" ? "●" : "○"}
                    </span>
                    <span>2. Foreign Block Confirmations ({activeIntent.confirmations || 0} / 2)</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className={activeIntent.status === "bet_deployed" ? "text-[#22C55E]" : "text-[#8C8478]"}>
                      {activeIntent.status === "bet_deployed" ? "✓" : "○"}
                    </span>
                    <span>
                      {activeIntent.roundId && activeIntent.roundId > 0
                        ? `3. AMSTR Bet Deployed on Round #${activeIntent.roundId}`
                        : `3. Account Balance Funded (+${activeIntent.stakeNear || 1} NEAR)`}
                    </span>
                  </div>
                </div>

                {activeIntent.status === "bet_deployed" && (
                  <div className="p-2 rounded-sm bg-[#22C55E]/10 border border-[#22C55E]/30 text-[#22C55E] text-xs font-mono">
                    {activeIntent.roundId && activeIntent.roundId > 0
                      ? "✓ Bet placed on-chain! Pick is sealed in Intel TDX hardware enclave."
                      : "✓ Account funded on-chain! Ready to play unlimited rounds with 1-click Fast Session Keys."}
                  </div>
                )}

                {/* Manual Tx Hash Input */}
                {activeIntent.status !== "bet_deployed" && (
                  <div className="pt-2 border-t border-[#2A2620] space-y-1.5">
                    <label className="text-[10px] text-[#8C8478]">
                      Already sent? Paste foreign txHash to expedite:
                    </label>
                    <div className="flex space-x-1.5">
                      <input
                        type="text"
                        value={manualTxHash}
                        onChange={(e) => setManualTxHash(e.target.value)}
                        placeholder="0x... or Solana signature"
                        className="flex-1 bg-[#1A1815] border border-[#2A2620] rounded-sm px-2 py-1 text-xs font-mono text-[#EDE6DA]"
                      />
                      <button
                        type="button"
                        onClick={handleVerifyManualTx}
                        disabled={isVerifyingManualTx}
                        className="px-2.5 py-1 rounded-sm bg-[#C8763A] text-[#0E0D0B] font-bold text-xs"
                      >
                        {isVerifyingManualTx ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Verify"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={handleGenerateIntent}
                disabled={isCreatingIntent}
                className="w-full py-2.5 px-3 rounded-sm bg-[#C8763A] hover:bg-[#d88244] text-[#0E0D0B] font-bold text-xs transition-colors flex items-center justify-center space-x-1.5 shadow-sm disabled:opacity-50"
              >
                {isCreatingIntent ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>
                      {selectedTiles.length > 0
                        ? `Deploy Cross-Chain Bet (Round #${roundId})`
                        : `Top Up Account Balance (${selectedChain === "solana" ? "0.01 SOL → 1 NEAR" : "0.001 ETH → 1 NEAR"})`}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Tab 2: Outbound Payout */}
        {activeTab === "payout" && (
          <div className="space-y-4">
            <div className="p-3 rounded-sm bg-[#0E0D0B] border border-[#2A2620] space-y-2.5">
              <div className="text-xs font-bold text-[#EDE6DA]">
                Sweep Winnings to Base / EVM Address
              </div>
              <p className="text-[11px] text-[#8C8478]">
                Uses NEAR Chain Signatures to execute an outbound native transfer directly to your external EVM wallet (MetaMask, Coinbase Wallet).
              </p>

              <div className="space-y-2 pt-1">
                <div>
                  <label className="text-[10px] text-[#8C8478]">
                    Recipient Address (Base / EVM):
                  </label>
                  <input
                    type="text"
                    value={payoutRecipient}
                    onChange={(e) => setPayoutRecipient(e.target.value)}
                    placeholder="0x..."
                    className="w-full bg-[#1A1815] border border-[#2A2620] rounded-sm px-2.5 py-1.5 text-xs font-mono text-[#EDE6DA]"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-[#8C8478]">
                    Amount (ETH on Base):
                  </label>
                  <input
                    type="text"
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value)}
                    placeholder="0.005"
                    className="w-full bg-[#1A1815] border border-[#2A2620] rounded-sm px-2.5 py-1.5 text-xs font-mono text-[#EDE6DA]"
                  />
                </div>
              </div>

              {payoutSuccessTx && (
                <div className="p-2 rounded-sm bg-[#22C55E]/10 border border-[#22C55E]/30 text-[#22C55E] text-xs font-mono break-all">
                  ✓ Payout Tx Broadcasted: {payoutSuccessTx}
                </div>
              )}

              <button
                type="button"
                onClick={handleRequestPayout}
                disabled={isRequestingPayout}
                className="w-full py-2.5 px-3 rounded-sm bg-[#22C55E] hover:bg-[#20b857] text-[#0E0D0B] font-bold text-xs transition-colors flex items-center justify-center space-x-1.5 shadow-sm disabled:opacity-50"
              >
                {isRequestingPayout ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>Sign & Broadcast via NEAR MPC</span>
                    <Sparkles className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
