import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  RotateCw,
  Layers,
  Clock,
} from "lucide-react";
import { Button } from "./ui";
import { request } from "../lib/api";

export interface BatchMetricData {
  id: string;
  type: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "PARTIAL" | "FAILED";
  metrics: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    progressPct: number;
  };
  items: Array<{
    id: string;
    operationType: string;
    targetId?: string;
    status: string;
    error?: string;
  }>;
}

interface BatchProgressIndicatorProps {
  batchId: string;
  onComplete?: () => void;
  autoPoll?: boolean;
}

export function BatchProgressIndicator({
  batchId,
  onComplete,
  autoPoll = true,
}: BatchProgressIndicatorProps) {
  const [data, setData] = useState<BatchMetricData | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  async function fetchStatus() {
    try {
      const res = (await request(`/batch/${batchId}`)) as BatchMetricData;
      setData(res);
      return res;
    } catch (err) {
      console.error("Failed to fetch batch status:", err);
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!batchId) return;
    let timer: any = null;

    fetchStatus().then((initialData) => {
      if (!autoPoll || !initialData) return;

      const isTerminal = ["COMPLETED", "PARTIAL", "FAILED"].includes(initialData.status);
      if (isTerminal) {
        if (onComplete) onComplete();
        return;
      }

      timer = setInterval(async () => {
        const latest = await fetchStatus();
        if (latest && ["COMPLETED", "PARTIAL", "FAILED"].includes(latest.status)) {
          clearInterval(timer);
          if (onComplete) onComplete();
        }
      }, 2000);
    });

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [batchId, autoPoll]);

  async function handleRetryFailed() {
    try {
      setRetrying(true);
      await request(`/batch/${batchId}/retry-failed`, "POST");
      toast.success("Retrying failed items in batch!");
      await fetchStatus();
    } catch (err: any) {
      toast.error(err.message || "Failed to retry batch items.");
    } finally {
      setRetrying(false);
    }
  }

  if (loading && !data) {
    return (
      <div style={{ padding: "16px", borderRadius: "10px", background: "var(--border)", border: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "10px" }}>
        <Loader2 size={16} className="animate-spin" />
        <span style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>Initializing batch operations...</span>
      </div>
    );
  }

  if (!data) return null;

  const { status, metrics, type } = data;
  const isTerminal = ["COMPLETED", "PARTIAL", "FAILED"].includes(status);
  const badgeColor =
    status === "COMPLETED"
      ? "#34d399"
      : status === "FAILED"
      ? "#f87171"
      : status === "PARTIAL"
      ? "#fbbf24"
      : "#6366f1";

  return (
    <div
      style={{
        padding: "16px 20px",
        borderRadius: "12px",
        background: "var(--surface2)",
        border: `1px solid ${badgeColor}40`,
        boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
        marginBottom: "20px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Layers size={18} style={{ color: badgeColor }} />
          <div>
            <span style={{ fontSize: "0.9rem", fontWeight: 600, display: "block" }}>
              Batch Operation: <span style={{ textTransform: "capitalize" }}>{type.replace("_", " ")}</span>
            </span>
            <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
              ID: {batchId.slice(0, 8)}...
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              padding: "4px 10px",
              borderRadius: "20px",
              fontSize: "0.75rem",
              fontWeight: 700,
              background: `${badgeColor}20`,
              color: badgeColor,
              border: `1px solid ${badgeColor}50`,
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            {!isTerminal && <Loader2 size={12} className="animate-spin" />}
            {status === "COMPLETED" && <CheckCircle2 size={12} />}
            {(status === "FAILED" || status === "PARTIAL") && <AlertCircle size={12} />}
            {status}
          </span>

          {metrics.failed > 0 && isTerminal && (
            <Button
              variant="secondary"
              onClick={handleRetryFailed}
              disabled={retrying}
              style={{ fontSize: "0.8rem", padding: "4px 10px" }}
            >
              <RotateCw size={13} className={retrying ? "animate-spin" : ""} />
              Retry Failed ({metrics.failed})
            </Button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{ background: "var(--border)", height: "8px", borderRadius: "4px", overflow: "hidden", marginBottom: "12px" }}>
        <div
          style={{
            height: "100%",
            width: `${metrics.progressPct}%`,
            background: badgeColor,
            transition: "width 0.4s ease",
          }}
        />
      </div>

      {/* Metrics Row */}
      <div style={{ display: "flex", gap: "16px", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
        <span>Total: <strong>{metrics.total}</strong></span>
        <span>Completed: <strong style={{ color: "var(--success)" }}>{metrics.completed}</strong></span>
        <span>Failed: <strong style={{ color: metrics.failed > 0 ? "var(--danger)" : "inherit" }}>{metrics.failed}</strong></span>
        <span>Pending: <strong>{metrics.pending}</strong></span>
        <span>Processing: <strong>{metrics.processing}</strong></span>
        <span style={{ marginLeft: "auto", fontWeight: 600, color: "var(--ink)" }}>{metrics.progressPct}%</span>
      </div>
    </div>
  );
}
