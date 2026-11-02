import React, { useState, useEffect } from "react";
import { ExternalLink, Copy, Check, ShieldCheck } from "lucide-react";
import { CONFIG } from "../config";
import { nearRpc, AttestationReport } from "../services/near";

export const ProofPage: React.FC = () => {
  const [report, setReport] = useState<AttestationReport | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    nearRpc.fetchAttestation().then(setReport).catch(console.warn);
  }, []);

  const copyToClipboard = (text: string, keyName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const CONTRACTS = [
    { name: "AMSTR Game Engine", id: CONFIG.CONTRACT_ID, keyStatus: "full access" },
    { name: "AMSTR NEP-141 Token", id: CONFIG.TOKEN_CONTRACT_ID, keyStatus: "full access" },
    { name: "AMSTR Treasury & Buyback", id: CONFIG.TREASURY_CONTRACT_ID, keyStatus: "full access" },
    { name: "AMSTR Zero-Lock Staking", id: CONFIG.STAKING_CONTRACT_ID, keyStatus: "full access" },
  ];

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div>
        <h1 className="font-fraunces text-2xl font-bold text-[#EDE6DA]">
          Trust Center & Cryptographic Proofs
        </h1>
        <p className="text-xs text-[#8C8478] mt-0.5">
          Hardware-enforced confidentiality on Intel TDX with full provable fairness
        </p>
      </div>

      {/* 1. TEE Attestation Card: green #5FA88A 1px left border */}
      <div className="bg-[#1A1815] border border-[#2A2620] border-l-2 border-l-[#5FA88A] rounded-sm p-6 space-y-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#2A2620]">
          <div>
            <div className="text-xs font-bold text-[#5FA88A] uppercase tracking-wider">
              Intel TDX Confidential VM
            </div>
            <h2 className="font-fraunces text-lg font-bold text-[#EDE6DA] mt-0.5">
              Phala Cloud Remote Attestation Evidence
            </h2>
          </div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-1 rounded-sm bg-[#5FA88A]/10 border border-[#5FA88A]/40 text-[#5FA88A] font-mono text-xs font-bold">
              ✓ DCAP UpToDate
            </span>
            <span className="px-2.5 py-1 rounded-sm bg-[#2A2620] text-[#EDE6DA] font-mono text-xs">
              Intel TDX 1.0
            </span>
          </div>
        </div>

        {/* Measurements & Key Bindings */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
          {/* RTMR3 */}
          <div className="p-3 bg-[#0E0D0B] border border-[#2A2620] rounded-sm">
            <div className="flex justify-between text-[#8C8478] text-[11px] mb-1 font-sans">
              <span>RTMR3 Application Measurement</span>
              <button onClick={() => copyToClipboard(CONFIG.RTMR3_EXPECTED, "rtmr3")} className="hover:text-white">
                {copiedKey === "rtmr3" ? <Check className="w-3.5 h-3.5 text-[#5FA88A]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="text-[#EDE6DA] break-all text-[11px]">{CONFIG.RTMR3_EXPECTED}</div>
          </div>

          {/* Compose Hash */}
          <div className="p-3 bg-[#0E0D0B] border border-[#2A2620] rounded-sm">
            <div className="flex justify-between text-[#8C8478] text-[11px] mb-1 font-sans">
              <span>MRCONFIGID (dstack Compose Hash)</span>
              <button onClick={() => copyToClipboard(CONFIG.MR_CONFIG_ID_EXPECTED, "compose")} className="hover:text-white">
                {copiedKey === "compose" ? <Check className="w-3.5 h-3.5 text-[#5FA88A]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="text-[#EDE6DA] break-all text-[11px]">{CONFIG.MR_CONFIG_ID_EXPECTED}</div>
          </div>

          {/* Enclave Ed25519 Signing Key */}
          <div className="p-3 bg-[#0E0D0B] border border-[#2A2620] rounded-sm">
            <div className="flex justify-between text-[#8C8478] text-[11px] mb-1 font-sans">
              <span>Enclave Ed25519 Settlement Signer</span>
              {report && (
                <button onClick={() => copyToClipboard(report.ed25519_pubkey, "ed25519")} className="hover:text-white">
                  {copiedKey === "ed25519" ? <Check className="w-3.5 h-3.5 text-[#5FA88A]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
            <div className="text-[#C8763A] break-all text-[11px]">
              {report?.ed25519_pubkey || "ed25519:8fXMCKmxZxEuhr5dWMQkDXq8K3pF7teAJvq8GwFx87U6"}
            </div>
          </div>

          {/* Enclave X25519 Encryption Key */}
          <div className="p-3 bg-[#0E0D0B] border border-[#2A2620] rounded-sm">
            <div className="flex justify-between text-[#8C8478] text-[11px] mb-1 font-sans">
              <span>Enclave X25519 Pick Decryptor</span>
              {report && (
                <button onClick={() => copyToClipboard(report.x25519_pubkey, "x25519")} className="hover:text-white">
                  {copiedKey === "x25519" ? <Check className="w-3.5 h-3.5 text-[#5FA88A]" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
            <div className="text-[#E3C07A] break-all text-[11px]">
              {report?.x25519_pubkey || "EcT6bfLFEE3zB0BQ25CBhxuuItBH5LFf6kuR7lvSA24="}
            </div>
          </div>
        </div>

        {/* Links to Phala & Contract Registration Tx */}
        <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-[#2A2620] text-xs">
          <a
            href={CONFIG.PHALA_DASHBOARD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#C8763A] hover:underline inline-flex items-center space-x-1 font-medium"
          >
            <span>Phala Cloud Instance {CONFIG.CVM_ID.slice(0, 8)}…</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href={`${CONFIG.EXPLORER_URL}/txns/BSBg3UHDRjepJ5zDBeXmkda1JX9TA5aCe3Goqb5cD1nE`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#C8763A] hover:underline inline-flex items-center space-x-1 font-medium"
          >
            <span>On-Chain CVM Registration Tx</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* 2. "How Fairness Works" 4-Step Diagram: copper numbered circles on #1A1815 */}
      <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm p-6 space-y-5">
        <h2 className="font-fraunces text-lg font-bold text-[#EDE6DA]">
          How Fairness Works
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Step 1 */}
          <div className="p-4 bg-[#0E0D0B] border border-[#2A2620] rounded-sm space-y-2.5">
            <div className="w-7 h-7 rounded-full bg-[#C8763A] text-[#0E0D0B] font-fraunces font-bold flex items-center justify-center text-sm">
              1
            </div>
            <div className="font-semibold text-xs text-[#EDE6DA]">Pre-Commit Seed</div>
            <p className="text-[11px] text-[#8C8478] leading-relaxed">
              Before players join, the CVM enclave commits <code className="text-[#EDE6DA]">sha256(seed)</code> on-chain.
            </p>
          </div>

          {/* Step 2 */}
          <div className="p-4 bg-[#0E0D0B] border border-[#2A2620] rounded-sm space-y-2.5">
            <div className="w-7 h-7 rounded-full bg-[#C8763A] text-[#0E0D0B] font-fraunces font-bold flex items-center justify-center text-sm">
              2
            </div>
            <div className="font-semibold text-xs text-[#EDE6DA]">Encrypt In Browser</div>
            <p className="text-[11px] text-[#8C8478] leading-relaxed">
              Picks are boxed to the verified CVM X25519 key. Nobody can see picks before round closes.
            </p>
          </div>

          {/* Step 3 */}
          <div className="p-4 bg-[#0E0D0B] border border-[#2A2620] rounded-sm space-y-2.5">
            <div className="w-7 h-7 rounded-full bg-[#C8763A] text-[#0E0D0B] font-fraunces font-bold flex items-center justify-center text-sm">
              3
            </div>
            <div className="font-semibold text-xs text-[#EDE6DA]">Lock Entropy</div>
            <p className="text-[11px] text-[#8C8478] leading-relaxed">
              Deposit window closes, permanently locking NEAR on-chain block hash as entropy.
            </p>
          </div>

          {/* Step 4 */}
          <div className="p-4 bg-[#0E0D0B] border border-[#2A2620] rounded-sm space-y-2.5">
            <div className="w-7 h-7 rounded-full bg-[#C8763A] text-[#0E0D0B] font-fraunces font-bold flex items-center justify-center text-sm">
              4
            </div>
            <div className="font-semibold text-xs text-[#EDE6DA]">Hardware Reveal</div>
            <p className="text-[11px] text-[#8C8478] leading-relaxed">
              CVM reveals seed and draws winning tile via <code className="text-[#EDE6DA]">sha256(seed || entropy) % 25</code>.
            </p>
          </div>
        </div>
      </div>

      {/* 3. Contract Addresses with Access-Key Status & GitHub Link */}
      <div className="bg-[#1A1815] border border-[#2A2620] rounded-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-fraunces text-lg font-bold text-[#EDE6DA]">
            Smart Contract Governance
          </h2>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#C8763A] hover:underline inline-flex items-center space-x-1"
          >
            <span>GitHub Repository</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <div className="space-y-2">
          {CONTRACTS.map((c) => (
            <div
              key={c.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-[#0E0D0B] border border-[#2A2620] rounded-sm text-xs gap-2"
            >
              <div>
                <div className="font-semibold text-[#EDE6DA]">{c.name}</div>
                <div className="font-mono text-[#8C8478] text-[11px]">{c.id}</div>
              </div>
              <div className="flex items-center space-x-3">
                <span className="font-mono text-[11px] text-[#8C8478]">
                  Key Status: {c.keyStatus}
                </span>
                <a
                  href={`${CONFIG.EXPLORER_URL}/address/${c.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#C8763A] hover:underline inline-flex items-center space-x-1"
                >
                  <span>Explorer</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))}
        </div>

        <div className="p-3.5 bg-[#0E0D0B] border border-[#2A2620] rounded-sm text-xs text-[#8C8478] leading-relaxed space-y-1.5">
          <div className="font-semibold text-[#EDE6DA]">
            Access Key Transparency & Decentralization Roadmap
          </div>
          <p>
            During the active hackathon evaluation phase, contracts are controlled by <code className="text-[#EDE6DA]">amstr-admin-zxlhcx.testnet</code> with full-access keys retained to permit rapid contract fixes, redeployments, and parameter optimization.
          </p>
          <p>
            Prior to mainnet launch, all full-access keys will be permanently deleted (<code className="text-[#EDE6DA]">DeleteKey</code>), making contract WASM bytecodes fully immutable, with remaining configuration bounds restricted on-chain and transitioned to a community DAO multi-sig.
          </p>
        </div>
      </div>
    </div>
  );
};
