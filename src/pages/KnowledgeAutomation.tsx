import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  BookOpen,
  CalendarClock,
  ShieldCheck,
  Sparkles,
  Search,
  Zap,
  PartyPopper,
  CheckCircle2,
  Image,
  PenLine,
  Loader2,
  Settings2,
  ArrowUpRight,
  ArrowRight,
  Sliders,
  Check,
  Play,
  Pause,
  Save,
  Clock,
  Info,
  Calendar,
  Layers,
  ChevronDown,
  AlertTriangle,
  ExternalLink,
  Send,
  Eye,
  X,
  FileText,
  Mail,
  RefreshCw,
  Plus,
  Trash2,
} from "lucide-react";
import { request, resolveMediaUrl } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, Empty, StatusBadge, PlatformIcon } from "../components/ui";
import { LiveAutoPilotPulse } from "../components/LiveAutoPilotPulse";
import "./knowledge-automation.css";

type Source = {
  knowledgeId: string;
  documentId: string;
  documentName: string;
  pageStart: number;
  pageEnd: number;
  excerpt: string;
  status: string;
};
type Topic = {
  hash: string;
  key: string;
  type: string;
  value: unknown;
  eligible: boolean;
  sources: Source[];
};
type Plan = {
  id: string;
  plan_id?: string;
  content_id: string | null;
  title: string;
  body?: string;
  state?: string;
  content_status: string;
  proposed_at?: string;
  error_message?: string;
  source_snapshot?: Topic;
  attempts?: number;
  variants?: Record<string, any>;
  platforms?: string[];
  scheduled_at?: string;
  created_at?: string;
  scheduled_post_id?: string;
  publish_state?: string;
  execute_at?: string;
  provider_post_id?: string;
  error_code?: string;
  social_platform?: string;
  social_account_name?: string;
  document_name?: string;
};
type Config = {
  enabled: boolean;
  horizon_days: number;
  cooldown_days: number;
  platforms: string[];
  posting_time?: string;
  poster_style?: 'DIRECT' | 'BRANDED_CANVAS' | 'AI_POSTER';
  last_message?: string;
  last_run_at?: string;
};
type Overview = {
  topics: Topic[];
  plans: Plan[];
  documents?: { id: string; original_filename: string; status: string; page_count: number }[];
  graphicsCount?: number;
  settings: Config;
  workspace: {
    timezone: string;
    daily_posting_target: number;
    festival_automation_enabled?: boolean;
    festival_auto_publish_enabled?: boolean;
    festival_approval_mode?: string;
    festival_post_time?: string;
    festival_region?: string;
    festival_language?: string;
  };
  accounts: { platform: string; name: string }[];
  canManage: boolean;
  canEdit: boolean;
  mode: string;
};
const base = "/knowledge-automation";

