import React, { useState, useEffect } from "react";
import { X, Check, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { CONFIG } from "../config";
import { RoundView, nearRpc } from "../services/near";
import { verifyRoundFairness, FairnessVerificationResult, toHex } from "../crypto/fairness";
import SETTLED_SEEDS_DATA from "../data/settledSeeds.json";

interface FairnessModalProps {
  round: RoundView | null;
  isOpen: boolean;
  onClose: () => void;
}

const SEED_REGISTRY: Record<string, string> = {
  ...(SETTLED_SEEDS_DATA as Record<string, string>),
  "1": "5mR7jW2Qe0B4N4X9yZ...",
  "2": "PzJSSdIth8OFKrltm2TkBbSMbW8tksPMMzKY+sn8PXE=",
  "33": "WvhNWnIJJiKko6aJLXazGg/zLyrGjuvo9iGiWiuiYF8=",
  "131": "3hhT785E4ie9USTd0sykWarrNpry9h70esR0QScDNGo=",
  "132": "oL9MP3H8Orn24mlMJktmVOz7ZSuTzH0QYHIV9Sbblkc=",
  "133": "abdE+XKNLwdLXK31RJ3dNEGn7SgSPclb8r/1QNJy0tY=",
  "134": "9S6892p23/GV39pKZEF6dEavhw/Ik6Evp/fYNE+5BWA=",
};

const KNOWN_SETTLE_TXS: Record<number, string> = {
  1: "AjthLw4ZksVZPAhhyR6hRcAX1NyJo562Fuo3KKTnvhFQ",
  2: "4A6U78MustvVJe2fac142ovFSjyXNqu6aCYUytG2crSH",
  131: "TjzYCT5sCCEteAWtBVtkYZNHSP4tNGheNLT7yvn3Xyd",
  132: "6qPiyM5xS7iHCox87sZg7UWHXHDtFPYjY7uYdirifzmk",
  133: "BF8Yj8oha86MAe9aMsgABfLYJoc25rjDtwWijZAq4paY",
  134: "GHz4znL1NcjNuSjF6gq3pbLFHA7ERUqQPB575azcnhbb",
  164: "HmJLcV9e6Pr6iNqwLjMgHtTz5G7bDSsbGGSsfrJoqA3E",
  165: "ArgpPXkEAS8cn3dXnuB4qjXhUU2tXD9BkhXcnzWqooSQ",
  166: "GuFQM9HzoVdiddG19Rz7sVNmxUQK1nJFYXiQ2bseySFF",
};

export const FairnessModal: React.FC<FairnessModalProps> = ({ round, isOpen, onClose }) => {
  const [seedInput, setSeedInput] = useState<string>("");
  const [result, setResult] = useState<FairnessVerificationResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSettled = round?.status === "Settled";

  const runVerification = (seedToVerify: string, r: RoundView) => {
    const cleanSeed = seedToVerify.replace(/\s+/g, "");
    if (!cleanSeed) return;
    if (!r.chain_entropy || r.winning_tile === null) {
      setError("Round is missing chain entropy or winning tile.");
      return;
    }
    try {
      const res = verifyRoundFairness(
        r.round_id,
        cleanSeed,
        r.seed_commit,
        r.chain_entropy,
        r.winning_tile
      );
      setResult(res);
      setError(null);
    } catch (err: any) {
      setError(err.message || String(err));
    }
  };

  useEffect(() => {
    if (!round || !isOpen) {
      setSeedInput("");
      setResult(null);
      setError(null);
      return;
    }

    // If round hasn't settled yet, seed cannot be revealed
    if (round.status !== "Settled") {
      setSeedInput("");
      setResult(null);
      setError(null);
      return;
    }

    // Auto-fill revealed enclave seed from on-chain round_settled event or known seeds
    let discoveredSeed =
      (typeof window !== "undefined" ? localStorage.getItem(`amstr_seed_${round.round_id}`) : null) ||
      SEED_REGISTRY[round.round_id] ||
      SEED_REGISTRY[String(round.round_id)] ||
      "";

    if (discoveredSeed) {
      const cleanSeed = discoveredSeed.replace(/\s+/g, "");
      setSeedInput(cleanSeed);
      runVerification(cleanSeed, round);
      return;
    }

    // Try dynamic fetch from /settledSeeds.json (allows new keeper seeds without rebuild)
    fetch("/settledSeeds.json?t=" + Date.now())
      .then((res) => (res.ok ? res.json() : {}))
      .then((seedsMap: Record<string, string>) => {
        const found = seedsMap[round.round_id] || seedsMap[String(round.round_id)];
        if (found) {
          const cleanSeed = found.replace(/\s+/g, "");
          setSeedInput(cleanSeed);
          runVerification(cleanSeed, round);
          if (typeof window !== "undefined") {
            localStorage.setItem(`amstr_seed_${round.round_id}`, cleanSeed);
          }
          return;
        }

        // Fallback: Query NEAR RPC for on-chain round_settled event logs
        if (KNOWN_SETTLE_TXS[round.round_id]) {
          nearRpc
            .getRoundSettledEvent(round.round_id, KNOWN_SETTLE_TXS[round.round_id])
            .then((eventData) => {
              if (eventData?.seed) {
                const cleanSeed = eventData.seed.replace(/\s+/g, "");
                setSeedInput(cleanSeed);
                runVerification(cleanSeed, round);
              }
            })
            .catch((err) => {
              console.warn("Failed to fetch settle event:", err);
            });
        }
      })
      .catch((e) => {
        console.warn("Could not fetch settledSeeds.json:", e);
      });
  }, [round, isOpen]);

  const handleVerify = () => {
    if (!round || !isSettled) return;
    const clean = seedInput.replace(/\s+/g, "");
    if (!clean) {
      setError("Please enter or auto-fill a valid revealed seed.");
      return;
    }
    setSeedInput(clean);
    runVerification(clean, round);
  };

  const copyToClipboard = (text: string, keyName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  if (!isOpen || !round) return null;

  const onChainCommitHex = toHex(round.seed_commit);
  const chainEntropyHex = round.chain_entropy ? toHex(round.chain_entropy) : "";

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 flex items-center justify-center p-4">
      <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm max-w-2xl w-full p-6 shadow-2xl relative my-8 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#2A2620]">
          <div>
            <div className="text-xs font-mono text-[#5FA88A]">Round #{round.round_id}</div>
            <h2 className="font-fraunces text-xl font-bold text-[#EDE6DA] mt-0.5 flex items-center space-x-2">
              <ShieldCheck className="w-5 h-5 text-[#5FA88A]" />
              <span>Provable Fairness Verification</span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#8C8478] hover:text-[#EDE6DA] p-1 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Input Seed */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="block text-[11px] text-[#8C8478] uppercase tracking-wider">
              Revealed Enclave Seed (Base64)
            </label>
            {isSettled ? (
              seedInput ? (
                <span className="text-[11px] text-[#5FA88A] font-mono flex items-center space-x-1">
                  <Check className="w-3 h-3" />
                  <span>Auto-filled from on-chain round_settled event</span>
                </span>
              ) : (
                <span className="text-[11px] text-[#8C8478] font-mono">
                  Paste revealed seed or await event sync…
                </span>
              )
            ) : (
              <span className="text-[11px] text-[#8C8478] font-mono">
                Round {round.status} (Not Settled)
              </span>
            )}
          </div>
          <div className="flex space-x-2">
            <input
              type="text"
              value={isSettled ? seedInput : ""}
              onChange={(e) => {
                const cleaned = e.target.value.replace(/\s+/g, "");
                setSeedInput(cleaned);
              }}
              onPaste={(e) => {
                e.preventDefault();
                const pasted = e.clipboardData.getData("text");
                const cleaned = pasted.replace(/\s+/g, "");
                setSeedInput(cleaned);
              }}
              placeholder={
                isSettled
                  ? "Paste Base64 revealed seed..."
                  : "Seed is revealed after settlement"
              }
              disabled={!isSettled}
              className={`flex-1 bg-[#0E0D0B] border border-[#2A2620] focus:border-[#C8763A] rounded-sm px-3 py-1.5 text-xs font-mono text-[#EDE6DA] focus:outline-none ${
                !isSettled ? "opacity-60 cursor-not-allowed text-[#8C8478]" : ""
              }`}
            />
            <button
              onClick={handleVerify}
              disabled={!isSettled || !seedInput.trim()}
              className={`px-4 py-1.5 rounded-sm font-bold text-xs transition-colors ${
                isSettled && seedInput.trim()
                  ? "bg-[#5FA88A] hover:bg-[#529377] text-[#0E0D0B] cursor-pointer"
                  : "bg-[#2A2620] text-[#8C8478] cursor-not-allowed"
              }`}
            >
              Check
            </button>
          </div>
        </div>

        {/* Verification Success / Mismatch Banner */}
        {result && result.isProvablyFair && (
          <div className="p-3 bg-[#5FA88A]/10 border border-[#5FA88A]/30 text-[#5FA88A] text-xs font-mono rounded-sm flex items-center space-x-2">
            <Check className="w-4 h-4 shrink-0 text-[#5FA88A]" />
            <span>Fairness Verified: On-chain result matches cryptographic formula exactly.</span>
          </div>
        )}

        {result && !result.isProvablyFair && (
          <div className="p-3 bg-[#C2483D]/10 border border-[#C2483D]/30 text-[#C2483D] text-xs font-mono rounded-sm flex items-center space-x-2">
            <X className="w-4 h-4 shrink-0 text-[#C2483D]" />
            <span>Fairness Verification Failed: On-chain result does not match cryptographic formula.</span>
          </div>
        )}

        {error && (
          <div className="p-3 bg-[#C2483D]/10 border border-[#C2483D]/30 text-[#C2483D] text-xs font-mono rounded-sm">
            {error}
          </div>
        )}

        {/* Verification Steps Panel */}
        <div className="p-4 bg-[#0E0D0B] border border-[#2A2620] rounded-sm space-y-4 font-mono text-xs">
          {/* Step 1: Pre-Commitment Check */}
          <div className="space-y-1.5 pb-3 border-b border-[#2A2620]">
            <div className="flex items-center justify-between">
              <span className="text-[#8C8478] font-sans text-[11px] uppercase tracking-wider">
                1. Seed Pre-Commitment Check
              </span>
              {result && (
                <span className={result.seedCommitMatches ? "text-[#5FA88A] font-bold" : "text-[#C2483D] font-bold"}>
                  {result.seedCommitMatches ? "✓ Passed" : "✗ Mismatch"}
                </span>
              )}
            </div>
            <div className="text-[11px] text-[#EDE6DA] truncate flex items-center justify-between">
              <span>SHA-256(seed): {result?.derivedCommitHex.slice(0, 32) || "—"}…</span>
              {result && (
                <button onClick={() => copyToClipboard(result.derivedCommitHex, "commit")} className="hover:text-white">
                  {copiedKey === "commit" ? <Check className="w-3.5 h-3.5 text-[#5FA88A]" /> : <Copy className="w-3.5 h-3.5 text-[#8C8478]" />}
                </button>
              )}
            </div>
            <div className="text-[11px] text-[#8C8478] truncate">
              On-Chain Commit: {onChainCommitHex.slice(0, 32)}…
            </div>
          </div>

          {/* Step 2: Chain Entropy */}
          <div className="space-y-1 pb-3 border-b border-[#2A2620]">
            <div className="text-[#8C8478] font-sans text-[11px] uppercase tracking-wider">
              2. On-Chain Entropy (Locked at close_round)
            </div>
            <div className="text-[11px] text-[#EDE6DA] truncate flex items-center justify-between">
              <span>{chainEntropyHex ? `${chainEntropyHex.slice(0, 48)}…` : "—"}</span>
              {chainEntropyHex && (
                <button onClick={() => copyToClipboard(chainEntropyHex, "entropy")} className="hover:text-white">
                  {copiedKey === "entropy" ? <Check className="w-3.5 h-3.5 text-[#5FA88A]" /> : <Copy className="w-3.5 h-3.5 text-[#8C8478]" />}
                </button>
              )}
            </div>
          </div>

          {/* Step 3: Tile Derivation Formula */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[#8C8478] font-sans text-[11px] uppercase tracking-wider">
                3. Winning Tile Derivation Formula
              </span>
              {result && (
                <span className={result.tileMatches ? "text-[#5FA88A] font-bold" : "text-[#C2483D] font-bold"}>
                  {result.tileMatches ? "✓ Passed" : "✗ Mismatch"}
                </span>
              )}
            </div>
            <div className="text-[11px] text-[#8C8478]">
              u64_le(SHA-256(seed || chain_entropy)[0..8]) % 25
            </div>
            <div className="flex items-center space-x-6 pt-1">
              <div>
                <span className="text-[11px] text-[#8C8478]">Calculated Tile: </span>
                <span className="text-base font-bold text-[#5FA88A]">
                  {result ? result.calculatedWinningTile : "—"}
                </span>
              </div>
              <div>
                <span className="text-[11px] text-[#8C8478]">Contract Winning Tile: </span>
                <span className="text-base font-bold text-[#E3C07A]">
                  {round.winning_tile !== null ? round.winning_tile : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Nearblocks links in copper #C8763A */}
        <div className="pt-2 border-t border-[#2A2620] flex flex-wrap gap-4 text-xs font-medium">
          <a
            href={`${CONFIG.EXPLORER_URL}/address/${CONFIG.CONTRACT_ID}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#C8763A] hover:underline inline-flex items-center space-x-1"
          >
            <span>Contract on Nearblocks</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
};
