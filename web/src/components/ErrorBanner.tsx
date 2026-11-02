import React from "react";
import { AlertCircle, X, RefreshCw } from "lucide-react";

interface ErrorBannerProps {
  error: string | null;
  onDismiss: () => void;
  onRetry?: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ error, onDismiss, onRetry }) => {
  if (!error) return null;

  return (
    <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-200 text-xs flex items-center justify-between shadow-lg">
      <div className="flex items-center space-x-3">
        <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
        <div>
          <span className="font-bold text-rose-300">NEAR RPC / Network Error: </span>
          <span>{error}</span>
        </div>
      </div>
      <div className="flex items-center space-x-2 flex-shrink-0">
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-semibold text-[11px] flex items-center space-x-1"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        )}
        <button
          onClick={onDismiss}
          className="p-1 rounded text-rose-400 hover:text-white hover:bg-rose-500/20"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
