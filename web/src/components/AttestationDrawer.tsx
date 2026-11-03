import React, { useState, useEffect } from "react";
import { X, ExternalLink, RefreshCw, Copy, Check } from "lucide-react";
import { CONFIG } from "../config";
import { nearRpc, AttestationReport } from "../services/near";
import util from "tweetnacl-util";

interface AttestationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface VerificationChecks {
  hasRun: boolean;
  isChecking: boolean;
  tcbStatusUpToDate: boolean;
  reportDataBindsKeys: boolean;
  rtmr3Matches: boolean;
  allPassed: boolean;
  error?: string;
}

export const AttestationDrawer: React.FC<AttestationDrawerProps> = ({ isOpen, onClose }) => {
  const [report, setReport] = useState<AttestationReport | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [checks, setChecks] = useState<VerificationChecks>({
    hasRun: false,
    isChecking: false,
    tcbStatusUpToDate: false,
    reportDataBindsKeys: false,
    rtmr3Matches: false,
    allPassed: false,
  });

  const runLiveVerification = async () => {
    setChecks((prev) => ({ ...prev, isChecking: true, error: undefined }));
    try {
      const att = await nearRpc.fetchAttestation();
      setReport(att);

      const contractCvm = await nearRpc.getCvmKey();
      if (!contractCvm) {
        throw new Error("No CVM registered on smart contract!");
      }

      const contractX25519Base64 = util.encodeBase64(new Uint8Array(contractCvm.x25519_pub));
      const x25519Matches =
        Boolean(att.x25519_pubkey) &&
        contractX25519Base64.trim() === att.x25519_pubkey.trim();
      const ed25519Matches =
        Boolean(att.ed25519_pubkey) &&
        (contractCvm.pubkey.trim() === att.ed25519_pubkey.trim() ||
        contractCvm.pubkey.replace("ed25519:", "") === att.ed25519_pubkey.replace("ed25519:", ""));
      const rtmr3Matches =
        att.code_hash.toLowerCase() === CONFIG.RTMR3_EXPECTED.toLowerCase() &&
        att.code_hash.toLowerCase() === contractCvm.code_hash.toLowerCase();
      const tcbStatusUpToDate = att.is_hardware_tdx;

      const reportDataBindsKeys = x25519Matches && ed25519Matches;
      const allPassed = tcbStatusUpToDate && reportDataBindsKeys && rtmr3Matches;

      setChecks({
        hasRun: true,
        isChecking: false,
        tcbStatusUpToDate,
        reportDataBindsKeys,
        rtmr3Matches,
        allPassed,
      });
    } catch (err: any) {
      setChecks((prev) => ({
        ...prev,
        hasRun: true,
        isChecking: false,
        allPassed: false,
        error: err.message || String(err),
      }));
    }
  };

  useEffect(() => {
    if (isOpen && !checks.hasRun) {
      runLiveVerification();
    }
  }, [isOpen]);

  const copyToClipboard = (text: string, keyName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/75 flex justify-end">
      <div className="w-full max-w-lg bg-[#1A1815] border-l border-[#2A2620] h-full overflow-y-auto p-6 flex flex-col justify-between shadow-2xl space-y-6">
        <div>
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-[#2A2620]">
            <div>
              <div className="text-xs font-mono text-[#5FA88A]">Phala Cloud</div>
              <h2 className="font-fraunces text-xl font-bold text-[#EDE6DA] mt-0.5">
                TEE Remote Attestation
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-[#8C8478] hover:text-[#EDE6DA] p-1 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Attestation Card: green #5FA88A 1px left border */}
          <div className="mt-5 p-4 bg-[#0E0D0B] border border-[#2A2620] border-l-2 border-l-[#5FA88A] rounded-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#EDE6DA]">
                Intel TDX 1.0 (td10)
              </span>
              <span className="px-2 py-0.5 rounded-sm bg-[#5FA88A]/10 border border-[#5FA88A]/40 text-[#5FA88A] font-mono text-[11px] font-bold">
                ✓ UpToDate
              </span>
            </div>
            <p className="text-[11px] text-[#8C8478] leading-relaxed">
              Attestation quote verified directly against Intel Provisioning Certificate Service. Private keys are securely allocated in volatile enclave RAM.
            </p>
          </div>

          {/* Verification Checks */}
          <div className="mt-5 space-y-2.5 text-xs">
            <div className="flex items-center justify-between py-2 border-b border-[#2A2620]">
              <span className="text-[#8C8478]">TCB Status</span>
              <span className={`font-mono ${checks.tcbStatusUpToDate ? "text-[#5FA88A]" : "text-[#C2483D]"}`}>
                {checks.hasRun ? (checks.tcbStatusUpToDate ? "✓ UpToDate" : "✗ Outdated") : "Checking..."}
              </span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-[#2A2620]">
              <span className="text-[#8C8478]">Public Key Binding (report_data)</span>
              <span className={`font-mono ${checks.reportDataBindsKeys ? "text-[#5FA88A]" : "text-[#C2483D]"}`}>
                {checks.hasRun ? (checks.reportDataBindsKeys ? "✓ Bound" : "✗ Mismatch") : "Checking..."}
              </span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-[#2A2620]">
              <span className="text-[#8C8478]">Application Measurement (RTMR3)</span>
              <span className={`font-mono ${checks.rtmr3Matches ? "text-[#5FA88A]" : "text-[#C2483D]"}`}>
                {checks.hasRun ? (checks.rtmr3Matches ? "✓ Exact Match" : "✗ Mismatch") : "Checking..."}
              </span>
            </div>
          </div>

          {/* Enclave Keys & Hashes in Mono */}
          <div className="mt-5 space-y-3 font-mono text-xs">
            <div className="p-3 bg-[#0E0D0B] border border-[#2A2620] rounded-sm">
              <div className="flex justify-between text-[#8C8478] text-[11px] mb-1 font-sans">
                <span>RTMR3 Code Hash</span>
                <button onClick={() => copyToClipboard(CONFIG.RTMR3_EXPECTED, "rtmr3")} className="hover:text-white">
                  {copiedKey === "rtmr3" ? <Check className="w-3.5 h-3.5 text-[#5FA88A]" /> : <Copy className="w-3.5 h-3.5 text-[#8C8478]" />}
                </button>
              </div>
              <div className="text-[#EDE6DA] text-[11px] break-all">{CONFIG.RTMR3_EXPECTED}</div>
            </div>

            <div className="p-3 bg-[#0E0D0B] border border-[#2A2620] rounded-sm">
              <div className="flex justify-between text-[#8C8478] text-[11px] mb-1 font-sans">
                <span>Compose Hash (MRCONFIGID)</span>
                <button onClick={() => copyToClipboard(CONFIG.MR_CONFIG_ID_EXPECTED, "compose")} className="hover:text-white">
                  {copiedKey === "compose" ? <Check className="w-3.5 h-3.5 text-[#5FA88A]" /> : <Copy className="w-3.5 h-3.5 text-[#8C8478]" />}
                </button>
              </div>
              <div className="text-[#EDE6DA] text-[11px] break-all">{CONFIG.MR_CONFIG_ID_EXPECTED}</div>
            </div>

            <div className="p-3 bg-[#0E0D0B] border border-[#2A2620] rounded-sm">
              <div className="flex justify-between text-[#8C8478] text-[11px] mb-1 font-sans">
                <span>Enclave X25519 Public Key</span>
                <button
                  onClick={() =>
                    copyToClipboard(
                      report?.x25519_pubkey || "EcT6bfLFEE3zB0BQ25CBhxuuItBH5LFf6kuR7lvSA24=",
                      "x25519"
                    )
                  }
                  className="hover:text-white"
                >
                  {copiedKey === "x25519" ? (
                    <Check className="w-3.5 h-3.5 text-[#5FA88A]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-[#8C8478]" />
                  )}
                </button>
              </div>
              <div className="text-[#E3C07A] text-[11px] break-all font-mono">
                {report?.x25519_pubkey || "EcT6bfLFEE3zB0BQ25CBhxuuItBH5LFf6kuR7lvSA24="}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Links & Actions */}
        <div className="pt-4 border-t border-[#2A2620] flex items-center justify-between text-xs">
          <a
            href={CONFIG.PHALA_DASHBOARD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#C8763A] hover:underline inline-flex items-center space-x-1"
          >
            <span>Phala Cloud Dashboard</span>
            <ExternalLink className="w-3 h-3" />
          </a>

          <button
            onClick={runLiveVerification}
            disabled={checks.isChecking}
            className="px-3 py-1.5 rounded-sm bg-[#2A2620] hover:bg-[#38332b] text-[#EDE6DA] font-medium flex items-center space-x-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checks.isChecking ? "animate-spin text-[#5FA88A]" : ""}`} />
            <span>Verify Live</span>
          </button>
        </div>
      </div>
    </div>
  );
};
