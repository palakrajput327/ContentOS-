import React, { useState, useEffect } from "react";
import {
  Clock,
  Sparkles,
  Zap,
  Image as ImageIcon,
  CheckCircle2,
  ExternalLink,
  Eye,
  Send,
  RefreshCw,
  Layers,
  FileText,
  AlertTriangle,
  ChevronRight,
  Maximize2,
  X,
} from "lucide-react";
import { resolveMediaUrl } from "../lib/api";
import { Button, PlatformIcon, StatusBadge } from "./ui";

export interface LiveAutoPilotPulseProps {
  plans?: any[];
  settings?: any;
  timezone?: string;
  onPublishNow?: (planId: string) => Promise<void>;
  onTriggerAutoPilot?: () => void;
  autopilotRunning?: boolean;
  onSelectPlan?: (plan: any) => void;
  onOpenVisualStudio?: (prompt: string, headline: string) => void;
}

export function LiveAutoPilotPulse({
  plans = [],
  settings,
  timezone = "Asia/Kolkata",
  onPublishNow,
  onTriggerAutoPilot,
  autopilotRunning = false,
  onSelectPlan,
  onOpenVisualStudio,
}: LiveAutoPilotPulseProps) {
  const [now, setNow] = useState(Date.now());
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [activeLightbox, setActiveLightbox] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);

  // Tick every second for the dynamic live countdown
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Find the next upcoming scheduled plan, or the most recent one
  const upcomingPlans = plans.filter(
    (p) => p.publish_state === "ENQUEUED" || p.content_status === "SCHEDULED" || p.state === "ENQUEUED"
  ).sort((a, b) => {
    const timeA = new Date(a.execute_at || a.scheduled_at || a.proposed_at || 0).getTime();
    const timeB = new Date(b.execute_at || b.scheduled_at || b.proposed_at || 0).getTime();
    return timeA - timeB;
  });

  const nextPlan = upcomingPlans.find(
    (p) => new Date(p.execute_at || p.scheduled_at || p.proposed_at || 0).getTime() >= now
  ) || upcomingPlans[0] || plans[0];

  const currentPlan = (selectedPlanId ? plans.find((p) => p.id === selectedPlanId) : nextPlan) || null;

  if (!currentPlan) {
    return (
      <div
        style={{
          margin: "18px 0",
          padding: "20px 24px",
          borderRadius: "14px",
          background: "linear-gradient(135deg, rgba(15, 23, 42, 0.75) 0%, rgba(30, 27, 75, 0.6) 100%)",
          border: "1px dashed rgba(99, 102, 241, 0.35)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "12px",
              background: autopilotRunning ? "rgba(99, 102, 241, 0.25)" : "rgba(99, 102, 241, 0.15)",
              border: autopilotRunning ? "1px solid rgba(129, 140, 248, 0.6)" : "1px solid rgba(99, 102, 241, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#818cf8",
              boxShadow: autopilotRunning ? "0 0 15px rgba(99, 102, 241, 0.4)" : "none",
            }}
          >
            {autopilotRunning ? (
              <RefreshCw size={22} style={{ animation: "spin 2s linear infinite", color: "#a5b4fc" }} />
            ) : (
              <Clock size={22} />
            )}
          </div>
          <div>
            <h4 style={{ margin: "0 0 4px", fontSize: "0.95rem", color: "#f8fafc", fontWeight: 600 }}>
              {autopilotRunning ? "⚡ Auto-Pilot Generating in Real-Time…" : "Real-Time Posting Pipeline Ready"}
            </h4>
            <p style={{ margin: 0, fontSize: "0.82rem", color: autopilotRunning ? "#cbd5e1" : "var(--color-text-muted)" }}>
              {autopilotRunning
                ? "AI is analyzing PDF facts, writing 3D visual prompts, generating Octane renders, and queuing multi-platform posts."
                : "No automated posts currently queued. Click below to generate your next scheduled post immediately."}
            </p>
          </div>
        </div>
        {onTriggerAutoPilot && (
          <Button
            variant="primary"
            disabled={autopilotRunning}
            onClick={onTriggerAutoPilot}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "0.83rem",
              background: autopilotRunning ? "rgba(99, 102, 241, 0.4)" : undefined,
            }}
          >
            <Zap size={14} /> {autopilotRunning ? "⚡ Generating Posts…" : "Run Auto-Pilot Now"}
          </Button>
        )}
      </div>
    );
  }

  // Extract variables for the active plan
  const targetTime = new Date(currentPlan.execute_at || currentPlan.scheduled_at || currentPlan.proposed_at || 0).getTime();
  const diffMs = targetTime - now;
  const isPast = diffMs <= 0;
  const isPublished = currentPlan.publish_state === "PUBLISHED" || currentPlan.content_status === "PUBLISHED";
  const isFailed = currentPlan.publish_state === "FAILED" || currentPlan.state === "FAILED";

  // Calculate live countdown string (HH:MM:SS)
  const absDiff = Math.abs(diffMs);
  const hours = Math.floor(absDiff / (1000 * 60 * 60));
  const minutes = Math.floor((absDiff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((absDiff % (1000 * 60)) / 1000);

  const countdownText = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  // Extract visual prompt and generated image
  const variants = (currentPlan.variants || {}) as Record<string, any>;
  const firstVariantKey = Object.keys(variants)[0] || "Instagram";
  const primaryVariant = variants[firstVariantKey] || {};
  const targetPlatform = currentPlan.social_platform || currentPlan.platforms?.[0] || firstVariantKey;

  const rawMediaUrl =
    primaryVariant.mediaUrl ||
    currentPlan.source_snapshot?.mediaUrl ||
    currentPlan.media_url ||
    null;
  const resolvedImg = rawMediaUrl ? resolveMediaUrl(rawMediaUrl) : null;

  const rawHeadline =
    currentPlan.source_snapshot?.headline ||
    currentPlan.title ||
    currentPlan.source_snapshot?.key ||
    "AI Knowledge Insight";
  const headline = typeof rawHeadline === "string" ? rawHeadline : JSON.stringify(rawHeadline);

  const visualPrompt =
    currentPlan.source_snapshot?.posterPrompt ||
    primaryVariant.metadata?.posterPrompt ||
    currentPlan.source_snapshot?.visualPrompt ||
    primaryVariant.metadata?.imagePrompt ||
    currentPlan.source_snapshot?.prompt ||
    `High-definition 3D conceptual visual representing ${headline}, premium composition, dynamic rim lighting, ultra-detailed 8k render.`;

  const caption = primaryVariant.caption || currentPlan.body || headline;
  const scheduledDateStr = targetTime
    ? new Intl.DateTimeFormat("en-IN", {
        timeZone: timezone,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }).format(new Date(targetTime))
    : "Soon";

  return (
    <div
      style={{
        margin: "20px 0",
        borderRadius: "16px",
        background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 27, 75, 0.9) 100%)",
        border: "1px solid rgba(99, 102, 241, 0.4)",
        boxShadow: "0 10px 35px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(99, 102, 241, 0.2)",
        overflow: "hidden",
      }}
    >
      {/* Top Header Bar with Live Pulsing Radar */}
      <div
        style={{
          padding: "14px 20px",
          background: "rgba(0, 0, 0, 0.35)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              position: "relative",
              display: "flex",
              width: "10px",
              height: "10px",
            }}
          >
            <span
              style={{
                position: "absolute",
                display: "inline-flex",
                height: "100%",
                width: "100%",
                borderRadius: "50%",
                background: isPublished ? "#10b981" : isFailed ? "#ef4444" : "#38bdf8",
                opacity: 0.75,
                animation: "ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite",
              }}
            />
            <span
              style={{
                position: "relative",
                display: "inline-flex",
                borderRadius: "50%",
                height: "10px",
                width: "10px",
                background: isPublished ? "#10b981" : isFailed ? "#ef4444" : "#0284c7",
              }}
            />
          </span>
          <span style={{ fontSize: "0.85rem", fontWeight: 700, letterSpacing: "0.03em", color: "#f8fafc", textTransform: "uppercase" }}>
            Live Real-Time Auto-Post Monitor
          </span>
          <span
            style={{
              fontSize: "0.7rem",
              padding: "2px 8px",
              borderRadius: "6px",
              background: "rgba(99, 102, 241, 0.25)",
              color: "#a5b4fc",
              fontWeight: 600,
            }}
          >
            {targetPlatform} Post
          </span>
        </div>

        {/* Dynamic Countdown Clock */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "rgba(0, 0, 0, 0.5)",
              border: "1px solid rgba(56, 189, 248, 0.4)",
              padding: "5px 12px",
              borderRadius: "8px",
              boxShadow: "0 0 10px rgba(56, 189, 248, 0.15)",
            }}
          >
            <Clock size={15} style={{ color: "#38bdf8", animation: "spin 8s linear infinite" }} />
            <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 500 }}>
              {isPublished ? "Published at:" : isPast ? "Dispatching:" : "Time Until Live Post:"}
            </span>
            <span
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: "1rem",
                fontWeight: 800,
                color: isPublished ? "#34d399" : isPast ? "#fbbf24" : "#38bdf8",
                letterSpacing: "0.05em",
              }}
            >
              {isPublished ? "LIVE NOW" : isPast ? "POSTING NOW..." : countdownText}
            </span>
          </div>

          {onPublishNow && !isPublished && (
            <Button
              variant="primary"
              disabled={publishingId === currentPlan.id}
              onClick={async () => {
                setPublishingId(currentPlan.id);
                try {
                  await onPublishNow(currentPlan.id);
                } finally {
                  setPublishingId(null);
                }
              }}
              style={{
                fontSize: "0.75rem",
                padding: "6px 12px",
                display: "flex",
                alignItems: "center",
                gap: "5px",
                background: "linear-gradient(135deg, #059669 0%, #10b981 100%)",
              }}
            >
              <Send size={12} /> {publishingId === currentPlan.id ? "Publishing..." : "Post Now"}
            </Button>
          )}
        </div>
      </div>

      {/* Main 3-Column Pipeline Inspector */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "16px",
          padding: "18px 20px",
        }}
      >
        {/* Column 1: Generated Image / Visual Preview */}
        <div
          style={{
            background: "rgba(0, 0, 0, 0.25)",
            border: "1px solid rgba(255, 255, 255, 0.07)",
            borderRadius: "12px",
            padding: "14px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <span style={{ fontSize: "0.75rem", color: "#818cf8", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
              <ImageIcon size={14} /> STEP 3: GENERATED VISUAL
            </span>
            <span
              style={{
                fontSize: "0.68rem",
                padding: "2px 8px",
                borderRadius: "6px",
                background: "rgba(16, 185, 129, 0.15)",
                border: "1px solid rgba(16, 185, 129, 0.3)",
                color: "#34d399",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <Sparkles size={11} /> AI Visual Generated
            </span>
          </div>

          <div
            style={{
              position: "relative",
              width: "100%",
              height: "170px",
              borderRadius: "10px",
              overflow: "hidden",
              background: "#09090b",
              border: "1px solid rgba(99, 102, 241, 0.25)",
              cursor: resolvedImg ? "pointer" : "default",
              boxShadow: "0 4px 15px rgba(0,0,0,0.4)",
            }}
            onClick={() => resolvedImg && setActiveLightbox(resolvedImg)}
          >
            {resolvedImg ? (
              <>
                <img
                  src={resolvedImg}
                  alt="AI Generated Poster"
                  style={{ width: "100%", height: "100%", objectFit: "cover", transition: "transform 0.25s ease" }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.04)")}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                />
                <div
                  style={{
                    position: "absolute",
                    bottom: "6px",
                    right: "6px",
                    background: "rgba(15, 23, 42, 0.85)",
                    backdropFilter: "blur(6px)",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    color: "#f8fafc",
                    padding: "4px 8px",
                    borderRadius: "6px",
                    fontSize: "0.7rem",
                    fontWeight: 500,
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
                  }}
                >
                  <Maximize2 size={11} style={{ color: "#818cf8" }} /> Expand Preview
                </div>
              </>
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  color: "#64748b",
                  fontSize: "0.8rem",
                }}
              >
                <Sparkles size={24} style={{ color: "#6366f1" }} />
                <span>Visual will be rendered at scheduled slot</span>
              </div>
            )}
          </div>
        </div>

        {/* Column 2: AI Written Prompt & Creative Direction */}
        <div
          style={{
            background: "rgba(0, 0, 0, 0.25)",
            border: "1px solid rgba(255, 255, 255, 0.07)",
            borderRadius: "12px",
            padding: "14px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <span style={{ fontSize: "0.75rem", color: "#a855f7", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
              <Sparkles size={14} /> STEP 2: AI VISUAL PROMPT
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "0.7rem", color: "#c084fc", fontWeight: 600 }}>
                AI Script Engine
              </span>
              {onOpenVisualStudio && (
                <button
                  type="button"
                  onClick={() => onOpenVisualStudio(visualPrompt, headline)}
                  style={{
                    background: "rgba(168, 85, 247, 0.2)",
                    border: "1px solid rgba(168, 85, 247, 0.4)",
                    color: "#e9d5ff",
                    fontSize: "0.68rem",
                    fontWeight: 600,
                    padding: "3px 8px",
                    borderRadius: "6px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                  title="Generate or iterate this visual in AI Visual Studio"
                >
                  <Sparkles size={11} style={{ color: "#d8b4fe" }} /> Open in Studio
                </button>
              )}
            </div>
          </div>

          <div
            style={{
              flex: 1,
              background: "rgba(0, 0, 0, 0.35)",
              border: "1px solid rgba(168, 85, 247, 0.2)",
              borderRadius: "8px",
              padding: "10px 12px",
              fontSize: "0.78rem",
              lineHeight: 1.5,
              color: "#e2e8f0",
              overflowY: "auto",
              maxHeight: "170px",
            }}
          >
            <strong style={{ color: "#f8fafc", display: "block", marginBottom: "4px" }}>
              Headline: {headline}
            </strong>
            <p style={{ margin: 0, color: "#94a3b8", fontStyle: "italic" }}>
              &ldquo;{visualPrompt}&rdquo;
            </p>
          </div>
        </div>

        {/* Column 3: Scheduled Dispatch & Channel Status */}
        <div
          style={{
            background: "rgba(0, 0, 0, 0.25)",
            border: "1px solid rgba(255, 255, 255, 0.07)",
            borderRadius: "12px",
            padding: "14px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <span style={{ fontSize: "0.75rem", color: "#38bdf8", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
                <Clock size={14} /> STEP 4: DISPATCH SCHEDULE
              </span>
              <span
                style={{
                  fontSize: "0.7rem",
                  padding: "2px 7px",
                  borderRadius: "4px",
                  background: isPublished ? "rgba(16, 185, 129, 0.2)" : "rgba(56, 189, 248, 0.2)",
                  color: isPublished ? "#34d399" : "#38bdf8",
                  fontWeight: 700,
                }}
              >
                {isPublished ? "PUBLISHED" : "ENQUEUED"}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.8rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255, 255, 255, 0.06)", paddingBottom: "6px" }}>
                <span style={{ color: "var(--color-text-muted)" }}>Target Channel:</span>
                <strong style={{ color: "#f8fafc" }}>{targetPlatform}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid rgba(255, 255, 255, 0.06)", paddingBottom: "6px" }}>
                <span style={{ color: "var(--color-text-muted)" }}>Scheduled Time:</span>
                <strong style={{ color: "#38bdf8" }}>{scheduledDateStr}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--color-text-muted)" }}>Caption Snippet:</span>
                <span style={{ color: "#94a3b8", maxWidth: "160px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {caption.slice(0, 40)}...
                </span>
              </div>
            </div>
          </div>

          {/* Quick Plan Switcher if multiple plans exist */}
          {plans.length > 1 && (
            <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "6px", overflowX: "auto", paddingBottom: "4px" }}>
              <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)" }}>Queue:</span>
              {plans.slice(0, 5).map((p, idx) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelectedPlanId(p.id);
                    onSelectPlan?.(p);
                  }}
                  style={{
                    fontSize: "0.7rem",
                    padding: "3px 8px",
                    borderRadius: "4px",
                    background: (currentPlan.id === p.id) ? "rgba(99, 102, 241, 0.5)" : "rgba(255, 255, 255, 0.06)",
                    border: (currentPlan.id === p.id) ? "1px solid #818cf8" : "1px solid transparent",
                    color: "#f8fafc",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Post #{idx + 1}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox Modal with Prompt & Visual Details */}
      {activeLightbox && (
        <div
          onClick={() => setActiveLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            background: "rgba(0, 0, 0, 0.88)",
            backdropFilter: "blur(10px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "relative",
              maxWidth: "880px",
              width: "100%",
              maxHeight: "90vh",
              background: "linear-gradient(145deg, #0f172a 0%, #1e1b4b 100%)",
              border: "1px solid rgba(99, 102, 241, 0.4)",
              borderRadius: "18px",
              boxShadow: "0 25px 60px rgba(0,0,0,0.85), 0 0 30px rgba(99,102,241,0.25)",
              display: "flex",
              flexDirection: "row",
              overflow: "hidden",
              flexWrap: "wrap",
            }}
          >
            {/* Left Image View */}
            <div
              style={{
                flex: "1 1 380px",
                minWidth: "300px",
                background: "#000",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "16px",
              }}
            >
              <img
                src={activeLightbox}
                alt="AI Generated Visual Full"
                style={{
                  maxWidth: "100%",
                  maxHeight: "75vh",
                  borderRadius: "12px",
                  objectFit: "contain",
                  boxShadow: "0 10px 30px rgba(0,0,0,0.7)",
                }}
              />
            </div>

            {/* Right Information Panel */}
            <div
              style={{
                flex: "1 1 320px",
                padding: "24px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: "16px",
                background: "rgba(15, 23, 42, 0.6)",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                  <span
                    style={{
                      fontSize: "0.72rem",
                      padding: "3px 10px",
                      borderRadius: "6px",
                      background: "rgba(99, 102, 241, 0.2)",
                      border: "1px solid rgba(99, 102, 241, 0.4)",
                      color: "#a5b4fc",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    AI Generated Visual Inspector
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveLightbox(null)}
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      border: "none",
                      color: "#94a3b8",
                      borderRadius: "50%",
                      width: "30px",
                      height: "30px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>

                <h3 style={{ margin: "0 0 10px", fontSize: "1.1rem", color: "#f8fafc", fontWeight: 700 }}>
                  {headline}
                </h3>

                <div
                  style={{
                    background: "rgba(0, 0, 0, 0.4)",
                    border: "1px solid rgba(168, 85, 247, 0.25)",
                    borderRadius: "10px",
                    padding: "12px 14px",
                    marginBottom: "16px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.7rem",
                      color: "#c084fc",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                      marginBottom: "6px",
                    }}
                  >
                    <Sparkles size={12} /> Prompt Used by AI Generator:
                  </span>
                  <p style={{ margin: 0, fontSize: "0.82rem", lineHeight: 1.5, color: "#e2e8f0", fontStyle: "italic" }}>
                    &ldquo;{visualPrompt}&rdquo;
                  </p>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "0.82rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--color-text-muted)" }}>Aspect Ratio:</span>
                    <strong style={{ color: "#f8fafc" }}>1:1 Square (Feed-Ready)</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--color-text-muted)" }}>Target Platform:</span>
                    <strong style={{ color: "#38bdf8" }}>{targetPlatform}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--color-text-muted)" }}>Scheduled Slot:</span>
                    <strong style={{ color: "#34d399" }}>{scheduledDateStr}</strong>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <a
                  href={activeLightbox}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    flex: 1,
                    textAlign: "center",
                    textDecoration: "none",
                    padding: "9px 12px",
                    borderRadius: "8px",
                    background: "rgba(255, 255, 255, 0.08)",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    color: "#f8fafc",
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  <ExternalLink size={14} /> Open Full Size
                </a>
                <button
                  type="button"
                  onClick={() => setActiveLightbox(null)}
                  style={{
                    padding: "9px 16px",
                    borderRadius: "8px",
                    background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                    border: "none",
                    color: "#fff",
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
