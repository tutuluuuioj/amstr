import React, { useState, useEffect } from "react";
import { LogOut, Zap, Copy, Check } from "lucide-react";
import { formatYoctoNear, formatYoctoAmstr } from "../services/near";
import { sessionKeyService } from "../services/sessionKey";

export type NavTab = "play" | "rounds" | "proof" | "stake" | "agent" | "how-it-works";

interface TopBarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  accountId: string | null;
  nearBalance: string;
  amstrBalance: string;
  isTeeHealthy: boolean | null;
  onConnectWallet: () => void;
  onDisconnectWallet: () => void;
  onOpenAttestation: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onTabChange,
  accountId,
  nearBalance,
  amstrBalance,
  isTeeHealthy,
  onConnectWallet,
  onDisconnectWallet,
  onOpenAttestation,
}) => {
  const NAV_ITEMS: { id: NavTab; label: string }[] = [
    { id: "play", label: "Play" },
    { id: "rounds", label: "Rounds" },
    { id: "proof", label: "Proof" },
    { id: "stake", label: "Stake" },
    { id: "agent", label: "🤖 AI Agents" },
    { id: "how-it-works", label: "How it works" },
  ];

  // TEE Status dot and badge logic (Requirement 2)
  const [isSessionActive, setIsSessionActive] = useState<boolean>(() =>
    accountId ? sessionKeyService.getSessionState(accountId).isActive : false
  );

  useEffect(() => {
    return sessionKeyService.subscribe(accountId, (state) => {
      setIsSessionActive(state.isActive);
    });
  }, [accountId]);

  const [copied, setCopied] = useState<boolean>(false);

  const handleCopyAccountId = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!accountId) return;
    navigator.clipboard.writeText(accountId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  let teeDot = <span className="w-2 h-2 rounded-full bg-[#8C8478] animate-pulse"></span>;
  let teeText = "TEE connecting";
  let teeButtonClass = "border-[#2A2620] bg-[#1A1815] text-[#8C8478]";

  if (isTeeHealthy === true) {
    teeDot = <span className="w-2 h-2 rounded-full bg-[#5FA88A]"></span>;
    teeText = "TEE live";
    teeButtonClass = "border-[#2A2620] bg-[#1A1815] hover:border-[#5FA88A]/50 text-[#EDE6DA]";
  } else if (isTeeHealthy === false) {
    teeDot = <span className="w-2 h-2 rounded-full bg-[#C2483D] animate-pulse"></span>;
    teeText = "TEE offline";
    teeButtonClass = "border-[#C2483D]/40 bg-[#C2483D]/10 text-[#C2483D]";
  }

  return (
    <header className="border-b border-[#2A2620] bg-[#0E0D0B] sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Left: Logo & Nav Links */}
        <div className="flex items-center space-x-6 sm:space-x-8">
          {/* Logo in Fraunces */}
          <button
            onClick={() => onTabChange("play")}
            className="font-fraunces text-xl font-bold tracking-tight text-[#EDE6DA] hover:text-white transition-colors"
          >
            AMSTR
          </button>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center space-x-6 h-14 text-xs font-medium">
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={`h-full flex items-center transition-colors relative ${
                    isActive
                      ? "text-[#EDE6DA] font-semibold border-b-2 border-[#C8763A]"
                      : "text-[#8C8478] hover:text-[#EDE6DA]"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right: Testnet badge, TEE dot, Wallet */}
        <div className="flex items-center space-x-3">
          {/* Testnet Badge */}
          <div className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-sm border border-[#2A2620] text-[11px] text-[#8C8478]">
            Testnet
          </div>

          {/* CVM Status Dot (polls /health on CVM) */}
          <button
            onClick={onOpenAttestation}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-sm border transition-colors text-xs ${teeButtonClass}`}
            title="Inspect Phala Intel TDX Remote Attestation"
          >
            {teeDot}
            <span className="text-[11px] font-medium">{teeText}</span>
          </button>

          {/* 1-Click Fast Play Badge */}
          {accountId && isSessionActive && (
            <div className="hidden lg:flex items-center space-x-1 px-2 py-0.5 rounded-sm border border-[#22C55E]/40 bg-[#22C55E]/10 text-[11px] text-[#22C55E] font-mono">
              <Zap className="w-3 h-3 fill-current" />
              <span>1-Click Active</span>
            </div>
          )}

          {/* Connect Wallet / Connected Info */}
          {accountId ? (
            <div className="flex items-center space-x-2.5 bg-[#1A1815] border border-[#2A2620] rounded-sm px-3 py-1">
              <div
                onClick={handleCopyAccountId}
                className="flex flex-col text-left cursor-pointer group"
                title="Click to copy account ID"
              >
                <div className="flex items-center space-x-1.5">
                  <span className="font-mono text-xs text-[#EDE6DA] group-hover:text-[#C8763A] transition-colors max-w-[110px] sm:max-w-[150px] truncate">
                    {accountId}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyAccountId}
                    className="text-[#8C8478] group-hover:text-[#C8763A] hover:text-[#EDE6DA] p-0.5 transition-colors"
                    title={copied ? "Copied!" : "Copy address"}
                  >
                    {copied ? (
                      <Check className="w-3 h-3 text-[#22C55E]" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                  {copied && (
                    <span className="text-[10px] font-mono text-[#22C55E] uppercase tracking-wider">
                      Copied!
                    </span>
                  )}
                </div>
                <span className="font-mono text-[10px] text-[#8C8478] flex items-center space-x-1.5">
                  <span>{formatYoctoNear(nearBalance, 2)} NEAR</span>
                  <span>•</span>
                  <span>{formatYoctoAmstr(amstrBalance, 2)} AMSTR</span>
                </span>
              </div>
              <button
                onClick={onDisconnectWallet}
                className="text-[#8C8478] hover:text-[#C2483D] p-1 transition-colors"
                title="Disconnect"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={onConnectWallet}
              className="px-4 py-1.5 rounded-sm bg-[#C8763A] hover:bg-[#d88244] text-[#0E0D0B] font-bold text-xs transition-colors shadow-sm"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