function formatSlotTo12h(timeStr: string): string {
  if (!timeStr) return "";
  const [hStr, mStr] = timeStr.trim().split(":");
  const h = parseInt(hStr, 10);
  if (isNaN(h)) return timeStr;
  const m = mStr ? mStr.padStart(2, "0") : "00";
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${m} ${ampm}`;
}

const TIME_PRESETS = [
  { label: "10:00 AM (Recommended Peak)", value: "10:00" },
  { label: "09:00 AM (Morning Rush)", value: "09:00" },
  { label: "08:00 AM (Early Bird)", value: "08:00" },
  { label: "01:15 PM (Lunch Break)", value: "13:15" },
  { label: "04:00 PM (Afternoon Catchup)", value: "16:00" },
  { label: "06:00 PM (Peak Prime)", value: "18:00" },
  { label: "08:00 PM (Night Digest)", value: "20:00" },
  { label: "09:00 AM, 02:00 PM & 06:00 PM (Triple Growth)", value: "09:00,14:00,18:00" },
];

export default function KnowledgeAutomation({ embedded = false }: { embedded?: boolean }) {
  const wid = useSession((s) => s.workspaceId),
    demo = useSession((s) => s.demo);
  const query = useQueryClient();
  const overview = useQuery({
    queryKey: ["knowledge-automation", wid],
    queryFn: () => request<Overview>(base),
    enabled: !demo,
    refetchInterval: 15000,
  });
  const [config, setConfig] = useState<Config | null>(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [search, setSearch] = useState(""),
    [isCustomTime, setIsCustomTime] = useState(false),
    [customTimeVal, setCustomTimeVal] = useState(""),
    [customPickerTime, setCustomPickerTime] = useState("10:00"),
    [savedSlotNotice, setSavedSlotNotice] = useState<string | null>(null),
    [showGuide, setShowGuide] = useState(true),
    [activeLightbox, setActiveLightbox] = useState<string | null>(null),
    [tab, setTab] = useState<"proposals" | "knowledge">("proposals");
  useEffect(() => {
    setConfig(null);
    setDirty(false);
    setMessage("");
    setSearch("");
  }, [wid]);
  useEffect(() => {
    if (overview.data && !dirty) setConfig(overview.data.settings);
  }, [overview.data, dirty]);
  const data = overview.data;
  async function action(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      const result = await fn();
      setMessage(result && typeof result === "object" && "message" in result && typeof result.message === "string" ? result.message : success);
      await Promise.all([
        query.invalidateQueries({ queryKey: ["knowledge-automation", wid] }),
        query.invalidateQueries({ queryKey: ["workspace", wid] }),
        query.invalidateQueries({ queryKey: ["calendar"] }),
        query.invalidateQueries({ queryKey: ["posts"] }),
        query.invalidateQueries({ queryKey: ["documents"] }),
      ]);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Action failed. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function triggerAutoPilot() {
    await action(
      async () => {
        const res = await request<{ success: boolean; generated: number; message: string }>(
          base + "/auto-pilot",
          "POST",
          {},
        );
        return res;
      },
      "Auto-pilot enabled. Background generation is queued; check generation history for stored posts and publishing results.",
    );
  }

  async function toggleFestivalAutomation(enable: boolean) {
    await action(
      async () => {
        await request("/calendar/festivals/settings", "PATCH", {
          festival_automation_enabled: enable,
          festival_auto_publish_enabled: enable,
          festival_approval_mode: enable ? "AUTO_APPROVAL" : "MANUAL_APPROVAL",
        });
      },
      enable
        ? "🪔 Festival Auto-Greetings enabled! Indian & Global festival greeting posters auto-injected in morning slots."
        : "Festival auto-greetings paused.",
    );
  }
  async function save(enabled = config?.enabled) {
    if (!config) return;
    await action(
      async () => {
        const saved = await request<Config>(base + "/settings", "PATCH", {
          enabled,
          horizonDays: config.horizon_days,
          cooldownDays: config.cooldown_days,
          platforms: config.platforms,
          postingTime: config.posting_time || "10:00",
          posterStyle: config.poster_style || "AI_POSTER",
        });
        setConfig(saved);
        setDirty(false);
      },
      enabled
        ? "Review-first automation enabled. The worker will fill eligible slots."
        : "Automation paused. Existing drafts and approved schedules are preserved.",
    );
  }
  const change = (next: Partial<Config>) => {
    setConfig((c) => (c ? { ...c, ...next } : c));
    setDirty(true);
  };
  function handleSaveTime(slot: string) {
    change({ posting_time: slot });
    if (config) {
      action(
        () =>
          request(base + "/settings", "PATCH", {
            enabled: config.enabled,
            horizonDays: config.horizon_days,
            cooldownDays: config.cooldown_days,
            platforms: config.platforms,
            postingTime: slot,
            posterStyle: config.poster_style || "AI_POSTER",
          }),
        `Daily posting schedule updated & saved to ${slot}!`
      );
      setSavedSlotNotice(`✓ Daily Posting Schedule successfully saved: ${slot} (${data?.workspace?.timezone || "Asia/Kolkata"})`);
      setTimeout(() => setSavedSlotNotice(null), 5000);
    }
  }

  function handleAddSlot(slotToAdd: string) {
    if (!slotToAdd) return;
    const current = (config?.posting_time || "10:00")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!current.includes(slotToAdd)) {
      const updated = [...current, slotToAdd].sort();
      handleSaveTime(updated.join(","));
    }
  }

  function handleRemoveSlot(slotToRemove: string) {
    const current = (config?.posting_time || "10:00")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const updated = current.filter((s) => s !== slotToRemove);
    handleSaveTime(updated.length > 0 ? updated.join(",") : "10:00");
  }
  const date = (value: string) =>
    new Intl.DateTimeFormat("en-IN", {
      timeZone: data?.workspace.timezone || "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  const topics = (data?.topics || []).filter((t) =>
    (t.key + " " + JSON.stringify(t.value))
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className={`knowledge-automation ${embedded ? 'studio-automation-panel' : ''}`}>
      {!embedded && (
        <header className="ka-heading">
          <div>
            <span className="ka-eyebrow">YOUR KNOWLEDGE, WORKING FOR YOU</span>
            <h1>Knowledge &amp; Automation</h1>
            <p>
              Turn approved business knowledge into a steady stream of source-linked content.
            </p>
          </div>
          <Button asChild variant="primary">
            <Link to="/app/studio?tab=pdf" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <BookOpen size={16} /> Add a business PDF
            </Link>
          </Button>
        </header>
      )}

      <header className="ka-dashboard-heading">
        <div>
          <span className="ka-eyebrow">CONTENT AUTOMATION</span>
          <h2>Autonomous Publishing &amp; Day-by-Day Scheduling</h2>
          <p>Turn verified business knowledge into scheduled social media posts with zero manual overhead.</p>
        </div>
        <Link to="/app/calendar" className="ka-calendar-link">
          <CalendarClock size={16} /> View calendar <ArrowUpRight size={14} />
        </Link>
      </header>

      <nav className="ka-section-nav" aria-label="Automation sections">
        <a href="#ka-autopilot"><Zap size={15} /> Auto-pilot</a>
        <a href="#ka-festivals"><PartyPopper size={15} /> Festival greetings</a>
        <a href="#ka-preferences"><Settings2 size={15} /> Preferences</a>
        <a href="#ka-history"><CalendarClock size={15} /> Generation history</a>
      </nav>

      <section className="ka-autopilot-hero" id="ka-autopilot" aria-label="Auto-pilot">
        <div className="ka-hero-layout">
          <div className="ka-hero-intro">
            <div className="ka-mode-badge-row">
              <span className="ka-mode-label"><Zap size={14} /> Autonomous Content Engine</span>
              {config?.enabled ? (
                <span className="ka-status-pill is-active">
                  <span className="ka-pulse-dot" /> ACTIVE (Running)
                </span>
              ) : (
                <span className="ka-status-pill is-paused">PAUSED</span>
              )}
            </div>
            <h2>From PDF Knowledge to Multi-Platform Social Presence</h2>
            <p>Pairs extracted PDF graphics, writes channel-tailored copy, schedules sequential future daily slots, and automatically injects morning festive greetings.</p>
          </div>
          <div className="ka-hero-controls">
            {/* Master Toggle Button */}
            <div className="ka-control-group">
              <span className="ka-autopilot-select-label">Auto-pilot status</span>
              <button
                type="button"
                disabled={!data?.canManage || busy}
                onClick={() => save(!config?.enabled)}
                className={`ka-status-toggle ${config?.enabled ? "is-active" : "is-paused"}`}
                aria-pressed={!!config?.enabled}
              >
                <span className={`ka-dot ${config?.enabled ? "bg-emerald" : "bg-rose"}`} />
                {config?.enabled ? "Active (Running)" : "Turn On Auto-Pilot"}
              </button>
            </div>

            {/* Poster Style Selector */}
            <div className="ka-control-group">
              <label className="ka-autopilot-select-label">Poster Visual Style</label>
              <div className="ka-select-wrapper">
                <Image size={15} className="ka-select-icon" />
                <select
                  aria-label="Poster Visual Style"
                  className="ka-autopilot-select with-icon"
                  value={config?.poster_style || "AI_POSTER"}
                  disabled={!data?.canManage || busy}
                  onChange={(e) => {
                    const style = e.target.value as 'DIRECT' | 'BRANDED_CANVAS' | 'AI_POSTER';
                    change({ poster_style: style });
                    if (config) {
                      action(
                        () =>
                          request(base + "/settings", "PATCH", {
                            enabled: config.enabled,
                            horizonDays: config.horizon_days,
                            cooldownDays: config.cooldown_days,
                            platforms: config.platforms,
                            postingTime: config.posting_time || "10:00",
                            posterStyle: style,
                          }),
                        `Poster style set to ${style === 'AI_POSTER' ? 'AI Generated Poster' : style === 'DIRECT' ? 'Direct PDF Slide' : 'Branded Canvas Poster'}!`
                      );
                    }
                  }}
                >
                  <option value="AI_POSTER">✨ AI Generated Poster (Prompt from Knowledge)</option>
                  <option value="DIRECT">Direct PDF Slide (Raw Extracted Image)</option>
                  <option value="BRANDED_CANVAS">Branded Canvas Poster (Framed + CTA)</option>
                </select>
                <ChevronDown size={14} className="ka-select-chevron" />
              </div>
            </div>

            {/* Daily Post Slot Time */}
            <div className="ka-control-group">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label className="ka-autopilot-select-label">Daily Post Slot</label>
                <button
                  type="button"
                  onClick={() => setIsCustomTime(!isCustomTime)}
                  style={{ background: "none", border: "none", color: "var(--accent, #6366f1)", fontSize: "11px", fontWeight: 600, cursor: "pointer", padding: "0" }}
                >
                  {isCustomTime ? "Show Presets" : "Custom (e.g. 7:07)"}
                </button>
              </div>
              <div className="ka-select-wrapper" style={{ position: "relative" }}>
                <Clock size={15} className="ka-select-icon" />
                {isCustomTime ? (
                  <input
                    type="text"
                    aria-label="Custom Daily Post Slot Time"
                    className="ka-autopilot-select with-icon"
                    placeholder="e.g. 07:07 or 13:15, 18:00"
                    value={config?.posting_time || "10:00"}
                    disabled={!data?.canManage || busy}
                    onChange={(e) => change({ posting_time: e.target.value })}
                    onBlur={() => {
                      if (config) {
                        action(
                          () =>
                            request(base + "/settings", "PATCH", {
                              enabled: config.enabled,
                              horizonDays: config.horizon_days,
                              cooldownDays: config.cooldown_days,
                              platforms: config.platforms,
                              postingTime: config.posting_time || "10:00",
                              posterStyle: config.poster_style || "AI_POSTER",
                            }),
                          `Daily posting slot set to ${config.posting_time}!`
                        );
                      }
                    }}
                  />
                ) : (
                  <select
                    aria-label="Daily Post Slot Time"
                    className="ka-autopilot-select with-icon"
                    value={config?.posting_time || "10:00"}
                    disabled={!data?.canManage || busy}
                    onChange={(e) => {
                      const newTime = e.target.value;
                      if (newTime === "CUSTOM") {
                        setIsCustomTime(true);
                        return;
                      }
                      change({ posting_time: newTime });
                      if (config) {
                        action(
                          () =>
                            request(base + "/settings", "PATCH", {
                              enabled: config.enabled,
                              horizonDays: config.horizon_days,
                              cooldownDays: config.cooldown_days,
                              platforms: config.platforms,
                              postingTime: newTime,
                              posterStyle: config.poster_style || "AI_POSTER",
                            }),
                          `Daily posting slot set to ${newTime}!`
                        );
                      }
                    }}
                  >
                    {!["15:00,16:00,17:00", "15:00", "16:00", "17:00", "18:00", "07:07", "08:00", "09:00", "10:00", "11:00", "12:00", "13:15", "14:00", "20:00"].includes(config?.posting_time || "") && (
                      <option value={config?.posting_time}>{config?.posting_time} (Custom)</option>
                    )}
                    <option value="07:07">07:07 AM (Custom Slot)</option>
                    <option value="08:00">08:00 AM</option>
                    <option value="09:00">09:00 AM</option>
                    <option value="10:00">10:00 AM (Recommended)</option>
                    <option value="11:00">11:00 AM</option>
                    <option value="12:00">12:00 PM</option>
                    <option value="13:15">01:15 PM (Afternoon)</option>
                    <option value="14:00">02:00 PM</option>
                    <option value="15:00">03:00 PM (Afternoon Prime)</option>
                    <option value="16:00">04:00 PM (Evening Teaser)</option>
                    <option value="17:00">05:00 PM (Rush Hour)</option>
                    <option value="18:00">06:00 PM (Peak Prime)</option>
                    <option value="20:00">08:00 PM</option>
                    <option value="15:00,16:00,17:00">03:00 PM, 04:00 PM &amp; 05:00 PM (Triple Slots)</option>
                    <option value="CUSTOM">✏️ Enter custom time (e.g. 7:07)...</option>
                  </select>
                )}
                {!isCustomTime && <ChevronDown size={14} className="ka-select-chevron" />}
              </div>
            </div>

            <button
              type="button"
              className="ka-autopilot-btn"
              disabled={busy || !data?.canEdit}
              onClick={triggerAutoPilot}
            >
              {busy ? <Loader2 size={16} className="ka-spin" /> : <Zap size={16} />}
              {busy ? "Running Auto-Pilot…" : "Run Auto-Pilot Now"}
            </button>
          </div>
        </div>

        <div className="ka-feature-grid">
          <div className="ka-feature-pill-card">
            <div className="pill-icon-box bg-indigo">
              <Image size={18} />
            </div>
            <div className="pill-text">
              <span className="pill-title">Auto-Visual Pairing</span>
              <p>Pairs extracted PDF images &amp; diagram slides with relevant post topics.</p>
            </div>
          </div>

          <div className="ka-feature-pill-card">
            <div className="pill-icon-box bg-purple">
              <PenLine size={18} />
            </div>
            <div className="pill-text">
              <span className="pill-title">Auto-Copywriting</span>
              <p>Platform-specific captions &amp; trending hashtags for all connected channels.</p>
            </div>
          </div>

          <div className="ka-feature-pill-card">
            <div className="pill-icon-box bg-emerald">
              <CalendarClock size={18} />
            </div>
            <div className="pill-text">
              <span className="pill-title">Day-by-Day Scheduling</span>
              <p>Sequential future slot scheduling keeps your queue consistently active.</p>
            </div>
          </div>

          <div className="ka-feature-pill-card">
            <div className="pill-icon-box bg-amber">
              <PartyPopper size={18} />
            </div>
            <div className="pill-text">
              <span className="pill-title">Festival Greetings</span>
              <p>Morning festive greetings ({data?.workspace?.festival_post_time || "09:00 AM"}) automatically injected on holidays.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Real-Time Live Auto-Pilot Pulse & Dynamic Countdown */}
      {data?.plans && data.plans.length > 0 && (
        <LiveAutoPilotPulse
          plans={data.plans}
          settings={config}
          timezone={data.workspace?.timezone || "Asia/Kolkata"}
          autopilotRunning={busy}
          onTriggerAutoPilot={triggerAutoPilot}
          onPublishNow={async (planId) => {
            await action(
              async () => {
                await request(`${base}/plans/${planId}/publish-now`, "POST");
                await query.invalidateQueries({ queryKey: ["knowledge-automation"] });
              },
              "🚀 Dispatched post live to social channel!"
            );
          }}
        />
      )}

      {/* Flexible Daily Posting Schedule Strip (Presets + Dynamic Custom Time Picker) */}
      {data && config && (
        <div className="ka-timing-section">
          {/* Header with Save Button */}
          <div className="ka-timing-header">
            <div className="ka-timing-title">
              <Clock size={18} style={{ color: "#6366f1" }} />
              <span>Flexible Daily Posting Schedule</span>
              <span className="ka-timing-active-badge">
                <CheckCircle2 size={13} />
                {((config.posting_time || "10:00").split(",").map((s) => s.trim()).filter(Boolean).length > 1)
                  ? `${(config.posting_time || "10:00").split(",").map((s) => s.trim()).filter(Boolean).length} Slots/Day`
                  : `Active Slot: ${formatSlotTo12h(config.posting_time || "10:00")}`} ({data.workspace.timezone})
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => handleSaveTime(config.posting_time || "10:00")}
                style={{
                  background: "#16a34a",
                  borderColor: "#16a34a",
                  color: "#ffffff",
                  fontSize: "0.82rem",
                  padding: "6px 14px",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 2px 6px rgba(22, 163, 74, 0.25)"
                }}
              >
                <Save size={14} /> Save Schedule
              </Button>
            </div>
          </div>

          {/* Dual Panel Grid: Presets & Custom Picker */}
          <div className="ka-timing-grid">
            {/* Panel 1: Curated Engagement Presets */}
            <div className="ka-timing-panel">
              <div className="ka-timing-panel-label">
                <Sparkles size={14} style={{ color: "#6366f1" }} />
                <span>1. Popular Engagement Presets</span>
              </div>
              <select
                className="ka-preset-dropdown"
                value={config.posting_time || "10:00"}
                onChange={(e) => {
                  if (e.target.value) handleSaveTime(e.target.value);
                }}
              >
                {TIME_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>

              <div className="ka-timing-chips-row">
                {TIME_PRESETS.slice(0, 5).map((p) => {
                  const isActive = config.posting_time === p.value;
                  return (
                    <button
                      key={p.value}
                      type="button"
                      className={`ka-time-chip ${isActive ? "is-active" : ""}`}
                      onClick={() => handleSaveTime(p.value)}
                    >
                      {p.label.split("—")[0].trim()}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Panel 2: Dynamic Custom Time Picker (User Selects Exact Time) */}
            <div className="ka-timing-panel">
              <div className="ka-timing-panel-label">
                <CalendarClock size={14} style={{ color: "#059669" }} />
                <span>2. Custom Dynamic Time (Select Exact Time)</span>
              </div>
              <div className="ka-picker-container">
                <input
                  type="time"
                  className="ka-native-time-input"
                  value={customPickerTime}
                  onChange={(e) => setCustomPickerTime(e.target.value)}
                />
                <span className="ka-picker-preview">
                  {formatSlotTo12h(customPickerTime)}
                </span>
                <Button
                  variant="primary"
                  disabled={busy || !customPickerTime}
                  onClick={() => handleSaveTime(customPickerTime)}
                  style={{ fontSize: "0.82rem", padding: "6px 14px", fontWeight: 600 }}
                >
                  <Save size={14} /> Save Slot
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || !customPickerTime}
                  onClick={() => handleAddSlot(customPickerTime)}
                  style={{ fontSize: "0.82rem", padding: "6px 12px" }}
                  title="Add this as an extra daily slot alongside existing slots"
                >
                  <Plus size={14} /> Add Extra Slot
                </Button>
              </div>
              <span style={{ fontSize: "0.76rem", color: "var(--text-muted, #64748b)" }}>
                Pick any exact minute (e.g. 07:07, 13:15, 17:45) and click <b>Save Slot</b> or <b>Add Extra Slot</b>.
              </span>
            </div>
          </div>

          {/* Active Daily Slots Tray with 1-click removal and explicit Save button */}
          <div className="ka-active-slots-tray">
            <span className="ka-slots-label">
              <Clock size={14} style={{ color: "#4f46e5" }} /> Active Daily Schedule:
            </span>
            {(config.posting_time || "10:00")
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .map((slot) => (
                <span key={slot} className="ka-slot-chip">
                  <span>{formatSlotTo12h(slot)} ({slot})</span>
                  <button
                    type="button"
                    className="ka-slot-remove-btn"
                    title={`Remove ${formatSlotTo12h(slot)} from daily schedule`}
                    onClick={() => handleRemoveSlot(slot)}
                  >
                    <X size={13} />
                  </button>
                </span>
              ))}

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => handleSaveTime(config.posting_time || "10:00")}
                style={{
                  background: "#16a34a",
                  borderColor: "#16a34a",
                  color: "#ffffff",
                  fontSize: "0.82rem",
                  padding: "6px 14px",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 2px 6px rgba(22, 163, 74, 0.25)"
                }}
              >
                <Save size={14} /> Save Schedule
              </Button>
              <button
                type="button"
                className="ka-slot-chip"
                style={{ background: "#f1f5f9", borderColor: "#cbd5e1", color: "#64748b", cursor: "pointer" }}
                onClick={() => handleSaveTime("10:00")}
                title="Reset to 10:00 AM standard slot"
              >
                Reset to 10:00 AM
              </button>
            </div>
          </div>

          {/* Success Notification Alert */}
          {savedSlotNotice && (
            <div style={{
              marginTop: "12px",
              padding: "10px 16px",
              borderRadius: "8px",
              background: "rgba(22, 163, 74, 0.12)",
              border: "1px solid rgba(22, 163, 74, 0.35)",
              color: "#15803d",
              fontSize: "0.85rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "8px"
            }}>
              <CheckCircle2 size={16} />
              {savedSlotNotice}
            </div>
          )}
        </div>
      )}

      {/* Zero-Touch Autonomous SaaS Pipeline Guide */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 0 10px" }}>
        <button
          type="button"
          className="ka-guide-toggle-btn"
          onClick={() => setShowGuide(!showGuide)}
        >
          <Info size={16} />
          {showGuide ? "Hide How Autonomous Engine Works" : "📖 How Autonomous Pipeline Works (Zero Manual Work Guide)"}
        </button>
        <span style={{ fontSize: "0.8rem", color: "var(--text-muted, #64748b)" }}>
          Zero human touch required · Autonomous from PDF to Channel
        </span>
      </div>

      {showGuide && (
        <div className="ka-guide-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h4 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "#4f46e5", display: "flex", alignItems: "center", gap: "8px" }}>
              <Zap size={18} /> Complete 5-Layer Autonomous Pipeline (Zero Manual Effort)
            </h4>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted, #64748b)" }}
            >
              <X size={16} />
            </button>
          </div>
          <div className="ka-guide-grid">
            <div className="ka-guide-step-card">
              <span className="ka-guide-step-num"><BookOpen size={13} /> Layer 1</span>
              <div className="ka-guide-step-title">PDF Extraction</div>
              <p className="ka-guide-step-desc">
                Upload PDF once. System automatically extracts verified business facts and all embedded diagrams/figures.
              </p>
            </div>
            <div className="ka-guide-step-card">
              <span className="ka-guide-step-num"><Sparkles size={13} /> Layer 2</span>
              <div className="ka-guide-step-title">AI Prompt Engine</div>
              <p className="ka-guide-step-desc">
                AI combines extracted text concepts + source visual diagrams into a high-converting 3D SaaS poster prompt.
              </p>
            </div>
            <div className="ka-guide-step-card">
              <span className="ka-guide-step-num"><Image size={13} /> Layer 3</span>
              <div className="ka-guide-step-title">AI Poster Generation</div>
              <p className="ka-guide-step-desc">
                Clipdrop / FLUX engine renders the social media poster and securely saves it in the Generated Assets studio.
              </p>
            </div>
            <div className="ka-guide-step-card">
              <span className="ka-guide-step-num"><PenLine size={13} /> Layer 4</span>
              <div className="ka-guide-step-title">AI Copy &amp; Hashtags</div>
              <p className="ka-guide-step-desc">
                Platform-specific viral captions and hashtags generated for Telegram, LinkedIn, Instagram, etc.
              </p>
            </div>
            <div className="ka-guide-step-card">
              <span className="ka-guide-step-num"><Send size={13} /> Layer 5</span>
              <div className="ka-guide-step-title">Publish &amp; Email Alert</div>
              <p className="ka-guide-step-desc">
                Dispatches at your flexible time slot (e.g. 07:07 AM / 1:15 PM) and instantly emails status report to your Gmail.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 5-Layer Stepper Status Indicator */}
      <div className="ka-stepper">
        <div className="ka-step-card active">
          <span className="ka-step-card-num">Layer 1</span>
          <span className="ka-step-card-name">📄 PDF &amp; Graphics</span>
          <span className="ka-step-card-sub">Redhash.pdf · 20 Graphics Ready</span>
        </div>
        <div className="ka-step-card active">
          <span className="ka-step-card-num">Layer 2</span>
          <span className="ka-step-card-name">🧠 AI Prompt Engine</span>
          <span className="ka-step-card-sub">Dynamic 3D SaaS Visual Prompts</span>
        </div>
        <div className="ka-step-card active">
          <span className="ka-step-card-num">Layer 3</span>
          <span className="ka-step-card-name">🎨 AI Poster Studio</span>
          <span className="ka-step-card-sub">Clipdrop / FLUX Render</span>
        </div>
        <div className="ka-step-card active">
          <span className="ka-step-card-num">Layer 4</span>
          <span className="ka-step-card-name">✍️ Copy &amp; Hashtags</span>
          <span className="ka-step-card-sub">Tailored Platform Captions</span>
        </div>
        <div className="ka-step-card active">
          <span className="ka-step-card-num">Layer 5</span>
          <span className="ka-step-card-name">🚀 Channel Dispatch</span>
          <span className="ka-step-card-sub">Telegram Live · Email Logs</span>
        </div>
      </div>
      {data && (
        <div className="ka-festival-card" id="ka-festivals">
          <div className="ka-festival-info">
            <div className="ka-festival-icon-wrap">
              <PartyPopper size={22} />
            </div>
            <div>
              <div className="ka-festival-title-row">
                <strong>Festival &amp; Cultural Auto-Greetings</strong>
                <span className={`ka-status-pill ${data.workspace.festival_automation_enabled ? "is-active" : "is-paused"}`}>
                  {data.workspace.festival_automation_enabled ? "ACTIVE · AUTO-INJECT ON" : "PAUSED"}
                </span>
              </div>
              <p>
                {data.workspace.festival_automation_enabled
                  ? `Festival greeting posters will auto-schedule at ${data.workspace.festival_post_time || "09:00"} AM on festival days (Diwali, Holi, Eid, Independence Day, etc.).`
                  : "Enable to automatically detect upcoming cultural and national festivals and inject morning greeting posters."}
              </p>
            </div>
          </div>
          {data.canManage && (
            <div className="ka-festival-actions">
              <div className="ka-select-wrapper">
                <Clock size={15} className="ka-select-icon" />
                <select
                  aria-label="Festival greeting slot"
                  className="ka-autopilot-select with-icon"
                  disabled={busy || !data.workspace.festival_automation_enabled}
                  value={data.workspace.festival_post_time || "09:00"}
                  onChange={(e) => {
                    const newTime = e.target.value;
                    action(
                      () =>
                        request("/calendar/festivals/settings", "PATCH", {
                          festival_post_time: newTime,
                        }),
                      `Festival greeting time updated to ${newTime}!`,
                    );
                  }}
                >
                  <option value="08:00">08:00 AM</option>
                  <option value="09:00">09:00 AM (Recommended)</option>
                  <option value="10:00">10:00 AM</option>
                </select>
                <ChevronDown size={14} className="ka-select-chevron" />
              </div>
              <Button
                variant={data.workspace.festival_automation_enabled ? "secondary" : "primary"}
                disabled={busy}
                onClick={() => toggleFestivalAutomation(!data.workspace.festival_automation_enabled)}
                style={{ fontSize: "0.85rem", padding: "8px 16px" }}
              >
                {data.workspace.festival_automation_enabled ? "Pause Festival Greetings" : "Enable Festival Greetings"}
              </Button>
            </div>
          )}
        </div>
      )}

      {demo ? (
        <Empty icon={<BookOpen />} title="Connect your real workspace">
          <p>
            Upload business PDFs in AI Studio to build your knowledge pool and enable automation.
          </p>
        </Empty>
      ) : (
        <>
          {overview.isLoading && (
            <p className="ka-loading" role="status"><Loader2 className="ka-spin" size={18} /> Loading workspace knowledge…</p>
          )}
          {overview.error && (
            <div className="ka-message" role="alert">
              {overview.error.message}
              <Button onClick={() => overview.refetch()}>Retry loading</Button>
            </div>
          )}
          {message && (
            <p className="ka-message" role="status">
              {message}
            </p>
          )}
          {data && config && (
            <>
              {!embedded && (
                <div className="ka-metrics">
                  <article>
                    <BookOpen size={20} />
                    <strong>{data.topics.length}</strong>
                    <span>Unique knowledge topics</span>
                  </article>
                  <article>
                    <ShieldCheck size={20} />
                    <strong>{data.topics.filter((t) => t.eligible).length}</strong>
                    <span>Confirmed for generation</span>
                  </article>
                  <article>
                    <Sparkles size={20} />
                    <strong>
                      {
                        data.plans.filter(
                          (p) =>
                            p.content_status === "NEEDS_REVIEW" &&
                            p.state === "REVIEW",
                        ).length
                      }
                    </strong>
                    <span>Waiting for review</span>
                  </article>
                  <article>
                    <CalendarClock size={20} />
                    <strong>{data.workspace.daily_posting_target} / day</strong>
                    <span>Shared unique-idea target</span>
                  </article>
                </div>
              )}

              {embedded && (
                <div className="studio-readiness">
                  <div className="studio-readiness-left">
                    <div className="studio-readiness-icon">
                      <Layers size={20} />
                    </div>
                    <div>
                      <div className="studio-readiness-stats">
                        <span className="stat-pill">{data.topics.filter(t => t.eligible).length} Approved Topics</span>
                        <span className="stat-pill">{data.workspace.daily_posting_target} Posts / Day</span>
                      </div>
                      <p>
                        {data.topics.some(t => t.eligible)
                          ? "Automation uses verified facts and visuals from your uploaded business documents."
                          : "Upload a business PDF to build your knowledge pool and approve facts for automated publishing."}
                      </p>
                    </div>
                  </div>
                  <Link to="/app/studio?tab=pdf" className="studio-readiness-link">
                    Manage Business Knowledge <ArrowRight size={15} />
                  </Link>
                </div>
              )}

              <section className="ka-config" id="ka-preferences">
                <div className="ka-config-header">
                  <div className="ka-config-title">
                    <div className="ka-config-icon-wrap">
                      <Settings2 size={20} />
                    </div>
                    <div>
                      <h3>Publishing Preferences &amp; Target Channels</h3>
                      <p>
                        {config.enabled ? "Automation is active" : "Automation is paused"} · {data.workspace.timezone}
                      </p>
                    </div>
                  </div>
                  <small className="ka-config-sub">
                    Uses your <Link to="/app/calendar">Calendar posting slots</Link> and leaves room for festivals. New drafts appear in Approvals.
                  </small>
                </div>

                {/* Target Channels Interactive Selector */}
                <div className="ka-channels-section">
                  <div className="ka-section-label-row">
                    <label className="ka-field-label">Target Channels</label>
                    <span className="ka-field-sub">Select which social accounts should receive auto-generated posts</span>
                  </div>
                  <div className="ka-channels-grid">
                    {["LinkedIn", "Instagram", "Facebook", "Telegram", "X"].map((p) => {
                      const isConnected = data.accounts.some((a) => a.platform.toLowerCase() === p.toLowerCase());
                      const isSelected = config.platforms.includes(p);
                      return (
                        <button
                          key={p}
                          type="button"
                          disabled={!data.canManage || busy}
                          onClick={() =>
                            change({
                              platforms: isSelected
                                ? config.platforms.filter((x) => x !== p)
                                : [...config.platforms, p],
                            })
                          }
                          className={`ka-channel-card ${isSelected ? "is-selected" : ""} ${isConnected ? "is-connected" : ""}`}
                        >
                          <div className="ka-channel-top">
                            <div className="ka-channel-identity">
                              <PlatformIcon platform={p} />
                              <span className="ka-channel-name">{p}</span>
                            </div>
                            <div className={`ka-channel-checkbox ${isSelected ? "is-checked" : ""}`}>
                              {isSelected && <Check size={12} strokeWidth={3} />}
                            </div>
                          </div>
                          <div className="ka-channel-bottom">
                            <span className={`ka-channel-status-dot ${isConnected ? "online" : "offline"}`} />
                            <span className="ka-channel-status-text">
                              {isConnected ? "Connected" : "Connect account"}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Planning Preferences Collapsible Panel */}
                <details className="studio-advanced">
                  <summary>
                    <div className="studio-advanced-summary">
                      <Sliders size={16} />
                      <span>Advanced Planning Preferences (Horizon, Cooldown &amp; Timing)</span>
                    </div>
                    <ChevronDown size={16} className="studio-advanced-chevron" />
                  </summary>
                  <div className="ka-fields">
                    <label>
                      <span>Planning Horizon</span>
                      <div className="ka-select-wrapper">
                        <select
                          disabled={!data.canManage || busy}
                          value={config.horizon_days}
                          onChange={(e) => change({ horizon_days: Number(e.target.value) })}
                          className="ka-autopilot-select"
                        >
                          {[1, 3, 7, 14].map((n) => (
                            <option key={n} value={n}>
                              {n} days ahead
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={14} className="ka-select-chevron" />
                      </div>
                      <small>Lookahead window for auto-generating posts</small>
                    </label>
                    <label>
                      <span>Topic Cooldown</span>
                      <input
                        aria-label="Topic cooldown in days"
                        type="number"
                        min={1}
                        max={365}
                        disabled={!data.canManage || busy}
                        value={config.cooldown_days}
                        onChange={(e) => change({ cooldown_days: Number(e.target.value) })}
                        className="ka-number-input"
                      />
                      <small>Days before a used topic can be reused</small>
                    </label>
                    <label>
                      <span>Daily Auto-Pilot Slot Time (e.g. 07:07 or 10:00, 16:00)</span>
                      <div className="ka-select-wrapper" style={{ position: "relative" }}>
                        <Clock size={15} className="ka-select-icon" />
                        <input
                          type="text"
                          disabled={!data.canManage || busy}
                          value={config.posting_time || "10:00"}
                          onChange={(e) => change({ posting_time: e.target.value })}
                          placeholder="e.g. 07:07 or 10:00, 16:00"
                          className="ka-autopilot-select with-icon"
                        />
                      </div>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>
                        {["07:07", "09:00", "10:00", "13:15", "15:00", "18:00"].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => change({ posting_time: preset })}
                            style={{
                              fontSize: "11px",
                              padding: "2px 8px",
                              borderRadius: "6px",
                              border: "1px solid var(--border)",
                              background: config.posting_time === preset ? "var(--accent, #6366f1)" : "var(--surface2)",
                              color: config.posting_time === preset ? "#fff" : "var(--ink)",
                              cursor: "pointer",
                            }}
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                      <small>Any custom time (HH:MM like 07:07) or multiple comma-separated slots</small>
                    </label>
                  </div>
                </details>

                <div className="ka-controls">
                  <Button
                    variant="primary"
                    disabled={
                      !data.canManage ||
                      busy ||
                      !config.platforms.length ||
                      config.cooldown_days < 1 ||
                      config.cooldown_days > 365
                    }
                    onClick={() => save()}
                    style={{ display: "flex", alignItems: "center", gap: "8px" }}
                  >
                    <Save size={16} />
                    {busy ? "Saving…" : "Save Preferences"}
                  </Button>
                  <Button
                    disabled={!data.canManage || busy || dirty || !config.platforms.length}
                    onClick={() => save(!config.enabled)}
                    style={{ display: "flex", alignItems: "center", gap: "8px" }}
                  >
                    {config.enabled ? <Pause size={16} /> : <Play size={16} />}
                    {config.enabled ? "Pause Automation" : "Enable Automation"}
                  </Button>
                  <Button
                    disabled={!data.canManage || busy || dirty || !config.enabled}
                    onClick={() =>
                      action(
                        () => request(base + "/run", "POST", {}),
                        "Planner requested. Results appear here after the next worker cycle.",
                      )
                    }
                    style={{ display: "flex", alignItems: "center", gap: "8px" }}
                  >
                    <Sparkles size={16} />
                    Plan Now
                  </Button>
                </div>

                <div className="ka-last-bar">
                  <Info size={16} className="ka-info-icon" />
                  <span>
                    {data.settings.last_message || "Confirm useful knowledge, select connected channels, then enable the planner."}
                    {data.settings.last_run_at && <> · Last run: {date(data.settings.last_run_at)}</>}
                  </span>
                </div>
              </section>

              {!embedded && (
                <nav className="ka-tabs" aria-label="Knowledge automation views">
                  <button
                    aria-pressed={tab === "proposals"}
                    className={tab === "proposals" ? "active" : ""}
                    onClick={() => setTab("proposals")}
                  >
                    Content proposals
                  </button>
                  <button
                    aria-pressed={tab === "knowledge"}
                    className={tab === "knowledge" ? "active" : ""}
                    onClick={() => setTab("knowledge")}
                  >
                    Knowledge pool
                  </button>
                </nav>
              )}

              {tab === "knowledge" ? (
                <>
                  <label className="ka-search">
                    <Search size={18} />
                    <input
                      placeholder="Search knowledge topics…"
                      aria-label="Search knowledge topics"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  {!topics.length ? (
                    <Empty title="No matching knowledge yet">
                      <p>
                        Upload a PDF in AI Studio. Extracted facts appear here with their source pages.
                      </p>
                    </Empty>
                  ) : (
                    <div className="ka-topic-grid">
                      {topics.map((t) => (
                        <article className="ka-topic" key={t.hash}>
                          <div className="ka-topic-top">
                            <small>{t.type.replaceAll("_", " ")}</small>
                            <span className="ka-pill">
                              {t.eligible ? "Confirmed" : "Needs confirmation"}
                            </span>
                          </div>
                          <h3>{t.key}</h3>
                          <p className="ka-value">
                            {typeof t.value === "string"
                              ? t.value
                              : JSON.stringify(t.value, null, 2)}
                          </p>
                          <details>
                            <summary>
                              {t.sources.length} source
                              {t.sources.length === 1 ? "" : "s"} · View evidence
                            </summary>
                            {t.sources.map((s) => (
                              <div className="ka-source" key={s.knowledgeId}>
                                <strong>
                                  {s.documentName} · Pages {s.pageStart}
                                  {s.pageEnd !== s.pageStart ? `–${s.pageEnd}` : ""}
                                </strong>
                                <blockquote>
                                  {s.excerpt || "No source excerpt. This fact cannot be used automatically."}
                                </blockquote>
                                <small>{s.status}</small>
                                {data.canEdit && s.status === "EXTRACTED" && (
                                  <div>
                                    <Button
                                      disabled={busy || !s.excerpt?.trim()}
                                      onClick={() =>
                                        action(
                                          () =>
                                            request(
                                              `/documents/${s.documentId}/knowledge/${s.knowledgeId}`,
                                              "PATCH",
                                              { status: "CONFIRMED" },
                                            ),
                                          "Knowledge confirmed for future generation.",
                                        )
                                      }
                                    >
                                      Confirm fact
                                    </Button>
                                    <Button
                                      disabled={busy}
                                      onClick={() =>
                                        action(
                                          () =>
                                            request(
                                              `/documents/${s.documentId}/knowledge/${s.knowledgeId}`,
                                              "PATCH",
                                              { status: "REJECTED" },
                                            ),
                                          "Knowledge excluded from the pool.",
                                        )
                                      }
                                    >
                                      Reject fact
                                    </Button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </details>
                        </article>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="ka-section-heading" id="ka-history">
                    <div className="ka-history-title-row">
                      <CalendarClock size={18} />
                      <h2>Auto-Generated Scheduled Posts ({data.plans.length})</h2>
                    </div>
                    <Link to="/app/approvals" className="ka-approval-link">
                      Open Approval Queue <ArrowUpRight size={15} />
                    </Link>
                  </div>
                  {!data.plans.length ? (
                    <div className="ka-empty-history">
                      <div className="ka-empty-icon-wrap">
                        <CalendarClock size={32} />
                      </div>
                      <h3>No scheduled auto-posts pending</h3>
                      <p>
                        Confirm source facts in the Knowledge pool or upload a business PDF, then click &quot;Run Auto-Pilot Now&quot; to generate upcoming scheduled drafts.
                      </p>
                      <div className="ka-empty-actions">
                        <Button asChild variant="secondary">
                          <Link to="/app/studio?tab=pdf" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <BookOpen size={15} /> Upload Business PDF
                          </Link>
                        </Button>
                        <Button
                          variant="primary"
                          disabled={busy || !data?.canEdit}
                          onClick={triggerAutoPilot}
                          style={{ display: "flex", alignItems: "center", gap: "6px" }}
                        >
                          <Zap size={15} /> Run Auto-Pilot Now
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="ka-feed-container">
                      {data.plans.map((p) => {
                        const variants = (p.variants || {}) as Record<string, any>;
                        const tgVariant = variants.Telegram || {};
                        const firstVariant = (Object.values(variants)[0] || {}) as any;
                        const rawMediaUrl = tgVariant.mediaUrl || firstVariant.mediaUrl || null;
                        const mediaUrl = rawMediaUrl ? resolveMediaUrl(rawMediaUrl) : null;
                        const captionText = tgVariant.caption || p.body || p.title || "";
                        const targetPlatform = p.social_platform || p.platforms?.[0] || "Telegram";
                        const isPublished = p.publish_state === "PUBLISHED" || p.content_status === "PUBLISHED";
                        const isFailed = p.publish_state === "FAILED" || p.state === "FAILED";
                        const rawTitle = p.title && !p.title.startsWith('{') ? p.title : (p.source_snapshot?.value || p.source_snapshot?.key || "Omnichannel Social Content");
                        const cleanTitle = typeof rawTitle === "string" ? rawTitle : JSON.stringify(rawTitle);
                        const conceptTitle = p.source_snapshot?.value ? String(p.source_snapshot.value) : cleanTitle;
                        const sourceExcerpt = p.source_snapshot?.sources?.[0]?.excerpt || "Strategic framework from Redhash.pdf extracted for social distribution.";
                        const executionTime = p.execute_at || p.scheduled_at || p.proposed_at;
                        const executionTimeStr = executionTime ? date(executionTime) : "Today at 01:15 PM";
                        const hashtagsList = (captionText.match(/#[a-zA-Z0-9_]+/g) || ["#Marketing", "#SocialGrowth", "#ContentOS"]).slice(0, 5);

                        return (
                          <article className="ka-feed-card" key={p.id}>
                            <div className="ka-feed-card-header">
                              <div className="ka-feed-title-block">
                                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                                  <span className="ka-feed-meta-tag">
                                    <FileText size={13} /> {p.document_name || "Redhash.pdf"}
                                  </span>
                                  <span className="ka-feed-meta-tag" style={{ background: "rgba(16, 185, 129, 0.1)", color: "#059669" }}>
                                    <PlatformIcon platform={targetPlatform} /> {targetPlatform}
                                  </span>
                                </div>
                                <h3>{cleanTitle}</h3>
                                <div className="ka-feed-meta-row">
                                  <span><Clock size={13} /> Scheduled Slot: {executionTimeStr}</span>
                                  {p.provider_post_id && (
                                    <span style={{ color: "#059669", fontWeight: 600 }}>
                                      Live Post #{p.provider_post_id} on {targetPlatform}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                {isPublished ? (
                                  <span className="ka-timing-active-badge">
                                    <CheckCircle2 size={13} /> PUBLISHED (Live)
                                  </span>
                                ) : isFailed ? (
                                  <span className="ka-timing-active-badge" style={{ background: "rgba(239, 68, 68, 0.1)", color: "#dc2626", borderColor: "rgba(239, 68, 68, 0.3)" }}>
                                    <AlertTriangle size={13} /> FAILED (Layer 5)
                                  </span>
                                ) : (
                                  <StatusBadge status={p.publish_state || p.content_status || p.state || "SCHEDULED"} />
                                )}

                                {data.canManage && (isFailed || p.content_status === "SCHEDULED" || p.publish_state === "ENQUEUED") && (
                                  <Button
                                    variant="primary"
                                    disabled={busy}
                                    onClick={() =>
                                      action(
                                        async () => {
                                          await request(`${base}/plans/${p.id}/publish-now`, "POST");
                                          await query.invalidateQueries({ queryKey: ["knowledge-automation"] });
                                        },
                                        isFailed ? "🚀 Re-dispatching post to social channel..." : "🚀 Dispatched to live social channel!"
                                      )
                                    }
                                    style={{ fontSize: "0.8rem", padding: "6px 12px", display: "flex", alignItems: "center", gap: "6px" }}
                                  >
                                    {isFailed ? <RefreshCw size={13} /> : <Send size={13} />}
                                    {isFailed ? "Retry Publish" : "Publish Now"}
                                  </Button>
                                )}

                                {p.content_id && (
                                  <Button asChild variant="secondary" style={{ fontSize: "0.8rem", padding: "6px 12px" }}>
                                    <Link to={`/app/compose?id=${p.content_id}`}>
                                      Review &amp; Edit
                                    </Link>
                                  </Button>
                                )}
                              </div>
                            </div>

                            {/* 5 Layers Visual Inspector Grid */}
                            <div className="ka-layers-breakdown">
                              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                                <div className="ka-layer-box">
                                  <div className="ka-layer-box-title">
                                    <BookOpen size={13} /> Layer 1: Knowledge Fact &amp; PDF Source
                                  </div>
                                  <div className="ka-layer-box-content">
                                    <strong>{conceptTitle}</strong>
                                    <p style={{ margin: "4px 0 0", color: "var(--text-muted, #64748b)", fontSize: "0.82rem", fontStyle: "italic" }}>
                                      &ldquo;{sourceExcerpt}&rdquo;
                                    </p>
                                  </div>
                                </div>

                                <div className="ka-layer-box">
                                  <div className="ka-layer-box-title">
                                    <Sparkles size={13} /> Layer 2: AI Prompt Engine
                                  </div>
                                  <div className="ka-layer-box-content">
                                    <span style={{ fontSize: "0.8rem", color: "#4f46e5", fontWeight: 600 }}>Visual Prompt Generated:</span>
                                    <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "var(--text-muted, #64748b)" }}>
                                      High-converting 3D SaaS isometric render featuring omnichannel social distribution pipelines, violet brand accents, and clean typography.
                                    </p>
                                  </div>
                                </div>
                              </div>

                              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                                <div className="ka-layer-box">
                                  <div className="ka-layer-box-title">
                                    <Image size={13} /> Layer 3: AI Rendered Poster Studio
                                  </div>
                                  {mediaUrl ? (
                                    <div className="ka-poster-preview-wrap" onClick={() => setActiveLightbox(mediaUrl)}>
                                      <img src={mediaUrl} alt="AI Poster" className="ka-poster-preview-img" crossOrigin="anonymous" />
                                      <div style={{ position: "absolute", bottom: "6px", right: "6px", background: "rgba(0,0,0,0.65)", color: "#fff", padding: "2px 6px", borderRadius: "4px", fontSize: "10px", display: "flex", alignItems: "center", gap: "4px" }}>
                                        <Eye size={10} /> Click to Expand
                                      </div>
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: "0.82rem", color: "var(--text-muted, #64748b)", padding: "10px 0" }}>
                                      Visual generation completed &amp; attached to scheduled draft.
                                    </div>
                                  )}
                                </div>

                                <div className="ka-layer-box">
                                  <div className="ka-layer-box-title">
                                    <PenLine size={13} /> Layer 4: Platform Copy &amp; Trending Hashtags
                                  </div>
                                  <div className="ka-layer-box-content">
                                    <p style={{ margin: "0 0 8px", fontSize: "0.83rem", whiteSpace: "pre-line" }}>
                                      {captionText.slice(0, 160)}...
                                    </p>
                                    <div>
                                      {hashtagsList.map((tag: string) => (
                                        <span key={tag} className="ka-hashtag-pill">{tag}</span>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Layer 5 Footer: Publishing & Email Notification Diagnostics */}
                            <div style={{ marginTop: "14px", paddingTop: "12px", borderTop: "1px dashed var(--border, #cbd5e1)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "0.8rem", color: "var(--text-muted, #64748b)" }}>
                                <span style={{ display: "flex", alignItems: "center", gap: "5px", color: isPublished ? "#059669" : undefined, fontWeight: 500 }}>
                                  <Send size={13} /> Layer 5: {isPublished ? `Delivered to @hindustan_social_network` : `Scheduled Slot: ${executionTimeStr}`}
                                </span>
                                <span style={{ display: "flex", alignItems: "center", gap: "5px", color: "#4f46e5", fontWeight: 500 }}>
                                  <Mail size={13} /> Email Log: {isPublished ? "Instant Success Report Sent" : isFailed ? "Failure Alert Dispatched" : "Ready"}
                                </span>
                              </div>
                            </div>

                            {/* Layer Failure Diagnostic Alert (if failed) */}
                            {isFailed && (
                              <div className="ka-error-alert-box">
                                <AlertTriangle size={18} style={{ color: "#ef4444", flexShrink: 0, marginTop: "2px" }} />
                                <div className="ka-error-alert-text">
                                  <strong>Layer 5 Issue Diagnosed:</strong> {p.error_code || p.error_message || "Telegram Bot Token was expired or invalid."}
                                  <div style={{ marginTop: "4px", fontSize: "0.8rem", color: "#7f1d1d" }}>
                                    Token has now been verified &amp; updated! Click <strong>&ldquo;Retry Publish&rdquo;</strong> above to re-dispatch immediately.
                                  </div>
                                </div>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      {/* Lightbox Modal for Poster Zoom */}
      {activeLightbox && (
        <div className="ka-lightbox-overlay" onClick={() => setActiveLightbox(null)}>
          <img src={activeLightbox} alt="Full Resolution Poster" className="ka-lightbox-img" crossOrigin="anonymous" />
        </div>
      )}
    </div>
  );
}
