import React from "react";
import { ExternalLink, X, Check, Loader2, AlertCircle } from "lucide-react";
import { CONFIG } from "../config";

export interface ToastItem {
  id: string;
  type: "success" | "pending" | "error";
  title: string;
  message?: string;
  txHash?: string;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col space-y-2.5 max-w-sm w-full">
      {toasts.map((toast) => {
        // Border style based on type
        // success has green #5FA88A left edge, pending has copper #C8763A, failure has brick red #C2483D
        let leftBorder = "border-l-4 border-l-[#C8763A]";
        let icon = <Loader2 className="w-4 h-4 text-[#C8763A] animate-spin flex-shrink-0" />;

        if (toast.type === "success") {
          leftBorder = "border-l-4 border-l-[#5FA88A]";
          icon = <Check className="w-4 h-4 text-[#5FA88A] flex-shrink-0" />;
        } else if (toast.type === "error") {
          leftBorder = "border-l-4 border-l-[#C2483D]";
          icon = <AlertCircle className="w-4 h-4 text-[#C2483D] flex-shrink-0" />;
        }

        return (
          <div
            key={toast.id}
            className={`p-3.5 bg-[#1A1815] border border-[#2A2620] ${leftBorder} rounded-sm shadow-xl flex items-start justify-between space-x-3 text-xs`}
          >
            <div className="flex items-start space-x-2.5 flex-1">
              {icon}
              <div className="flex-1">
                <div className="font-semibold text-[#EDE6DA]">{toast.title}</div>
                {toast.message && <div className="text-[#8C8478] mt-0.5">{toast.message}</div>}
                {toast.txHash && (
                  <a
                    href={`${CONFIG.EXPLORER_URL}/txns/${toast.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-flex items-center space-x-1 text-[11px] text-[#C8763A] hover:underline"
                  >
                    <span>View on Nearblocks</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
            <button
              onClick={() => onDismiss(toast.id)}
              className="text-[#8C8478] hover:text-[#EDE6DA] p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
