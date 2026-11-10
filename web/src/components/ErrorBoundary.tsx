import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[Uncaught Error caught by ErrorBoundary]:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0E0D0B] text-[#EDE6DA] flex items-center justify-center p-4">
          <div className="bg-[#1A1815] border border-[#C2483D]/60 rounded-sm p-6 max-w-md w-full space-y-4 shadow-xl">
            <div className="flex items-center space-x-2 text-[#C2483D]">
              <AlertTriangle className="w-5 h-5 flex-shrink-0" />
              <h2 className="font-fraunces text-base font-bold text-[#EDE6DA]">
                Something went wrong
              </h2>
            </div>
            <p className="text-xs text-[#8C8478] font-mono break-words bg-[#0E0D0B] p-2.5 rounded-sm border border-[#2A2620]">
              {this.state.error?.message || "An unexpected rendering error occurred"}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="w-full py-2 rounded-sm bg-[#C8763A] hover:bg-[#d88244] text-[#0E0D0B] font-bold text-xs flex items-center justify-center space-x-2 transition-colors font-mono"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reload Application</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
