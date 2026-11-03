import React, { useState, useEffect } from "react";
import {
  Bot,
  Key,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  Terminal,
  Code,
  Sparkles,
  Play,
  Cpu,
  Coins,
  ChevronRight,
  Info,
  AlertTriangle,
  RefreshCw,
  Wallet,
} from "lucide-react";
import {
  generateAgentMcpToken,
  loadSavedMcpTokens,
  testMcpTool,
  checkKeyOnChain,
  GeneratedMcpToken,
} from "../services/agentToken";
import { walletService } from "../services/wallet";
import { CONFIG } from "../config";

interface AgentPageProps {
  accountId: string | null;
  nearBalance: string;
  onConnectWallet: () => void;
}

export const AgentPage: React.FC<AgentPageProps> = ({
  accountId,
  nearBalance,
  onConnectWallet,
}) => {
  const [tokens, setTokens] = useState<GeneratedMcpToken[]>([]);
  const [selectedToken, setSelectedToken] = useState<GeneratedMcpToken | null>(null);
  const [accountMode, setAccountMode] = useState<"dedicated" | "connected">("dedicated");
  const [fundingAmount, setFundingAmount] = useState<string>("0.1");
  const [labelInput, setLabelInput] = useState<string>("Autonomous Agent");
  const [maxBetInput, setMaxBetInput] = useState<string>("0.5");
  const [customKeyInput, setCustomKeyInput] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isFunding, setIsFunding] = useState<boolean>(false);
  const [isAddingKey, setIsAddingKey] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeSetupTab, setActiveSetupTab] = useState<"claude" | "remote" | "prompt" | "curl">("claude");

  // On-chain status of selected token
  const [onChainStatus, setOnChainStatus] = useState<{
    checked: boolean;
    exists: boolean;
    permission?: string;
    balanceNear?: string;
  }>({ checked: false, exists: false });

  // Tool tester state
  const [selectedTestTool, setSelectedTestTool] = useState<string>("amstr_get_active_round");
  const [testToolArgs, setTestToolArgs] = useState<string>("{}");
  const [isTestingTool, setIsTestingTool] = useState<boolean>(false);
  const [testToolResult, setTestToolResult] = useState<any>(null);
  const [testToolError, setTestToolError] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadSavedMcpTokens();
    setTokens(saved);
    if (saved.length > 0 && !selectedToken) {
      setSelectedToken(saved[0]);
    }
  }, []);

  // Check on-chain status whenever selected token changes
  const verifyTokenOnChain = async (token: GeneratedMcpToken) => {
    setOnChainStatus({ checked: false, exists: false });
    const res = await checkKeyOnChain(token.accountId, token.publicKey);
    setOnChainStatus({
      checked: true,
      exists: res.exists,
      permission: res.permission,
      balanceNear: res.balanceNear,
    });
  };

  useEffect(() => {
    if (selectedToken) {
      verifyTokenOnChain(selectedToken);
    }
  }, [selectedToken]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const maxBet = maxBetInput ? parseFloat(maxBetInput) : undefined;
      const newToken = await generateAgentMcpToken({
        accountType: accountMode,
        connectedAccountId: accountId || undefined,
        existingPrivateKey: customKeyInput.trim() || undefined,
        label: labelInput || "Autonomous Agent",
        maxBetNear: maxBet,
      });

      const updated = [newToken, ...tokens.filter((t) => t.token !== newToken.token)];
      setTokens(updated);
      setSelectedToken(newToken);
      await verifyTokenOnChain(newToken);
    } catch (err: any) {
      alert("Token generation error: " + (err.message || String(err)));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFundAgentAccount = async () => {
    if (!selectedToken) return;
    if (!accountId) {
      onConnectWallet();
      return;
    }
    setIsFunding(true);
    try {
      await walletService.fundAgentAccount(selectedToken.accountId, fundingAmount);
      // Wait a moment for NEAR testnet block confirmation
      setTimeout(async () => {
        await verifyTokenOnChain(selectedToken);
        setIsFunding(false);
      }, 2500);
    } catch (err: any) {
      alert("Funding error: " + (err.message || String(err)));
      setIsFunding(false);
    }
  };

  const handleAddKeyToAccount = async () => {
    if (!selectedToken) return;
    if (!accountId) {
      onConnectWallet();
      return;
    }
    setIsAddingKey(true);
    try {
      await walletService.addAgentKeyToAccount(selectedToken.publicKey);
      setTimeout(async () => {
        await verifyTokenOnChain(selectedToken);
        setIsAddingKey(false);
      }, 2500);
    } catch (err: any) {
      alert("AddKey error: " + (err.message || String(err)));
      setIsAddingKey(false);
    }
  };

  const copyToClipboard = (text: string, keyName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const runTestTool = async () => {
    setIsTestingTool(true);
    setTestToolResult(null);
    setTestToolError(null);
    try {
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(testToolArgs);
      } catch {
        throw new Error("Invalid JSON in tool arguments");
      }
      const res = await testMcpTool(selectedTestTool, parsedArgs, selectedToken?.token);
      setTestToolResult(res);
    } catch (err: any) {
      setTestToolError(err.message || String(err));
    } finally {
      setIsTestingTool(false);
    }
  };

  const handleSelectToolPreset = (toolName: string) => {
    setSelectedTestTool(toolName);
    switch (toolName) {
      case "amstr_get_active_round":
      case "amstr_get_jackpot_status":
      case "amstr_reclaim_storage":
        setTestToolArgs("{}");
        break;
      case "amstr_get_round":
        setTestToolArgs('{\n  "round_id": 255\n}');
        break;
      case "amstr_get_recent_rounds":
        setTestToolArgs('{\n  "limit": 5\n}');
        break;
      case "amstr_get_player_info":
        setTestToolArgs(
          selectedToken
            ? `{\n  "account_id": "${selectedToken.accountId}"\n}`
            : '{\n  "account_id": "looseward2086.testnet"\n}'
        );
        break;
      case "amstr_bet":
        setTestToolArgs('{\n  "tiles": [10],\n  "stake_near": 0.01\n}');
        break;
      case "amstr_claim_payout":
        setTestToolArgs('{\n  "round_ids": []\n}');
        break;
      case "amstr_verify_fairness":
        setTestToolArgs('{\n  "round_id": 255\n}');
        break;
      default:
        setTestToolArgs("{}");
    }
  };

  const keeperUrl = (CONFIG as any).KEEPER_URL || "https://amstr-keeper.fly.dev";
  const activeTokenStr = selectedToken?.token || "amstr_mcp_YOUR_TOKEN_HERE";

  const claudeConfigJson = JSON.stringify(
    {
      mcpServers: {
        amstr: {
          command: "node",
          args: ["scripts/amstr-mcp.mjs"],
          env: {
            AMSTR_MCP_TOKEN: activeTokenStr,
            AMSTR_SERVER_URL: keeperUrl,
          },
        },
      },
    },
    null,
    2
  );

  return (
    <div className="space-y-8 animate-fadeIn max-w-5xl mx-auto">
      {/* Hero Header */}
      <div className="border border-[#2A2620] bg-[#1A1815] p-6 sm:p-8 rounded-sm shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-[#C8763A]/5 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center space-x-2 px-2.5 py-1 rounded bg-[#C8763A]/15 border border-[#C8763A]/30 text-[#C8763A] text-xs font-mono font-medium mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Model Context Protocol (MCP) • NEAR Protocol</span>
            </div>
            <h1 className="font-fraunces text-2xl sm:text-3xl font-bold text-[#EDE6DA] tracking-tight">
              AMSTR AI Agent Gateway
            </h1>
            <p className="text-xs sm:text-sm text-[#8C8478] mt-2 max-w-2xl leading-relaxed">
              Equip your AI Agents (Claude Desktop, Cursor, Antigravity, AutoGen, LangChain) with verified
              tools to autonomously inspect rounds, place confidential bets sealed in Phala Intel TDX, and
              claim NEAR payouts.
            </p>
          </div>

          <div className="flex flex-col items-start md:items-end gap-2 bg-[#0E0D0B] p-4 rounded border border-[#2A2620]">
            <span className="text-[11px] text-[#8C8478] uppercase tracking-wider font-mono">
              MCP Server Status
            </span>
            <div className="flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-[#5FA88A] animate-pulse"></span>
              <span className="text-xs font-bold text-[#EDE6DA] font-mono">amstr-keeper.fly.dev</span>
            </div>
            <span className="text-[10px] text-[#5FA88A] font-mono">9 Autonomous Tools Online</span>
          </div>
        </div>
      </div>

      {/* Grid: Token Generator & Quick Start */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Generator Form (5 cols) */}
        <div className="lg:col-span-5 border border-[#2A2620] bg-[#1A1815] p-5 sm:p-6 rounded-sm space-y-5">
          <div className="flex items-center space-x-2 border-b border-[#2A2620] pb-3">
            <Key className="w-4 h-4 text-[#C8763A]" />
            <h2 className="text-sm font-bold text-[#EDE6DA] uppercase tracking-wider font-mono">
              1. Generate Agent Token
            </h2>
          </div>

          {/* Account Mode Selection */}
          <div className="space-y-2">
            <label className="text-xs font-mono text-[#8C8478] block">Choose Agent Architecture:</label>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <button
                type="button"
                onClick={() => setAccountMode("dedicated")}
                className={`p-2.5 rounded border text-left transition-all ${
                  accountMode === "dedicated"
                    ? "bg-[#C8763A]/15 border-[#C8763A] text-[#EDE6DA]"
                    : "bg-[#0E0D0B] border-[#2A2620] text-[#8C8478] hover:text-[#EDE6DA]"
                }`}
              >
                <div className="font-bold">Dedicated Account</div>
                <div className="text-[10px] text-[#8C8478] mt-0.5 leading-tight">
                  Isolated bankroll, 100% safe
                </div>
              </button>

              <button
                type="button"
                onClick={() => setAccountMode("connected")}
                className={`p-2.5 rounded border text-left transition-all ${
                  accountMode === "connected"
                    ? "bg-[#C8763A]/15 border-[#C8763A] text-[#EDE6DA]"
                    : "bg-[#0E0D0B] border-[#2A2620] text-[#8C8478] hover:text-[#EDE6DA]"
                }`}
              >
                <div className="font-bold">Connected Wallet</div>
                <div className="text-[10px] text-[#8C8478] mt-0.5 leading-tight">
                  Add key to your account
                </div>
              </button>
            </div>
          </div>

          {/* Connected Wallet Info */}
          <div className="bg-[#0E0D0B] p-3 rounded border border-[#2A2620] text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[#8C8478]">Your Wallet:</span>
              {accountId ? (
                <span className="text-[#EDE6DA] font-mono font-bold">{accountId}</span>
              ) : (
                <button onClick={onConnectWallet} className="text-[#C8763A] hover:underline font-bold">
                  Connect Wallet
                </button>
              )}
            </div>
            {accountId && (
              <div className="flex items-center justify-between mt-1 text-[11px]">
                <span className="text-[#8C8478]">Balance:</span>
                <span className="text-[#5FA88A] font-mono">{nearBalance} NEAR</span>
              </div>
            )}
          </div>

          {/* Form Fields */}
          <div className="space-y-4 text-xs">
            <div>
              <label className="block text-[#8C8478] font-mono mb-1">Agent Name / Label</label>
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                placeholder="e.g. Claude Trading Agent"
                className="w-full bg-[#0E0D0B] border border-[#2A2620] rounded px-3 py-2 text-[#EDE6DA] focus:border-[#C8763A] outline-none font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-[#8C8478] font-mono mb-1">Max Bet Limit per Round (NEAR)</label>
              <input
                type="number"
                step="0.05"
                min="0.01"
                value={maxBetInput}
                onChange={(e) => setMaxBetInput(e.target.value)}
                placeholder="e.g. 0.5"
                className="w-full bg-[#0E0D0B] border border-[#2A2620] rounded px-3 py-2 text-[#EDE6DA] focus:border-[#C8763A] outline-none font-mono text-xs"
              />
            </div>

            {accountMode === "connected" && (
              <div>
                <label className="block text-[#8C8478] font-mono mb-1">
                  Optional: Existing Private Key (or leave empty to generate new)
                </label>
                <input
                  type="password"
                  value={customKeyInput}
                  onChange={(e) => setCustomKeyInput(e.target.value)}
                  placeholder="ed25519:..."
                  className="w-full bg-[#0E0D0B] border border-[#2A2620] rounded px-3 py-2 text-[#EDE6DA] focus:border-[#C8763A] outline-none font-mono text-xs"
                />
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full py-2.5 px-4 bg-[#C8763A] hover:bg-[#d88244] text-[#0E0D0B] font-bold rounded-sm text-xs transition-colors flex items-center justify-center space-x-2 font-mono shadow-md disabled:opacity-50"
            >
              <Cpu className="w-4 h-4" />
              <span>{isGenerating ? "Generating..." : "⚡ Generate Agent Token"}</span>
            </button>
          </div>

          {/* Saved Tokens List */}
          {tokens.length > 0 && (
            <div className="border-t border-[#2A2620] pt-4">
              <span className="text-[11px] font-mono text-[#8C8478] uppercase block mb-2">
                Your Agent Tokens ({tokens.length})
              </span>
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {tokens.map((t) => (
                  <button
                    key={t.token}
                    onClick={() => setSelectedToken(t)}
                    className={`w-full text-left p-2 rounded text-xs flex items-center justify-between border transition-all ${
                      selectedToken?.token === t.token
                        ? "bg-[#C8763A]/15 border-[#C8763A] text-[#EDE6DA]"
                        : "bg-[#0E0D0B] border-[#2A2620] text-[#8C8478] hover:text-[#EDE6DA]"
                    }`}
                  >
                    <span className="font-mono truncate">{t.label}</span>
                    <span className="text-[10px] font-mono text-[#8C8478]">
                      {t.accountType === "dedicated" ? "Dedicated" : "Connected"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Active Token Credentials & Client Setup Tabs (7 cols) */}
        <div className="lg:col-span-7 border border-[#2A2620] bg-[#1A1815] p-5 sm:p-6 rounded-sm space-y-5">
          <div className="flex items-center space-x-2 border-b border-[#2A2620] pb-3 justify-between">
            <div className="flex items-center space-x-2">
              <Bot className="w-4 h-4 text-[#5FA88A]" />
              <h2 className="text-sm font-bold text-[#EDE6DA] uppercase tracking-wider font-mono">
                2. Agent Credentials & On-Chain Activation
              </h2>
            </div>
            {selectedToken && (
              <span className="text-[11px] font-mono text-[#5FA88A] bg-[#5FA88A]/10 px-2 py-0.5 rounded border border-[#5FA88A]/30">
                {selectedToken.label}
              </span>
            )}
          </div>

          {/* ON-CHAIN ACTIVATION STATUS BANNER */}
          {selectedToken && (
            <div className="border border-[#2A2620] rounded p-3 bg-[#0E0D0B] text-xs font-mono space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[#8C8478]">On-Chain Target Account:</span>
                <span className="text-[#EDE6DA] font-bold truncate max-w-[280px]">
                  {selectedToken.accountId}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[#8C8478]">Public Key:</span>
                <span className="text-[#8C8478] truncate max-w-[280px] text-[11px]">
                  {selectedToken.publicKey}
                </span>
              </div>

              {/* Status State */}
              <div className="pt-2 border-t border-[#2A2620] flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="text-[#8C8478]">Blockchain Status:</span>
                  {!onChainStatus.checked ? (
                    <span className="text-[#8C8478] flex items-center space-x-1">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>Checking on-chain...</span>
                    </span>
                  ) : onChainStatus.exists ? (
                    <span className="text-[#5FA88A] flex items-center space-x-1 font-bold">
                      <Check className="w-3.5 h-3.5" />
                      <span>
                        Active & Registered ({onChainStatus.balanceNear || "0"} NEAR)
                      </span>
                    </span>
                  ) : (
                    <span className="text-[#C2483D] flex items-center space-x-1 font-bold">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Not Registered On-Chain Yet</span>
                    </span>
                  )}
                </div>

                <button
                  onClick={() => verifyTokenOnChain(selectedToken)}
                  className="text-[#8C8478] hover:text-[#EDE6DA] text-[11px] underline"
                >
                  Re-check
                </button>
              </div>

              {/* 1-CLICK ACTIVATION ACTIONS IF NOT ON-CHAIN */}
              {onChainStatus.checked && !onChainStatus.exists && (
                <div className="mt-2 p-3 bg-[#C8763A]/10 border border-[#C8763A]/40 rounded space-y-2 text-xs">
                  <div className="text-[#EDE6DA] font-bold flex items-center space-x-1.5">
                    <Info className="w-3.5 h-3.5 text-[#C8763A]" />
                    <span>Action Required to Allow Agent Betting</span>
                  </div>

                  {selectedToken.accountType === "dedicated" ? (
                    <div>
                      <p className="text-[11px] text-[#8C8478] leading-normal mb-2">
                        This dedicated agent account needs initial funding to be activated on NEAR testnet.
                        Click below to transfer testnet NEAR from your wallet to the agent.
                      </p>
                      <div className="flex items-center space-x-2">
                        <select
                          value={fundingAmount}
                          onChange={(e) => setFundingAmount(e.target.value)}
                          className="bg-[#0E0D0B] border border-[#2A2620] rounded px-2 py-1.5 text-xs text-[#EDE6DA]"
                        >
                          <option value="0.05">0.05 NEAR</option>
                          <option value="0.1">0.1 NEAR (Recommended)</option>
                          <option value="0.2">0.2 NEAR</option>
                          <option value="0.5">0.5 NEAR</option>
                        </select>
                        <button
                          onClick={handleFundAgentAccount}
                          disabled={isFunding}
                          className="py-1.5 px-3 bg-[#C8763A] hover:bg-[#d88244] text-[#0E0D0B] font-bold rounded text-xs transition-colors flex items-center space-x-1 disabled:opacity-50"
                        >
                          <Coins className="w-3.5 h-3.5" />
                          <span>{isFunding ? "Funding..." : `Fund Agent with ${fundingAmount} NEAR`}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-[11px] text-[#8C8478] leading-normal mb-2">
                        Your connected wallet must approve an <code>AddKey</code> transaction so this
                        token's key can sign bets for <strong>{selectedToken.accountId}</strong>.
                      </p>
                      <button
                        onClick={handleAddKeyToAccount}
                        disabled={isAddingKey}
                        className="py-1.5 px-3 bg-[#C8763A] hover:bg-[#d88244] text-[#0E0D0B] font-bold rounded text-xs transition-colors flex items-center space-x-1 disabled:opacity-50"
                      >
                        <Key className="w-3.5 h-3.5" />
                        <span>{isAddingKey ? "Signing..." : "Add Key to Connected Wallet (1-Click)"}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Active Token Display */}
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs font-mono text-[#8C8478] mb-1">
                <span>MCP Bearer Token (Give this to your AI agent)</span>
                <button
                  onClick={() => copyToClipboard(activeTokenStr, "token")}
                  className="text-[#C8763A] hover:underline flex items-center space-x-1"
                >
                  {copiedKey === "token" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedKey === "token" ? "Copied!" : "Copy Token"}</span>
                </button>
              </div>
              <div className="bg-[#0E0D0B] p-2.5 rounded border border-[#2A2620] font-mono text-xs text-[#EDE6DA] break-all select-all">
                {activeTokenStr}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
              <div className="bg-[#0E0D0B] p-2.5 rounded border border-[#2A2620]">
                <div className="flex items-center justify-between text-[#8C8478] mb-1">
                  <span>HTTP Endpoint</span>
                  <button
                    onClick={() => copyToClipboard(`${keeperUrl}/mcp`, "httpUrl")}
                    className="text-[#C8763A] hover:underline"
                  >
                    {copiedKey === "httpUrl" ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="text-[#EDE6DA] truncate">{keeperUrl}/mcp</div>
              </div>

              <div className="bg-[#0E0D0B] p-2.5 rounded border border-[#2A2620]">
                <div className="flex items-center justify-between text-[#8C8478] mb-1">
                  <span>SSE Stream</span>
                  <button
                    onClick={() => copyToClipboard(`${keeperUrl}/mcp/sse`, "sseUrl")}
                    className="text-[#C8763A] hover:underline"
                  >
                    {copiedKey === "sseUrl" ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="text-[#EDE6DA] truncate">{keeperUrl}/mcp/sse</div>
              </div>
            </div>
          </div>

          {/* Client Setup Guides Tabs */}
          <div className="border border-[#2A2620] rounded bg-[#0E0D0B] overflow-hidden">
            <div className="flex border-b border-[#2A2620] bg-[#141210] text-xs font-mono">
              <button
                onClick={() => setActiveSetupTab("claude")}
                className={`py-2 px-3 border-r border-[#2A2620] transition-colors ${
                  activeSetupTab === "claude"
                    ? "bg-[#0E0D0B] text-[#C8763A] font-bold"
                    : "text-[#8C8478] hover:text-[#EDE6DA]"
                }`}
              >
                Claude / Cursor
              </button>
              <button
                onClick={() => setActiveSetupTab("remote")}
                className={`py-2 px-3 border-r border-[#2A2620] transition-colors ${
                  activeSetupTab === "remote"
                    ? "bg-[#0E0D0B] text-[#C8763A] font-bold"
                    : "text-[#8C8478] hover:text-[#EDE6DA]"
                }`}
              >
                Web Agent / SSE
              </button>
              <button
                onClick={() => setActiveSetupTab("prompt")}
                className={`py-2 px-3 border-r border-[#2A2620] transition-colors ${
                  activeSetupTab === "prompt"
                    ? "bg-[#0E0D0B] text-[#C8763A] font-bold"
                    : "text-[#8C8478] hover:text-[#EDE6DA]"
                }`}
              >
                System Prompt
              </button>
              <button
                onClick={() => setActiveSetupTab("curl")}
                className={`py-2 px-3 transition-colors ${
                  activeSetupTab === "curl"
                    ? "bg-[#0E0D0B] text-[#C8763A] font-bold"
                    : "text-[#8C8478] hover:text-[#EDE6DA]"
                }`}
              >
                cURL
              </button>
            </div>

            <div className="p-4 text-xs font-mono relative">
              {activeSetupTab === "claude" && (
                <div>
                  <div className="flex items-center justify-between text-[#8C8478] mb-2">
                    <span>Add to claude_desktop_config.json:</span>
                    <button
                      onClick={() => copyToClipboard(claudeConfigJson, "claudeJson")}
                      className="text-[#C8763A] hover:underline flex items-center space-x-1"
                    >
                      {copiedKey === "claudeJson" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>Copy JSON</span>
                    </button>
                  </div>
                  <pre className="bg-[#1A1815] p-3 rounded text-[11px] text-[#EDE6DA] overflow-x-auto leading-relaxed border border-[#2A2620]">
                    {claudeConfigJson}
                  </pre>
                </div>
              )}

              {activeSetupTab === "remote" && (
                <div className="space-y-2">
                  <p className="text-[#8C8478]">
                    For Antigravity, OpenRouter, or web-based agents that support Server-Sent Events (SSE):
                  </p>
                  <div className="bg-[#1A1815] p-3 rounded text-[11px] text-[#EDE6DA] border border-[#2A2620] space-y-1">
                    <div>
                      <span className="text-[#8C8478]">Server URL:</span>{" "}
                      <span className="text-[#5FA88A]">{keeperUrl}/mcp/sse</span>
                    </div>
                    <div>
                      <span className="text-[#8C8478]">Auth Header:</span>{" "}
                      <span className="text-[#EDE6DA]">Authorization: Bearer {activeTokenStr.slice(0, 30)}...</span>
                    </div>
                  </div>
                </div>
              )}

              {activeSetupTab === "prompt" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[#8C8478] mb-1">
                    <span>Give this brief to your AI agent:</span>
                    <button
                      onClick={() =>
                        copyToClipboard(
                          `You have access to the AMSTR MCP Server on NEAR Testnet.\n- Use amstr_get_active_round to check the current round status, jackpot pools, and time remaining.\n- Use amstr_bet with your tile picks (0-24) and stake in NEAR (minimum 0.01 NEAR) to place confidential bets.\n- Use amstr_claim_payout to withdraw your winning prizes.\n- Use amstr_verify_fairness with any round_id to mathematically audit provable fairness proofs.`,
                          "agentPrompt"
                        )
                      }
                      className="text-[#C8763A] hover:underline"
                    >
                      {copiedKey === "agentPrompt" ? "Copied" : "Copy Brief"}
                    </button>
                  </div>
                  <div className="bg-[#1A1815] p-3 rounded text-[11px] text-[#EDE6DA] border border-[#2A2620] leading-relaxed">
                    You have access to the AMSTR MCP Server on NEAR Testnet.
                    <br />• Use <code className="text-[#C8763A]">amstr_get_active_round</code> to check
                    the current round status, jackpot pools, and time remaining.
                    <br />• Use <code className="text-[#C8763A]">amstr_bet</code> with your tile picks
                    (0-24) and stake in NEAR (min 0.01 NEAR) to place confidential bets sealed in Intel TDX.
                    <br />• Use <code className="text-[#C8763A]">amstr_claim_payout</code> to withdraw
                    your winning prizes.
                    <br />• Use <code className="text-[#C8763A]">amstr_verify_fairness</code> to audit
                    the cryptographic proof of any settled round.
                  </div>
                </div>
              )}

              {activeSetupTab === "curl" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[#8C8478] mb-1">
                    <span>Test active round via curl:</span>
                    <button
                      onClick={() =>
                        copyToClipboard(
                          `curl -X POST ${keeperUrl}/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"amstr_get_active_round"}}'`,
                          "curlCmd"
                        )
                      }
                      className="text-[#C8763A] hover:underline"
                    >
                      {copiedKey === "curlCmd" ? "Copied" : "Copy cURL"}
                    </button>
                  </div>
                  <pre className="bg-[#1A1815] p-3 rounded text-[10px] text-[#EDE6DA] overflow-x-auto border border-[#2A2620]">
                    {`curl -X POST ${keeperUrl}/mcp \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"amstr_get_active_round"}}'`}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Section 3: Interactive Tool Sandbox & Live Test Runner */}
      <div className="border border-[#2A2620] bg-[#1A1815] p-5 sm:p-6 rounded-sm space-y-5">
        <div className="flex items-center justify-between border-b border-[#2A2620] pb-3">
          <div className="flex items-center space-x-2">
            <Terminal className="w-4 h-4 text-[#C8763A]" />
            <h2 className="text-sm font-bold text-[#EDE6DA] uppercase tracking-wider font-mono">
              3. Live MCP Tool Sandbox & Inspector
            </h2>
          </div>
          <span className="text-xs text-[#8C8478] font-mono">Test tools directly against the live MCP server</span>
        </div>

        {/* Quick Tool Selector Chips */}
        <div>
          <span className="text-[11px] font-mono text-[#8C8478] uppercase block mb-2">Select MCP Tool:</span>
          <div className="flex flex-wrap gap-2">
            {[
              "amstr_get_active_round",
              "amstr_get_player_info",
              "amstr_get_jackpot_status",
              "amstr_get_recent_rounds",
              "amstr_verify_fairness",
              "amstr_bet",
              "amstr_claim_payout",
              "amstr_reclaim_storage",
            ].map((tool) => (
              <button
                key={tool}
                onClick={() => handleSelectToolPreset(tool)}
                className={`py-1 px-2.5 rounded text-xs font-mono transition-all border ${
                  selectedTestTool === tool
                    ? "bg-[#C8763A] text-[#0E0D0B] font-bold border-[#C8763A]"
                    : "bg-[#0E0D0B] border-[#2A2620] text-[#8C8478] hover:text-[#EDE6DA]"
                }`}
              >
                {tool}
              </button>
            ))}
          </div>
        </div>

        {/* Arguments & Run Button */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-6 space-y-2">
            <label className="text-[11px] font-mono text-[#8C8478] block">Tool Arguments (JSON):</label>
            <textarea
              rows={5}
              value={testToolArgs}
              onChange={(e) => setTestToolArgs(e.target.value)}
              className="w-full bg-[#0E0D0B] border border-[#2A2620] rounded p-3 text-xs font-mono text-[#EDE6DA] focus:border-[#C8763A] outline-none"
            />
            <button
              onClick={runTestTool}
              disabled={isTestingTool}
              className="py-2 px-4 bg-[#5FA88A] hover:bg-[#6fb89a] text-[#0E0D0B] font-bold rounded-sm text-xs font-mono transition-colors flex items-center space-x-2 disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{isTestingTool ? "Executing Tool..." : `Execute ${selectedTestTool}`}</span>
            </button>
          </div>

          <div className="lg:col-span-6 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-mono text-[#8C8478] block">Live Server Response:</label>
              {testToolResult && (
                <span className="text-[10px] font-mono text-[#5FA88A]">200 OK • JSON-RPC 2.0</span>
              )}
            </div>
            <div className="bg-[#0E0D0B] border border-[#2A2620] rounded p-3 min-h-[140px] max-h-[220px] overflow-y-auto text-xs font-mono text-[#EDE6DA]">
              {isTestingTool ? (
                <div className="text-[#8C8478] flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-[#C8763A] animate-ping"></span>
                  <span>Querying AMSTR MCP Server via NEAR Testnet...</span>
                </div>
              ) : testToolError ? (
                <div className="text-[#C2483D]">Error: {testToolError}</div>
              ) : testToolResult ? (
                <pre className="text-[11px] text-[#EDE6DA] leading-relaxed">
                  {JSON.stringify(testToolResult, null, 2)}
                </pre>
              ) : (
                <div className="text-[#8C8478] italic">
                  Select a tool above and click "Execute" to inspect the live response.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
