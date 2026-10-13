import { useState, useEffect } from "react";
import { X, Calendar, AlertTriangle, RefreshCw, CheckCircle, ArrowRight } from "lucide-react";
import { Button, ModalFrame } from "./ui";
import { request } from "../lib/api";
import { toast } from "sonner";

interface ReschedulePreviewItem {
  contentId: string;
  title: string;
  currentScheduledAt: string | null;
  proposedScheduledAt: string;
  conflict: boolean;
  conflictMessage?: string;
}

interface BatchRescheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedContentIds: string[];
  onRescheduled: () => void;
}

export function BatchRescheduleModal({
  isOpen,
  onClose,
  selectedContentIds,
  onRescheduled,
}: BatchRescheduleModalProps) {
  const [mode, setMode] = useState<"shift" | "auto_distribute">("shift");
  const [shiftDays, setShiftDays] = useState(1);
  const [shiftHours, setShiftHours] = useState(0);
  const [previews, setPreviews] = useState<ReschedulePreviewItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    if (isOpen && selectedContentIds.length > 0) {
      fetchPreview();
    }
  }, [isOpen, mode, shiftDays, shiftHours, selectedContentIds]);

  async function fetchPreview() {
    try {
      setLoading(true);
      const res = (await request("/calendar/reschedule-preview", "POST", {
        mode,
        contentIds: selectedContentIds,
        shiftDays,
        shiftHours,
      })) as { previews: ReschedulePreviewItem[]; timezone: string };

      setPreviews(res.previews || []);
      setTimezone(res.timezone || "UTC");
    } catch (err) {
      console.error("Failed to load reschedule preview:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmReschedule() {
    try {
      setExecuting(true);
      const itemsPayload = previews.map((p) => ({
        contentId: p.contentId,
        scheduledAt: p.proposedScheduledAt,
      }));

      await request("/calendar/reschedule-bulk", "POST", { items: itemsPayload });
      toast.success(`Successfully rescheduled ${previews.length} posts!`);
      onRescheduled();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to execute bulk reschedule.");
    } finally {
      setExecuting(false);
    }
  }

  if (!isOpen) return null;

  const hasConflicts = previews.some((p) => p.conflict);

  return (
    <ModalFrame open={isOpen} onClose={()=>{if(!executing)onClose();}} title="Reschedule content" className="slots-dialog">
      <div
        className="panel"
        style={{
          width: "100%",
          maxWidth: "680px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: "16px",
          overflow: "hidden",
          border: "1px solid var(--border)",
          background: "var(--color-bg-panel, var(--surface2))",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
              <Calendar size={18} style={{ color: "#6366f1" }} />
              Bulk Reschedule Content ({selectedContentIds.length} items)
            </h2>
            <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
              Preview schedule adjustments in workspace timezone: <strong>{timezone}</strong>
            </span>
          </div>
          <button onClick={onClose} aria-label="Close reschedule dialog" className="icon-button" style={{ padding: "6px" }}>
            <X size={18} />
          </button>
        </div>

        {/* Mode Selector & Inputs */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", background: "var(--border)" }}>
          <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
            <button
              onClick={() => setMode("shift")}
              style={{
                flex: 1,
                padding: "8px 14px",
                borderRadius: "8px",
                border: mode === "shift" ? "1px solid #6366f1" : "1px solid var(--border)",
                background: mode === "shift" ? "rgba(99, 102, 241, 0.2)" : "transparent",
                color: mode === "shift" ? "#fff" : "var(--color-text-muted)",
                fontWeight: 600,
                fontSize: "0.85rem",
                cursor: "pointer",
              }}
            >
              Shift Schedule by Offset
            </button>
            <button
              onClick={() => setMode("auto_distribute")}
              style={{
                flex: 1,
                padding: "8px 14px",
                borderRadius: "8px",
                border: mode === "auto_distribute" ? "1px solid #10b981" : "1px solid var(--border)",
                background: mode === "auto_distribute" ? "rgba(16, 185, 129, 0.2)" : "transparent",
                color: mode === "auto_distribute" ? "#fff" : "var(--color-text-muted)",
                fontWeight: 600,
                fontSize: "0.85rem",
                cursor: "pointer",
              }}
            >
              Auto-Distribute into Posting Slots
            </button>
          </div>

          {mode === "shift" && (
            <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
              <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
                Shift Days:
                <input
                  type="number"
                  value={shiftDays}
                  onChange={(e) => setShiftDays(Number(e.target.value))}
                  style={{ width: "70px", marginLeft: "8px", padding: "4px 8px", background: "var(--border-strong)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--ink)" }}
                />
              </label>
              <label style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
                Shift Hours:
                <input
                  type="number"
                  value={shiftHours}
                  onChange={(e) => setShiftHours(Number(e.target.value))}
                  style={{ width: "70px", marginLeft: "8px", padding: "4px 8px", background: "var(--border-strong)", border: "1px solid var(--border)", borderRadius: "6px", color: "var(--ink)" }}
                />
              </label>
            </div>
          )}
        </div>

        {/* Preview List */}
        <div style={{ padding: "24px", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "30px", color: "var(--color-text-muted)" }}>
              Calculating prospective schedules...
            </div>
          ) : previews.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px", color: "var(--color-text-muted)" }}>
              No items to preview.
            </div>
          ) : (
            previews.map((item) => {
              const proposedDate = new Date(item.proposedScheduledAt);
              const formattedNew = proposedDate.toLocaleString("en-US", {
                timeZone: timezone,
                dateStyle: "medium",
                timeStyle: "short",
              });

              return (
                <div
                  key={item.contentId}
                  style={{
                    padding: "12px 16px",
                    borderRadius: "10px",
                    background: item.conflict ? "rgba(239, 68, 68, 0.08)" : "var(--surface2)",
                    border: item.conflict ? "1px solid rgba(239, 68, 68, 0.3)" : "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: "0.9rem", display: "block", color: "var(--ink)" }}>{item.title}</strong>
                    <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                      <span>New Time: <strong>{formattedNew}</strong></span>
                      {item.conflict && (
                        <span style={{ color: "var(--danger)", display: "flex", alignItems: "center", gap: "4px" }}>
                          <AlertTriangle size={13} /> {item.conflictMessage || "Slot Conflict!"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {hasConflicts ? (
            <span style={{ fontSize: "0.8rem", color: "var(--warning)", display: "flex", alignItems: "center", gap: "6px" }}>
              <AlertTriangle size={14} /> Some items have slot conflicts. Proceeding will overwrite conflict slots.
            </span>
          ) : (
            <span style={{ fontSize: "0.8rem", color: "var(--success)", display: "flex", alignItems: "center", gap: "6px" }}>
              <CheckCircle size={14} /> All prospective schedules are conflict-free!
            </span>
          )}

          <div style={{ display: "flex", gap: "10px" }}>
            <Button variant="ghost" onClick={onClose} disabled={executing}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleConfirmReschedule} disabled={executing || loading}>
              {executing ? "Rescheduling..." : "Confirm Reschedule"}
            </Button>
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}
