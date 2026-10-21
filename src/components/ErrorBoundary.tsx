import React, { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
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

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={{
          minHeight: "60vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px",
          textAlign: "center",
          fontFamily: "Inter, -apple-system, sans-serif"
        }}>
          <div style={{
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.25)",
            borderRadius: "16px",
            padding: "32px",
            maxWidth: "520px",
            width: "100%",
            boxShadow: "0 10px 25px -5px rgba(0,0,0,0.05)"
          }}>
            <h2 style={{ margin: "0 0 12px 0", fontSize: "1.25rem", color: "#dc2626" }}>Something went wrong</h2>
            <p style={{ color: "#64748b", fontSize: "0.95rem", lineHeight: "1.5", margin: "0 0 20px 0" }}>
              An unexpected error occurred while loading this view. You can reload the page or return to the overview.
            </p>
            {this.state.error && (
              <pre style={{
                background: "#f8fafc",
                padding: "12px",
                borderRadius: "8px",
                fontSize: "0.8rem",
                color: "#475569",
                overflowX: "auto",
                textAlign: "left",
                marginBottom: "20px"
              }}>
                {this.state.error.message || String(this.state.error)}
              </pre>
            )}
            <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
              <button
                onClick={() => window.location.reload()}
                style={{
                  padding: "10px 20px",
                  background: "#4f46e5",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Reload Page
              </button>
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.href = "/app";
                }}
                style={{
                  padding: "10px 20px",
                  background: "#f1f5f9",
                  color: "#334155",
                  border: "1px solid #cbd5e1",
                  borderRadius: "8px",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
