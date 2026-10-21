import { useState, useEffect } from "react";
import { X, Plus, Trash2, Clock, Calendar as CalendarIcon, Check } from "lucide-react";
import { Button, ModalFrame } from "./ui";
import { request } from "../lib/api";
import { toast } from "sonner";

export interface PostingSlotItem {
  day_of_week: number;
  time_of_day: string;
  platform?: string | null;
  enabled?: boolean;
}

interface PostingSlotsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PLATFORMS = ["LinkedIn", "Facebook", "X", "Instagram", "Telegram", "YouTube"];

export function PostingSlotsModal({ isOpen, onClose, onSaved }: PostingSlotsModalProps) {
  const [slots, setSlots] = useState<PostingSlotItem[]>([]);
  const [timezone, setTimezone] = useState("UTC");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchSlots();
    }
  }, [isOpen]);

  async function fetchSlots() {
    try {
      setLoading(true);
      const res = (await request("/calendar/slots")) as { slots: PostingSlotItem[]; timezone: string };
      setSlots(res.slots || []);
      setTimezone(res.timezone || "UTC");
    } catch (err) {
      console.error("Failed to load posting slots:", err);
      toast.error("Failed to load posting slots.");
    } finally {
      setLoading(false);
    }
  }

  function handleAddSlot(dayOfWeek: number) {
    setSlots((prev) => [
      ...prev,
      { day_of_week: dayOfWeek, time_of_day: "09:00", platform: null, enabled: true },
    ]);
  }

  function handleRemoveSlot(index: number) {
    setSlots((prev) => prev.filter((_, idx) => idx !== index));
  }

  function handleUpdateSlot(index: number, patch: Partial<PostingSlotItem>) {
    setSlots((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item))
    );
  }

  async function handleSave() {
    try {
      setSaving(true);
      await request("/calendar/slots", "POST", { slots });
      toast.success("Workspace posting slots updated successfully!");
      if (onSaved) onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Failed to save posting slots.");
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <ModalFrame open={isOpen} onClose={()=>{if(!saving)onClose();}} title="Posting slots" className="slots-dialog">
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
              <Clock size={18} style={{ color: "#6366f1" }} />
              Workspace Recurring Posting Slots
            </h2>
            <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
              All times are evaluated in workspace timezone: <strong>{timezone}</strong>
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close posting slots"
            className="icon-button"
            style={{ padding: "6px", borderRadius: "50%", background: "var(--border)" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: "24px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "24px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "40px", color: "var(--color-text-muted)" }}>
              Loading posting slots...
            </div>
          ) : (
            DAYS.map((dayName, dayIdx) => {
              const daySlots = slots
                .map((s, idx) => ({ ...s, originalIndex: idx }))
                .filter((s) => s.day_of_week === dayIdx);

              return (
                <div
                  key={dayName}
                  style={{
                    background: "var(--surface2)",
                    borderRadius: "12px",
                    border: "1px solid var(--border)",
                    padding: "16px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <strong style={{ fontSize: "0.95rem", color: daySlots.length ? "#fff" : "var(--color-text-muted)" }}>
                      {dayName} ({daySlots.length} slots)
                    </strong>
                    <Button
                      variant="ghost"
                      onClick={() => handleAddSlot(dayIdx)}
                      style={{ fontSize: "0.8rem", padding: "4px 10px" }}
                    >
                      <Plus size={14} /> Add Slot
                    </Button>
                  </div>

                  {daySlots.length === 0 ? (
                    <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", fontStyle: "italic" }}>
                      No active slots configured for {dayName}.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {daySlots.map((slot) => (
                        <div
                          key={slot.originalIndex}
                          className="posting-slot-row"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                            background: slot.enabled ? "var(--surface2)" : "var(--surface2)",
                            opacity: slot.enabled ? 1 : 0.5,
                            padding: "8px 12px",
                            borderRadius: "8px",
                            border: "1px solid var(--border)",
                          }}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Enable ${dayName} posting slot`}
                            checked={slot.enabled !== false}
                            onChange={(e) =>
                              handleUpdateSlot(slot.originalIndex, { enabled: e.target.checked })
                            }
                            style={{ cursor: "pointer" }}
                          />

                          <input
                            type="time"
                            aria-label={`${dayName} posting time`}
                            value={slot.time_of_day}
                            onInput={(e) => handleUpdateSlot(slot.originalIndex, { time_of_day: e.currentTarget.value })}
                            onChange={(e) =>
                              handleUpdateSlot(slot.originalIndex, { time_of_day: e.target.value })
                            }
                            style={{
                              background: "var(--surface2)",
                              border: "1px solid var(--border)",
                              borderRadius: "6px",
                              color: "var(--ink)",
                              padding: "4px 8px",
                              fontSize: "0.85rem",
                            }}
                          />

                          <select
                            aria-label={`${dayName} platform`}
                            value={slot.platform || ""}
                            onChange={(e) =>
                              handleUpdateSlot(slot.originalIndex, {
                                platform: e.target.value || null,
                              })
                            }
                            style={{
                              background: "var(--surface2)",
                              border: "1px solid var(--border)",
                              borderRadius: "6px",
                              color: "var(--ink)",
                              padding: "4px 8px",
                              fontSize: "0.85rem",
                              flex: 1,
                            }}
                          >
                            <option value="">All Platforms</option>
                            {PLATFORMS.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>

                          <button
                            onClick={() => handleRemoveSlot(slot.originalIndex)}
                            style={{
                              background: "transparent",
                              border: "none",
                              color: "var(--danger)",
                              cursor: "pointer",
                              padding: "4px",
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
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
            justifyContent: "flex-end",
            gap: "12px",
          }}
        >
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? "Saving..." : "Save Posting Slots"}
          </Button>
        </div>
      </div>
    </ModalFrame>
  );
}
