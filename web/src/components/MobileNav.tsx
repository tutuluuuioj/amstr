import React from "react";
import { Grid, History, ShieldCheck, Coins, Bot } from "lucide-react";
import { NavTab } from "./TopBar";

interface MobileNavProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
}

export const MobileNav: React.FC<MobileNavProps> = ({ activeTab, onTabChange }) => {
  const TABS: { id: NavTab; label: string; icon: React.ReactNode }[] = [
    { id: "play", label: "Play", icon: <Grid className="w-5 h-5" /> },
    { id: "rounds", label: "Rounds", icon: <History className="w-5 h-5" /> },
    { id: "agent", label: "Agents", icon: <Bot className="w-5 h-5" /> },
    { id: "proof", label: "Proof", icon: <ShieldCheck className="w-5 h-5" /> },
    { id: "stake", label: "Stake", icon: <Coins className="w-5 h-5" /> },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0E0D0B] border-t border-[#2A2620] px-4 py-2 flex items-center justify-around">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex flex-col items-center space-y-1 py-1 transition-colors ${
              isActive ? "text-[#C8763A]" : "text-[#8C8478] hover:text-[#EDE6DA]"
            }`}
          >
            {tab.icon}
            <span className="text-[10px] font-medium">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
