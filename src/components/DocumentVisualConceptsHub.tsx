import React, { useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Clock,
  Check,
  Plus,
  Trash2,
  Sparkles,
  RotateCw,
  Send,
  Eye,
  X,
  Save,
  Calendar,
  ArrowRight,
  Copy,
  CheckCircle2,
  AlertCircle,
  Wand2,
  Cpu,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import { Button, PlatformIcon } from "./ui";
import { request, resolveMediaUrl } from "../lib/api";
import { useWorkspace } from "./Shell";

export interface VisualConceptItem {
  id: string;
  documentId: string;
  documentName?: string;
  conceptTitle: string;
  sourcePage: number;
  sourceExcerpt: string;
  prompt: string;
  assetId?: string | null;
  imageUrl?: string | null;
  status?: string;
  scheduledAt?: string | null;
  dispatchedAt?: string | null;
  targetChannels?: string[];
  createdAt: string;
}

interface DocumentVisualConceptsHubProps {
  documentId: string;
  documentName?: string;
  onSelectVisual?: (visual: { assetId: string; url: string; prompt: string; headline?: string }) => void;
  selectedAssetId?: string;
  activeConceptId?: string | null;
  onActiveConceptSelect?: (concept: VisualConceptItem, slotInfo?: { slotNumber: number; slotLabel: string; timeStr: string }) => void;
  onScheduleUpdate?: (info: {
    slotsText: string;
    nextPostText: string;
    activeSlotsCount: number;
    allSlotsFormatted: string[];
  }) => void;
}

interface TimeSlot {
  id: string;
  time: string; // 24h format: "10:00", "14:00", "18:00"
  label: string; // Custom label
}

const DEFAULT_SLOTS: TimeSlot[] = [
  { id: "1", time: "10:00", label: "Morning Slot" },
  { id: "2", time: "14:00", label: "Afternoon Slot" },
  { id: "3", time: "18:00", label: "Evening Slot" },
];

const PRESETS = [
  {
    name: "1 Post / Day",
    desc: "Single high-impact daily dispatch",
    slots: [{ id: "1", time: "11:00", label: "Primary Broadcast" }],
  },
  {
    name: "2 Posts / Day",
    desc: "Morning & evening peak engagement",
    slots: [
      { id: "1", time: "10:30", label: "Morning Insight" },
      { id: "2", time: "18:30", label: "Evening Recap" },
    ],
  },
  {
    name: "3 Posts / Day",
    desc: "Full-day triple exposure",
    slots: [
      { id: "1", time: "10:00", label: "Morning Opening" },
      { id: "2", time: "14:00", label: "Midday Focus" },
      { id: "3", time: "19:00", label: "Evening Prime" },
    ],
  },
];

const AVAILABLE_CHANNELS = [
  { id: "linkedin", name: "LinkedIn" },
  { id: "instagram", name: "Instagram" },
  { id: "facebook", name: "Facebook" },
  { id: "telegram", name: "Telegram" },
  { id: "x", name: "X" },
  { id: "youtube", name: "YouTube" },
];

function formatTime12(time24: string): string {
  const [hStr, mStr] = (time24 || "10:00").split(":");
  let h = parseInt(hStr, 10) || 0;
  const m = parseInt(mStr, 10) || 0;
  const period = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
}

export function DocumentVisualConceptsHub({
  documentId,
  documentName,
  onSelectVisual,
  selectedAssetId,
  activeConceptId,
  onActiveConceptSelect,
  onScheduleUpdate,
}: DocumentVisualConceptsHubProps) {
  const [concepts, setConcepts] = useState<VisualConceptItem[]>([]);
  const [notice, setNotice] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [regenerating, setRegenerating] = useState<boolean>(false);
  const [generatingConceptId, setGeneratingConceptId] = useState<string | null>(null);
  const [dispatchingConceptId, setDispatchingConceptId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);
  const [allDispatched, setAllDispatched] = useState<boolean>(false);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);

  useEffect(() => {
    if (previewImage) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "unset";
      };
    }
  }, [previewImage]);

  // Dynamic Save & Confirmation State
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [isSavedSuccessfully, setIsSavedSuccessfully] = useState<boolean>(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // Time Slots & Channel Settings
  const [slots, setSlots] = useState<TimeSlot[]>(() => {
    try {
      const saved = localStorage.getItem("contentos_dispatch_slots");
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_SLOTS;
  });

  const [selectedChannels, setSelectedChannels] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("contentos_dispatch_channels");
      if (saved) return JSON.parse(saved);
    } catch {}
    return ["linkedin", "instagram", "facebook"];
  });

  const { data: workspaceData } = useWorkspace();

  const connectedPlatformIds = useMemo(() => {
    const accounts = (workspaceData as any)?.accounts || [];
    return new Set(
      accounts
        .filter((a: any) => a.state?.toLowerCase() === "connected")
        .map((a: any) => a.platform?.toLowerCase())
    );
  }, [workspaceData]);

  // Automatically enforce that only connected channels can ever be selected
  useEffect(() => {
    if (connectedPlatformIds.size > 0) {
      setSelectedChannels((prev) => {
        const valid = prev.filter((id) => connectedPlatformIds.has(id.toLowerCase()));
        return valid.length > 0 ? valid : [Array.from(connectedPlatformIds)[0]];
      });
    }
  }, [connectedPlatformIds]);

  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  // Keep live time ticking every second for countdowns
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleUpdateSlots = (newSlots: TimeSlot[]) => {
    setSlots(newSlots);
    setHasUnsavedChanges(true);
    setIsSavedSuccessfully(false);
  };

  const handleUpdateChannels = (newChannels: string[]) => {
    setSelectedChannels(newChannels);
    setHasUnsavedChanges(true);
    setIsSavedSuccessfully(false);
  };

  const handleAddCustomSlot = () => {
    if (slots.length >= 3) return;
    const nextSlotNum = slots.length + 1;
    const defaultTimes = ["11:00", "15:00", "20:00"];
    const nextTime = defaultTimes[slots.length] || "12:00";
    const newSlot: TimeSlot = {
      id: String(Date.now()),
      time: nextTime,
      label: `Custom Slot #${nextSlotNum}`,
    };
    handleUpdateSlots([...slots, newSlot]);
    setEditingSlotId(newSlot.id);
  };

  const handleRemoveSlot = (id: string) => {
    if (slots.length <= 1) return;
    const updated = slots.filter((s) => s.id !== id);
    handleUpdateSlots(updated);
  };

  const handleApplyPreset = (presetSlots: TimeSlot[]) => {
    handleUpdateSlots(presetSlots);
  };

  // Explicit Save & Apply Action
  const handleSaveAndApplySchedule = () => {
    try {
      localStorage.setItem("contentos_dispatch_slots", JSON.stringify(slots));
      localStorage.setItem("contentos_dispatch_channels", JSON.stringify(selectedChannels));
      setHasUnsavedChanges(false);
      setIsSavedSuccessfully(true);

      const slotWord = slots.length === 1 ? "1 Post / Day" : `${slots.length} Posts / Day`;
      const channelsList = selectedChannels.map((c) => c.toUpperCase()).join(", ");
      setSavedNotice(`Schedule Saved & Applied! Now dispatching ${slotWord} to [${channelsList}].`);

      // Auto-hide the success notice after 4 seconds
      setTimeout(() => {
        setIsSavedSuccessfully(false);
      }, 4000);
    } catch (err: any) {
      console.error("[VisualConceptsHub] Error saving schedule:", err);
      setError("Failed to save schedule settings.");
    }
  };

  const fetchConcepts = useCallback(async (isSilent = false) => {
    if (!documentId) return;
    if (!isSilent) setLoading(true);
    setError(null);
    try {
      const data = await request<{ concepts: VisualConceptItem[]; notice: string; count: number; allDispatched?: boolean }>(
        `/documents/${documentId}/visual-concepts`
      );
      setConcepts(data.concepts || []);
      setNotice(data.notice || "");
      if (data.concepts?.length === 0 && (data.allDispatched || data.notice?.includes("All visual posts"))) {
        setAllDispatched(true);
      } else {
        setAllDispatched(false);
      }
    } catch (err: any) {
      console.error("[VisualConceptsHub] Error loading concepts:", err);
      if (!isSilent) setError(err?.message || "Could not load visual concepts.");
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    fetchConcepts();
  }, [fetchConcepts]);

  // Auto-poll while concepts are being extracted & synthesized by AI
  useEffect(() => {
    if (loading || allDispatched || concepts.length > 0 || !documentId) return;

    let pollCount = 0;
    const maxPolls = 25; // 25 * 2.5s = ~60s max auto-poll

    const interval = setInterval(async () => {
      pollCount++;
      if (pollCount > maxPolls) {
        clearInterval(interval);
        return;
      }
      try {
        const data = await request<{ concepts: VisualConceptItem[]; notice: string; count: number; allDispatched?: boolean }>(
          `/documents/${documentId}/visual-concepts`
        );
        if (data.concepts && data.concepts.length > 0) {
          setConcepts(data.concepts);
          setNotice(data.notice || "");
          setAllDispatched(false);
          clearInterval(interval);
        } else if (data.allDispatched || data.notice?.includes("All visual posts")) {
          setAllDispatched(true);
          clearInterval(interval);
        }
      } catch {
        // continue polling
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [documentId, loading, allDispatched, concepts.length]);

  const handleRegenerateConcepts = async () => {
    if (!documentId || regenerating) return;
    setRegenerating(true);
    setError(null);
    try {
      const data = await request<{ concepts: VisualConceptItem[]; notice: string; count: number }>(
        `/documents/${documentId}/visual-concepts/regenerate`,
        "POST"
      );
      setConcepts(data.concepts || []);
      setNotice(data.notice || "");
      setAllDispatched(false);
    } catch (err: any) {
      console.error("[VisualConceptsHub] Error regenerating:", err);
      setError(err?.message || "Failed to regenerate concepts.");
    } finally {
      setRegenerating(false);
    }
  };

  const handleGenerateImage = async (concept: VisualConceptItem) => {
    if (generatingConceptId) return;
    setGeneratingConceptId(concept.id);
    setError(null);
    try {
      const data = await request<{ conceptId: string; assetId: string; imageUrl: string }>(
        `/documents/${documentId}/visual-concepts/${concept.id}/generate-image`,
        "POST",
        { prompt: concept.prompt, force: true }
      );
      // Append timestamp query parameter to bust browser cache on image reload
      const freshUrl = data.imageUrl ? (data.imageUrl.includes('?') ? `${data.imageUrl}&t=${Date.now()}` : `${data.imageUrl}?t=${Date.now()}`) : data.imageUrl;
      setConcepts((prev) =>
        prev.map((c) =>
          c.id === concept.id
            ? { ...c, assetId: data.assetId, imageUrl: freshUrl }
            : c
        )
      );
      if (onSelectVisual) {
        onSelectVisual({
          assetId: data.assetId,
          url: data.imageUrl,
          prompt: concept.prompt,
          headline: concept.conceptTitle,
        });
      }
    } catch (err: any) {
      console.error("[VisualConceptsHub] Generate error:", err);
      setError(err?.message || "Visual generation failed.");
    } finally {
      setGeneratingConceptId(null);
    }
  };

  // Immediate or automated dispatch of a concept
  const handleDispatchPost = async (conceptId: string) => {
    if (dispatchingConceptId) return;
    setDispatchingConceptId(conceptId);
    setError(null);
    try {
      await request(
        `/documents/${documentId}/visual-concepts/${conceptId}/dispatch`,
        "POST",
        { channels: selectedChannels }
      );

      // Dynamically remove the dispatched concept from pending view
      setConcepts((prev) => {
        const remaining = prev.filter((c) => c.id !== conceptId);
        if (remaining.length === 0) {
          setAllDispatched(true);
        }
        return remaining;
      });
    } catch (err: any) {
      console.error("[VisualConceptsHub] Dispatch error:", err);
      setError(err?.message || "Failed to dispatch post.");
    } finally {
      setDispatchingConceptId(null);
    }
  };

  const copyPrompt = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Map each concept sequentially across user's daily time slots (max 3 per day)
  const scheduledConcepts = useMemo(() => {
    if (!concepts.length || !slots.length) return [];

    const sortedSlots = [...slots].sort((a, b) => a.time.localeCompare(b.time));
    const now = currentTime;
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();

    let dayOffset = 0;
    // Find first slot today that hasn't passed yet
    let slotIdx = sortedSlots.findIndex((s) => {
      const [h, m] = s.time.split(":").map(Number);
      return h > currentHour || (h === currentHour && m > currentMin);
    });

    if (slotIdx === -1) {
      // All slots today have passed; start tomorrow on slot 0
      dayOffset = 1;
      slotIdx = 0;
    }

    return concepts.map((concept, i) => {
      const slot = sortedSlots[slotIdx];
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + dayOffset);
      const [sh, sm] = slot.time.split(":").map(Number);
      targetDate.setHours(sh, sm, 0, 0);

      const msDiff = targetDate.getTime() - now.getTime();
      const isDue = msDiff <= 0;

      const totalSec = Math.max(0, Math.floor(msDiff / 1000));
      const hours = Math.floor(totalSec / 3600);
      const minutes = Math.floor((totalSec % 3600) / 60);
      const seconds = totalSec % 60;
      const countdownStr = `${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;

      const dayLabel = dayOffset === 0 ? "Today" : dayOffset === 1 ? "Tomorrow" : targetDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      const formattedTime = targetDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

      // Advance slot for next item
      slotIdx++;
      if (slotIdx >= sortedSlots.length) {
        slotIdx = 0;
        dayOffset++;
      }

      return {
        concept,
        slotNumber: (i % sortedSlots.length) + 1,
        slotLabel: slot.label,
        dayLabel,
        formattedTime,
        countdownStr,
        isDue,
        targetDate,
      };
    });
  }, [concepts, slots, currentTime]);

  // Auto-sync first active concept with the right preview panel
  useEffect(() => {
    if (scheduledConcepts.length > 0 && onActiveConceptSelect) {
      const activeItem = scheduledConcepts.find((sc) => sc.concept.status !== "DISPATCHED") || scheduledConcepts[0];
      if (activeItem) {
        onActiveConceptSelect(activeItem.concept, {
          slotNumber: activeItem.slotNumber,
          slotLabel: activeItem.slotLabel,
          timeStr: activeItem.formattedTime,
        });
      }
    }
  }, [concepts.length, scheduledConcepts.length]);

  // Dynamically sync active time slots & upcoming post time to the parent Auto-Pilot toolbar
  useEffect(() => {
    if (slots.length > 0 && onScheduleUpdate) {
      const sortedSlots = [...slots].sort((a, b) => a.time.localeCompare(b.time));
      const slotsText = sortedSlots.map((s) => formatTime12(s.time)).join(", ");
      let nextPostText = "";
      if (scheduledConcepts.length > 0) {
        const first = scheduledConcepts.find((sc) => sc.concept.status !== "DISPATCHED") || scheduledConcepts[0];
        nextPostText = `${first.dayLabel} at ${first.formattedTime}`;
        const nextItems = scheduledConcepts.filter((sc) => sc.concept.id !== first.concept.id && sc.concept.status !== "DISPATCHED");
        if (nextItems.length > 0) {
          nextPostText += ` • Next: ${nextItems[0].formattedTime}`;
        }
      } else {
        nextPostText = `Today at ${formatTime12(sortedSlots[0].time)}`;
      }

      onScheduleUpdate({
        slotsText,
        nextPostText,
        activeSlotsCount: sortedSlots.length,
        allSlotsFormatted: sortedSlots.map((s) => formatTime12(s.time)),
      });
    }
  }, [slots, scheduledConcepts, onScheduleUpdate]);

  return (
    <div
      style={{
        marginTop: "8px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
      }}
    >
      {/* Header Row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "12px",
        }}
      >
        <h3
          style={{
            fontSize: "1.05rem",
            fontWeight: 700,
            color: "#f8fafc",
            margin: 0,
            letterSpacing: "-0.01em",
          }}
        >
          Visual Storytelling Concepts
        </h3>

        <Button
          variant="secondary"
          onClick={handleRegenerateConcepts}
          disabled={regenerating || loading}
          style={{
            fontSize: "0.76rem",
            padding: "5px 12px",
            display: "flex",
            alignItems: "center",
            gap: "5px",
            background: "rgba(255, 255, 255, 0.04)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            color: "var(--color-text-muted)",
          }}
        >
          {regenerating ? (
            <>
              <RotateCw size={12} className="animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <RotateCw size={12} />
              Re-analyze Document
            </>
          )}
        </Button>
      </div>

      {/* Ultra-Sleek Minimal Executive Dispatch Schedule Bar */}
      <div
        style={{
          background: "rgba(15, 23, 42, 0.4)",
          border: hasUnsavedChanges ? "1px solid rgba(99, 102, 241, 0.35)" : "1px solid rgba(255, 255, 255, 0.06)",
          borderRadius: "10px",
          padding: "10px 14px",
          marginBottom: "12px",
        }}
      >
        {/* Top Line: Title + Preset Pills + Add Slot + Save */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Clock size={15} style={{ color: "#818cf8" }} />
            <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f8fafc" }}>
              Daily Dispatch Schedule
            </span>
            <span style={{ fontSize: "0.68rem", color: "#818cf8", background: "rgba(99, 102, 241, 0.12)", border: "1px solid rgba(99, 102, 241, 0.2)", padding: "1px 6px", borderRadius: "100px", fontWeight: 700 }}>
              {slots.length}/3 Slots
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            {/* Minimal Preset Pills */}
            <div style={{ display: "flex", alignItems: "center", background: "rgba(255, 255, 255, 0.04)", padding: "2px", borderRadius: "16px", border: "1px solid rgba(255, 255, 255, 0.06)" }}>
              {PRESETS.map((p) => {
                const isActive = slots.length === p.slots.length;
                return (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => handleApplyPreset(p.slots)}
                    style={{
                      background: isActive ? "#4f46e5" : "transparent",
                      color: isActive ? "#ffffff" : "#94a3b8",
                      border: "none",
                      padding: "3px 9px",
                      borderRadius: "12px",
                      fontSize: "0.7rem",
                      fontWeight: isActive ? 700 : 500,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                    title={p.desc}
                  >
                    {p.name.replace(' Posts / Day', '/day').replace(' Post / Day', '/day')}
                  </button>
                );
              })}
            </div>

            {/* Add Custom Slot */}
            {slots.length < 3 && (
              <button
                type="button"
                onClick={handleAddCustomSlot}
                style={{
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px dashed rgba(255, 255, 255, 0.15)",
                  color: "#94a3b8",
                  padding: "3px 9px",
                  borderRadius: "14px",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <Plus size={11} /> Add
              </button>
            )}

            {/* Save / Applied Indicator Button */}
            <button
              type="button"
              onClick={handleSaveAndApplySchedule}
              style={{
                background: isSavedSuccessfully
                  ? "#10b981"
                  : hasUnsavedChanges
                  ? "#4f46e5"
                  : "rgba(255, 255, 255, 0.06)",
                border: isSavedSuccessfully
                  ? "1px solid #10b981"
                  : hasUnsavedChanges
                  ? "1px solid #6366f1"
                  : "1px solid rgba(255, 255, 255, 0.08)",
                color: "#ffffff",
                padding: "3px 10px",
                borderRadius: "14px",
                fontSize: "0.7rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                transition: "all 0.2s ease",
              }}
            >
              {isSavedSuccessfully ? <Check size={11} /> : <Save size={11} />}
              <span>{isSavedSuccessfully ? "Applied" : hasUnsavedChanges ? "Save" : "Saved"}</span>
            </button>
          </div>
        </div>

        {/* Dynamic & Minimal Target Channels Row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            flexWrap: "wrap",
            paddingBottom: "8px",
            marginBottom: "8px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
          }}
        >
          <span style={{ fontSize: "0.7rem", color: "#64748b", fontWeight: 600, marginRight: "2px" }}>Target Channels:</span>
          {AVAILABLE_CHANNELS.map((ch) => {
            const isConnected = connectedPlatformIds.size === 0 || connectedPlatformIds.has(ch.id.toLowerCase());
            const isSelected = isConnected && selectedChannels.includes(ch.id);

            return (
              <button
                key={ch.id}
                type="button"
                disabled={!isConnected}
                onClick={() => {
                  if (!isConnected) return;
                  if (isSelected) {
                    if (selectedChannels.length > 1) {
                      handleUpdateChannels(selectedChannels.filter((c) => c !== ch.id));
                    }
                  } else {
                    handleUpdateChannels([...selectedChannels, ch.id]);
                  }
                }}
                title={isConnected ? `${ch.name} (Connected)` : `${ch.name} (Not connected in settings)`}
                style={{
                  padding: "3px 8px",
                  borderRadius: "5px",
                  border: isSelected
                    ? "1px solid rgba(99, 102, 241, 0.6)"
                    : isConnected
                    ? "1px solid rgba(255, 255, 255, 0.08)"
                    : "1px dashed rgba(255, 255, 255, 0.05)",
                  background: isSelected
                    ? "rgba(99, 102, 241, 0.2)"
                    : isConnected
                    ? "rgba(255, 255, 255, 0.02)"
                    : "rgba(0, 0, 0, 0.15)",
                  color: isSelected
                    ? "#ffffff"
                    : isConnected
                    ? "#94a3b8"
                    : "#475569",
                  fontSize: "0.7rem",
                  fontWeight: isSelected ? 700 : 500,
                  cursor: isConnected ? "pointer" : "not-allowed",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  opacity: isConnected ? 1 : 0.45,
                  transition: "all 0.15s ease",
                }}
              >
                <PlatformIcon platform={ch.id} />
                <span>{ch.name}</span>
                {isSelected && <Check size={10} style={{ color: "#818cf8" }} />}
                {!isConnected && <span style={{ fontSize: "0.6rem", opacity: 0.8 }}>(off)</span>}
              </button>
            );
          })}
        </div>

        {/* Sleek Executive Time Slot Cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fit, minmax(180px, 1fr))`,
            gap: "10px",
          }}
        >
          {slots.map((slot, idx) => (
            <div
              key={slot.id}
              style={{
                background: "rgba(15, 23, 42, 0.65)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "10px",
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
                transition: "border-color 0.15s ease, background 0.15s ease",
              }}
            >
              {/* Top Row: Slot # Badge + Full-width Label + Remove button */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "6px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      fontSize: "0.65rem",
                      fontWeight: 800,
                      color: "#818cf8",
                      background: "rgba(99, 102, 241, 0.15)",
                      border: "1px solid rgba(99, 102, 241, 0.25)",
                      padding: "1px 6px",
                      borderRadius: "4px",
                      letterSpacing: "0.5px",
                      textTransform: "uppercase",
                      flexShrink: 0,
                    }}
                  >
                    #{idx + 1}
                  </span>
                  <input
                    type="text"
                    value={slot.label}
                    onChange={(e) => {
                      const updated = slots.map((s) => (s.id === slot.id ? { ...s, label: e.target.value } : s));
                      handleUpdateSlots(updated);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px solid transparent",
                      color: "#f1f5f9",
                      fontSize: "0.78rem",
                      fontWeight: 600,
                      outline: "none",
                      padding: "2px 4px",
                      margin: 0,
                      width: "100%",
                      borderRadius: "2px",
                      transition: "border-color 0.15s ease",
                    }}
                    onFocus={(e) => (e.target.style.borderBottomColor = "#6366f1")}
                    onBlur={(e) => (e.target.style.borderBottomColor = "transparent")}
                    placeholder="Slot title..."
                  />
                </div>

                {slots.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveSlot(slot.id)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#64748b",
                      cursor: "pointer",
                      padding: "2px 4px",
                      borderRadius: "4px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      transition: "color 0.15s ease",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#f43f5e")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#64748b")}
                    title="Remove slot"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {/* Bottom Row: Dedicated Sleek Time Input with Instant Native Picker */}
              <div
                style={{
                  position: "relative",
                  width: "100%",
                }}
              >
                <input
                  type="time"
                  value={slot.time}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) return;
                    const updated = slots.map((s) => (s.id === slot.id ? { ...s, time: val } : s));
                    handleUpdateSlots(updated);
                  }}
                  onClick={(e) => {
                    try {
                      e.currentTarget.showPicker();
                    } catch {}
                  }}
                  style={{
                    width: "100%",
                    background: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: "7px",
                    color: "#ffffff",
                    fontSize: "0.86rem",
                    fontWeight: 700,
                    padding: "7px 10px",
                    cursor: "pointer",
                    outline: "none",
                    colorScheme: "dark",
                    boxSizing: "border-box",
                    letterSpacing: "0.4px",
                    transition: "all 0.15s ease",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "rgba(99, 102, 241, 0.6)";
                    e.currentTarget.style.background = "rgba(99, 102, 241, 0.08)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.1)";
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
                  }}
                  title="Click to edit time"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Dynamic PDF Extraction Notice Banner (compact, only when concepts exist) */}
      {notice && !loading && !allDispatched && concepts.length > 0 && (
        <div
          style={{
            padding: "8px 14px",
            borderRadius: "8px",
            background: "rgba(99, 102, 241, 0.08)",
            border: "1px solid rgba(99, 102, 241, 0.2)",
            marginBottom: "16px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <Sparkles size={14} color="#818cf8" style={{ flexShrink: 0 }} />
          <p
            style={{
              margin: 0,
              fontSize: "0.78rem",
              color: "#c7d2fe",
              lineHeight: 1.4,
              fontWeight: 500,
            }}
          >
            {notice}
          </p>
        </div>
      )}

      {/* Error message if any */}
      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: "8px",
            background: "rgba(239, 68, 68, 0.15)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#fca5a5",
            fontSize: "0.82rem",
            marginBottom: "16px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <AlertCircle size={15} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Initial Loading state */}
      {loading && concepts.length === 0 && (
        <div style={{ padding: "40px", textAlign: "center", color: "var(--color-text-muted)" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              border: "3px solid rgba(99, 102, 241, 0.2)",
              borderTopColor: "#818cf8",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              margin: "0 auto 14px auto",
            }}
          />
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#c7d2fe" }}>
            Connecting to AI Analysis Engine...
          </p>
        </div>
      )}

      {/* Sleek High-Tech AI Document Analysis State (shown while extracting/analyzing newly uploaded PDF) */}
      {!loading && !allDispatched && concepts.length === 0 && (
        <div
          style={{
            padding: "44px 24px",
            textAlign: "center",
            background: "linear-gradient(180deg, rgba(30, 41, 59, 0.35) 0%, rgba(15, 23, 42, 0.6) 100%)",
            border: "1px solid rgba(99, 102, 241, 0.25)",
            borderRadius: "14px",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.25)",
            position: "relative",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "18px",
          }}
        >
          {/* Subtle Ambient Glow */}
          <div
            style={{
              position: "absolute",
              top: "-40px",
              left: "50%",
              transform: "translateX(-50%)",
              width: "280px",
              height: "120px",
              background: "radial-gradient(ellipse at center, rgba(99, 102, 241, 0.2) 0%, transparent 70%)",
              pointerEvents: "none",
            }}
          />

          {/* Animated Multi-Ring Radar Orb */}
          <div style={{ position: "relative", width: "64px", height: "64px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                border: "2px solid rgba(99, 102, 241, 0.25)",
                animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: "6px",
                borderRadius: "50%",
                border: "2px dashed rgba(168, 85, 247, 0.35)",
                animation: "spin 8s linear infinite",
              }}
            />
            <div
              style={{
                width: "42px",
                height: "42px",
                borderRadius: "12px",
                background: "linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(168, 85, 247, 0.2) 100%)",
                border: "1px solid rgba(129, 140, 248, 0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#c7d2fe",
              }}
            >
              <Cpu size={20} className="animate-pulse" />
            </div>
          </div>

          {/* Header Info */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxWidth: "520px" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", justifyContent: "center", alignSelf: "center", padding: "2px 10px", borderRadius: "100px", background: "rgba(99, 102, 241, 0.12)", border: "1px solid rgba(99, 102, 241, 0.25)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6366f1", display: "inline-block" }} />
              <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#a5b4fc", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                AI Analysis In Progress
              </span>
            </div>
            <h4 style={{ fontSize: "1.15rem", fontWeight: 700, color: "#f8fafc", margin: "4px 0 0 0" }}>
              Analyzing Document &amp; Formulating Visual Concepts
            </h4>
            <p style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", margin: 0, lineHeight: 1.5 }}>
              Extracting structural typography, verifying core enterprise claims, and formulating dynamic FLUX.1 visual prompts from <strong>{documentName || "your document"}</strong>.
            </p>
          </div>

          {/* Real-time Pipeline Steps */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: "8px",
              width: "100%",
              maxWidth: "560px",
            }}
          >
            {[
              { label: "1. OCR & Content Parsing", active: true },
              { label: "2. Verifiable Knowledge Claims", active: true },
              { label: "3. FLUX.1 Prompt Synthesis", active: false },
            ].map((step, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "5px 12px",
                  borderRadius: "6px",
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(255, 255, 255, 0.07)",
                  fontSize: "0.72rem",
                  color: "#cbd5e1",
                }}
              >
                <RotateCw size={11} className="animate-spin" style={{ color: "#818cf8" }} />
                <span>{step.label}</span>
              </div>
            ))}
          </div>

          {/* Shimmer Pulse Bar */}
          <div
            style={{
              width: "100%",
              maxWidth: "380px",
              height: "4px",
              borderRadius: "2px",
              background: "rgba(255, 255, 255, 0.06)",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                width: "45%",
                background: "linear-gradient(90deg, transparent, #6366f1, #a855f7, transparent)",
                borderRadius: "2px",
                animation: "shimmer 1.8s ease-in-out infinite",
              }}
            />
          </div>

          {/* Manual Re-check Button */}
          <button
            type="button"
            onClick={() => fetchConcepts(false)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "6px",
              padding: "6px 14px",
              color: "var(--color-text-muted)",
              fontSize: "0.75rem",
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <RotateCw size={12} />
            Check Status
          </button>
        </div>
      )}

      {/* All Posts Dispatched Completion Banner (ONLY shown when all concepts were dispatched) */}
      {!loading && allDispatched && concepts.length === 0 && (
        <div
          style={{
            padding: "40px 24px",
            textAlign: "center",
            background: "linear-gradient(180deg, rgba(16, 185, 129, 0.08) 0%, rgba(13, 148, 136, 0.03) 100%)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            borderRadius: "14px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <CheckCircle2 size={38} color="#34d399" />
          <h4 style={{ fontSize: "1.2rem", color: "#34d399", fontWeight: 700, margin: 0 }}>
            All Visual Posts from this PDF Have Been Dispatched!
          </h4>
          <p style={{ fontSize: "0.85rem", color: "#a7f3d0", maxWidth: "540px", margin: 0, lineHeight: 1.5 }}>
            Every extracted concept from your uploaded document has been successfully published to your scheduled channels. Upload a new PDF to generate and schedule your next content batch.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginTop: "8px" }}>
            <Button
              variant="primary"
              onClick={handleRegenerateConcepts}
              disabled={regenerating}
              style={{ fontSize: "0.82rem", padding: "8px 18px", display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <RotateCw size={13} className={regenerating ? "animate-spin" : ""} />
              Re-analyze &amp; Generate Fresh Batch
            </Button>
          </div>
        </div>
      )}

      {/* Scheduled Concept Cards List */}
      {!loading && !allDispatched && scheduledConcepts.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: scheduledConcepts.length === 1 ? "1fr" : "repeat(auto-fit, minmax(460px, 1fr))",
            gap: "18px",
          }}
        >
          {scheduledConcepts.map(({ concept, slotNumber, slotLabel, dayLabel, formattedTime, countdownStr }, index) => {
            const isGeneratingThis = generatingConceptId === concept.id;
            const isDispatchingThis = dispatchingConceptId === concept.id;
            const isAttached = selectedAssetId && selectedAssetId === concept.assetId;

            return (
              <div
                key={concept.id}
                style={{
                  borderRadius: "14px",
                  background: isAttached
                    ? "rgba(99, 102, 241, 0.04)"
                    : "rgba(255, 255, 255, 0.02)",
                  border: isAttached
                    ? "1px solid #6366f1"
                    : "1px solid rgba(255, 255, 255, 0.08)",
                  boxShadow: "none",
                  padding: "14px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  transition: "all 0.2s ease-in-out",
                }}
              >
                {/* Dynamic Timer & Custom Slot Dispatch Badge */}
                <div
                  style={{
                    background: "rgba(99, 102, 241, 0.08)",
                    border: "1px solid rgba(99, 102, 241, 0.2)",
                    borderRadius: "8px",
                    padding: "8px 12px",
                    marginBottom: "12px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "0.95rem" }}>⏳</span>
                    <div>
                      <span style={{ fontSize: "0.72rem", color: "#93c5fd", fontWeight: 700, textTransform: "uppercase" }}>
                        Slot #{slotNumber} ({slotLabel}) • {dayLabel} at {formattedTime}
                      </span>
                      <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "#60a5fa", letterSpacing: "0.5px" }}>
                        Live in {countdownStr}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    {selectedChannels.map((ch) => (
                      <span
                        key={ch}
                        style={{
                          fontSize: "0.68rem",
                          background: "rgba(255, 255, 255, 0.08)",
                          color: "#e2e8f0",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          fontWeight: 600,
                          textTransform: "capitalize",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <PlatformIcon platform={ch} /> {ch}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Concept Header */}
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "10px",
                      marginBottom: "10px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span
                        style={{
                          width: "24px",
                          height: "24px",
                          borderRadius: "50%",
                          background: "#3b82f6",
                          color: "#ffffff",
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {index + 1}
                      </span>
                      <h4
                        style={{
                          fontSize: "1rem",
                          fontWeight: 700,
                          color: "#ffffff",
                          margin: 0,
                        }}
                      >
                        {concept.conceptTitle}
                      </h4>
                    </div>

                    <span
                      style={{
                        fontSize: "0.72rem",
                        color: "#94a3b8",
                        background: "rgba(255, 255, 255, 0.05)",
                        padding: "2px 8px",
                        borderRadius: "5px",
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                      }}
                    >
                      {concept.documentName && (
                        <span style={{ color: "#a5b4fc", maxWidth: "130px", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {concept.documentName} •
                        </span>
                      )}
                      <span>Pg {concept.sourcePage || 1}</span>
                    </span>
                  </div>

                  {/* PDF Source Excerpt Quote */}
                  {concept.sourceExcerpt && (
                    <div
                      style={{
                        padding: "8px 12px",
                        borderRadius: "6px",
                        background: "rgba(0, 0, 0, 0.25)",
                        borderLeft: "3px solid rgba(96, 165, 250, 0.6)",
                        marginBottom: "12px",
                        fontSize: "0.78rem",
                        color: "#94a3b8",
                        fontStyle: "italic",
                        lineHeight: 1.4,
                      }}
                    >
                      "{concept.sourceExcerpt}"
                    </div>
                  )}

                  {/* Dynamic Prompt Container */}
                  <div style={{ marginBottom: "16px" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "6px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.7rem",
                          fontWeight: 700,
                          letterSpacing: "0.8px",
                          textTransform: "uppercase",
                          color: "#93c5fd",
                        }}
                      >
                        FLUX.1 Dynamic Prompt:
                      </span>
                      <button
                        onClick={() => copyPrompt(concept.id, concept.prompt)}
                        style={{
                          background: "none",
                          border: "none",
                          color: copiedId === concept.id ? "#34d399" : "#94a3b8",
                          fontSize: "0.75rem",
                          cursor: "pointer",
                          padding: 0,
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        {copiedId === concept.id ? (
                          <>
                            <Check size={11} color="#34d399" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy size={11} />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div
                      style={{
                        fontSize: "0.82rem",
                        color: "#e2e8f0",
                        lineHeight: 1.5,
                        background: "rgba(0, 0, 0, 0.35)",
                        padding: "10px 14px",
                        borderRadius: "8px",
                        border: "1px solid rgba(255, 255, 255, 0.05)",
                      }}
                    >
                      "{concept.prompt}"
                    </div>
                  </div>
                </div>

                {/* Live Image Preview & Actions Area */}
                <div>
                  {concept.imageUrl ? (
                    <div style={{ marginBottom: "14px" }}>
                      <div
                        style={{
                          position: "relative",
                          width: "100%",
                          height: "220px",
                          borderRadius: "10px",
                          overflow: "hidden",
                          border: "1px solid rgba(255, 255, 255, 0.12)",
                          background: "#0a0c14",
                          cursor: "pointer",
                        }}
                        onClick={() =>
                          setPreviewImage({
                            url: resolveMediaUrl(concept.imageUrl || "") || "",
                            title: concept.conceptTitle,
                          })
                        }
                      >
                        <img
                          src={resolveMediaUrl(concept.imageUrl)}
                          alt={concept.conceptTitle}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                        <div
                          style={{
                            position: "absolute",
                            bottom: "8px",
                            right: "8px",
                            background: "rgba(0, 0, 0, 0.75)",
                            backdropFilter: "blur(4px)",
                            padding: "3px 8px",
                            borderRadius: "6px",
                            fontSize: "0.7rem",
                            color: "#ffffff",
                            fontWeight: 600,
                          }}
                        >
                          Generated via FLUX.1
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        marginBottom: "14px",
                        padding: "32px 16px",
                        textAlign: "center",
                        borderRadius: "10px",
                        background: "rgba(0, 0, 0, 0.2)",
                        border: "1px dashed rgba(255, 255, 255, 0.1)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "center", marginBottom: "8px" }}>
                        <Wand2 size={24} color="#818cf8" style={{ opacity: 0.8 }} />
                      </div>
                      <p style={{ margin: 0, fontSize: "0.8rem", color: "#94a3b8" }}>
                        Image not yet generated for this concept.
                      </p>
                    </div>
                  )}

                  {/* Actions Bar */}
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <Button
                      variant="secondary"
                      onClick={() => handleGenerateImage(concept)}
                      disabled={isGeneratingThis || isDispatchingThis}
                      style={{
                        flex: 1,
                        fontSize: "0.82rem",
                        padding: "8px 12px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                      }}
                    >
                      {isGeneratingThis ? (
                        <>
                          <RotateCw size={12} className="animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          {concept.imageUrl ? <RotateCw size={12} /> : <Sparkles size={12} />}
                          <span>{concept.imageUrl ? "Regenerate Visual" : "Generate Visual"}</span>
                        </>
                      )}
                    </Button>

                    <Button
                      variant="primary"
                      onClick={() => handleDispatchPost(concept.id)}
                      disabled={isDispatchingThis || isGeneratingThis}
                      style={{
                        flex: 1.2,
                        fontSize: "0.82rem",
                        padding: "8px 14px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px",
                        background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                        borderColor: "#059669",
                        color: "#ffffff",
                        fontWeight: 700,
                      }}
                    >
                      {isDispatchingThis ? (
                        <>
                          <RotateCw size={12} className="animate-spin" />
                          Dispatching...
                        </>
                      ) : (
                        <>
                          <Send size={12} />
                          <span>Post Now</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Lightbox Modal rendered via portal to prevent viewport clipping */}
      {previewImage &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              width: "100vw",
              height: "100vh",
              background: "rgba(0, 0, 0, 0.88)",
              backdropFilter: "blur(12px)",
              zIndex: 999999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "24px",
              boxSizing: "border-box",
            }}
            onClick={() => setPreviewImage(null)}
          >
            <div
              style={{
                position: "relative",
                maxWidth: "92vw",
                maxHeight: "92vh",
                borderRadius: "16px",
                overflow: "hidden",
                boxShadow: "0 25px 60px -15px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.1)",
                background: "#090d16",
                display: "flex",
                flexDirection: "column",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  padding: "14px 20px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "rgba(15, 23, 42, 0.95)",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Sparkles size={16} style={{ color: "#818cf8" }} />
                  <h5 style={{ margin: 0, color: "#ffffff", fontSize: "0.95rem", fontWeight: 700 }}>
                    {previewImage.title}
                  </h5>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewImage(null)}
                  style={{
                    background: "rgba(255, 255, 255, 0.08)",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    color: "#ffffff",
                    borderRadius: "8px",
                    width: "32px",
                    height: "32px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: 700,
                  }}
                  title="Close preview"
                >
                  <X size={16} />
                </button>
              </div>

              <div style={{ padding: "16px", display: "flex", alignItems: "center", justifyContent: "center", background: "#060911" }}>
                <img
                  src={previewImage.url}
                  alt={previewImage.title}
                  style={{
                    maxWidth: "85vw",
                    maxHeight: "75vh",
                    width: "auto",
                    height: "auto",
                    objectFit: "contain",
                    borderRadius: "8px",
                    display: "block",
                  }}
                />
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}