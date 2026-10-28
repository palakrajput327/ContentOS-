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
  Layers,
  ChevronDown,
  AlertTriangle,
  ExternalLink,
  Send,
  Eye,
  X,
  FileText,
  RefreshCw,
  Trash2,
  History,
  Copy,
} from "lucide-react";
import { request, resolveMediaUrl } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, Empty, StatusBadge, PlatformIcon } from "../components/ui";
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
  poster_style?: "DIRECT" | "BRANDED_CANVAS" | "AI_POSTER";
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

type DispatchedItem = {
  id: string;
  source: string;
  document_id: string | null;
  document_name: string;
  title: string;
  concept_prompt: string;
  source_excerpt?: string;
  page_number?: number | null;
  image_url: string | null;
  target_channels: string[];
  status: string;
  scheduled_at: string | null;
  dispatched_at: string | null;
  post_result?: any;
};

type DispatchHistoryResponse = {
  success: boolean;
  retentionDays: number;
  totalDispatched: number;
  history: DispatchedItem[];
};

const base = "/knowledge-automation";

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

  const historyQuery = useQuery({
    queryKey: ["dispatch-history", wid],
    queryFn: () => request<DispatchHistoryResponse>(`${base}/dispatch-history`),
    enabled: !demo,
    refetchInterval: 10000,
  });

  const [config, setConfig] = useState<Config | null>(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [clearing, setClearing] = useState(false),
    [showClearConfirm, setShowClearConfirm] = useState(false),
    [copiedPromptId, setCopiedPromptId] = useState<string | null>(null),
    [message, setMessage] = useState(""),
    [search, setSearch] = useState(""),
    [activeLightbox, setActiveLightbox] = useState<string | null>(null),
    [tab, setTab] = useState<"history" | "knowledge">("history");

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
      setMessage(
        result && typeof result === "object" && "message" in result && typeof result.message === "string"
          ? result.message
          : success
      );
      await Promise.all([
        query.invalidateQueries({ queryKey: ["knowledge-automation", wid] }),
        query.invalidateQueries({ queryKey: ["dispatch-history", wid] }),
        query.invalidateQueries({ queryKey: ["workspace", wid] }),
        query.invalidateQueries({ queryKey: ["calendar"] }),
        query.invalidateQueries({ queryKey: ["posts"] }),
        query.invalidateQueries({ queryKey: ["documents"] }),
      ]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed. Please retry.");
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
          {}
        );
        return res;
      },
      "Auto-pilot triggered successfully. Generating drafts in background."
    );
  }

  async function handleClearHistory() {
    setClearing(true);
    try {
      await request(`${base}/clear-history`, "POST", {});
      await historyQuery.refetch();
      setShowClearConfirm(false);
      setMessage("✓ 10-day publishing history cleared successfully.");
      setTimeout(() => setMessage(""), 5000);
    } catch (err: any) {
      setMessage(err.message || "Failed to clear history.");
    } finally {
      setClearing(false);
    }
  }

  function handleCopyPrompt(id: string, text: string) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedPromptId(id);
      setTimeout(() => setCopiedPromptId(null), 3000);
    }
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
        : "Festival auto-greetings paused."
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
        ? "Automation settings updated and active."
        : "Automation paused. Existing drafts and approved schedules are preserved."
    );
  }

  const change = (next: Partial<Config>) => {
    setConfig((c) => (c ? { ...c, ...next } : c));
    setDirty(true);
  };

  const formatDate = (value: string | null | undefined) => {
    if (!value) return "Recently";
    try {
      return new Intl.DateTimeFormat("en-IN", {
        timeZone: data?.workspace.timezone || "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value));
    } catch {
      return value;
    }
  };

  const topics = (data?.topics || []).filter((t) =>
    (t.key + " " + JSON.stringify(t.value)).toLowerCase().includes(search.toLowerCase())
  );

  const dispatchedHistory = historyQuery.data?.history || [];

  return (
    <div className={`knowledge-automation ${embedded ? "studio-automation-panel" : ""}`}>
      {!embedded && (
        <header className="ka-heading">
          <div>
            <span className="ka-eyebrow">YOUR KNOWLEDGE, WORKING FOR YOU</span>
            <h1>Knowledge &amp; Automation</h1>
            <p>Turn approved business knowledge into a steady stream of source-linked content.</p>
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
          <span className="ka-eyebrow">AUTOPILOT AUDIT LOG</span>
          <h2>History of your Autopilot</h2>
          <p>
            Audit log of dispatched posts over the last 10 days, connected channel delivery, and autonomous generation controls.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Button asChild variant="secondary">
            <Link to="/app/studio?tab=pdf" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.82rem" }}>
              <BookOpen size={15} /> Business Knowledge Studio <ArrowRight size={14} />
            </Link>
          </Button>
          <Link to="/app/calendar" className="ka-calendar-link">
            <CalendarClock size={16} /> View calendar <ArrowUpRight size={14} />
          </Link>
        </div>
      </header>

      <nav className="ka-section-nav" aria-label="Automation sections">
        <a href="#ka-history"><History size={15} /> Dispatched History (10 Days)</a>
        <a href="#ka-festivals"><PartyPopper size={15} /> Festival greetings</a>
        <a href="#ka-preferences"><Settings2 size={15} /> Target Channels</a>
      </nav>

      {/* ==========================================================================
          10-DAY DISPATCHED PUBLISHING HISTORY SECTION
          ========================================================================== */}
      <section className="ka-history-section" id="ka-history">
        <div className="ka-history-header-card">
          <div className="ka-history-title-group">
            <h3>
              <History size={20} style={{ color: "#6366f1" }} />
              Dispatched Publishing History (Last 10 Days)
            </h3>
            <span className="ka-history-count-pill">
              {dispatchedHistory.length} Posts Dispatched
            </span>
            <span className="ka-history-retention-pill">
              <Clock size={12} /> Auto-retained 10 days · Older logs auto-cleaned
            </span>
          </div>

          <div className="ka-history-actions-bar">
            <Button
              variant="secondary"
              disabled={historyQuery.isFetching}
              onClick={() => historyQuery.refetch()}
              style={{ fontSize: "0.82rem", padding: "6px 12px", display: "inline-flex", alignItems: "center", gap: "6px" }}
              title="Refresh dispatched post history"
            >
              <RefreshCw size={13} className={historyQuery.isFetching ? "ka-spin" : ""} /> Refresh
            </Button>

            {dispatchedHistory.length > 0 && (
              <>
                {!showClearConfirm ? (
                  <button
                    type="button"
                    className="ka-clear-btn"
                    onClick={() => setShowClearConfirm(true)}
                    title="Clear 10-day dispatched post history"
                  >
                    <Trash2 size={14} /> Clear History
                  </button>
                ) : (
                  <div className="ka-confirm-box">
                    <span>Clear all 10-day logs?</span>
                    <button
                      type="button"
                      className="ka-confirm-yes"
                      disabled={clearing}
                      onClick={handleClearHistory}
                    >
                      {clearing ? "Clearing…" : "Yes, Clear"}
                    </button>
                    <button
                      type="button"
                      className="ka-confirm-no"
                      disabled={clearing}
                      onClick={() => setShowClearConfirm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Status Notification */}
        {message && (
          <div
            style={{
              padding: "10px 16px",
              borderRadius: "8px",
              background: "rgba(99, 102, 241, 0.1)",
              border: "1px solid rgba(99, 102, 241, 0.3)",
              color: "#4f46e5",
              fontSize: "0.85rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <CheckCircle2 size={16} />
            {message}
          </div>
        )}

        {/* History Feed Content */}
        {historyQuery.isLoading ? (
          <div className="ka-empty-dispatch-card">
            <Loader2 size={28} className="ka-spin" style={{ color: "#6366f1" }} />
            <p style={{ margin: 0, color: "var(--text-muted, #64748b)", fontSize: "0.9rem" }}>
              Loading 10-day publishing history…
            </p>
          </div>
        ) : dispatchedHistory.length === 0 ? (
          <div className="ka-empty-dispatch-card">
            <div className="ka-empty-icon-circle">
              <Send size={24} />
            </div>
            <h4 style={{ margin: "0 0 4px", fontSize: "1.05rem", fontWeight: 700, color: "var(--text, #0f172a)" }}>
              No Posts Dispatched in the Last 10 Days
            </h4>
            <p style={{ margin: 0, color: "var(--text-muted, #64748b)", fontSize: "0.86rem", maxWidth: "480px", lineHeight: 1.5 }}>
              Posts dispatched through the <b>Daily Schedule Queue</b> in Business Knowledge or sent live will appear here automatically with generated images, target channels, and timestamps.
            </p>
            <div style={{ marginTop: "12px" }}>
              <Button asChild variant="primary">
                <Link to="/app/studio?tab=pdf" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <BookOpen size={15} /> Go to Business Knowledge to Schedule Posts
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="ka-dispatched-feed">
            {dispatchedHistory.map((item) => {
              const channels = Array.isArray(item.target_channels) && item.target_channels.length > 0
                ? item.target_channels
                : ["LinkedIn", "Instagram", "Facebook", "Telegram"];
              const imageUrl = item.image_url ? resolveMediaUrl(item.image_url) : null;
              const hasCopied = copiedPromptId === item.id;

              return (
                <article className="ka-dispatched-card" key={item.id}>
                  {/* Card Top Meta Header */}
                  <div className="ka-dispatched-top">
                    <div className="ka-dispatched-tags">
                      <span className="ka-doc-badge">
                        <FileText size={12} /> {item.document_name || "Redhash_compressed.pdf"}
                        {item.page_number ? ` · Page ${item.page_number}` : ""}
                      </span>

                      {channels.map((ch) => (
                        <span key={ch} className="ka-channel-badge-pill">
                          <PlatformIcon platform={ch} /> {ch}
                        </span>
                      ))}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                      <span className="ka-dispatched-time-badge">
                        <Clock size={13} /> Dispatched: {formatDate(item.dispatched_at)}
                      </span>
                      <span className="ka-status-published">
                        <CheckCircle2 size={13} /> Published Successfully
                      </span>
                    </div>
                  </div>

                  {/* Card Body: Image + Content Details */}
                  <div className="ka-dispatched-body">
                    {/* Left: Visual Thumbnail */}
                    {imageUrl ? (
                      <div className="ka-dispatched-thumb-wrap" onClick={() => setActiveLightbox(imageUrl)}>
                        <img
                          src={imageUrl}
                          alt={item.title || "Dispatched visual"}
                          className="ka-dispatched-thumb-img"
                          crossOrigin="anonymous"
                        />
                        <div className="ka-dispatched-thumb-overlay">
                          <Eye size={11} /> Click to Zoom
                        </div>
                      </div>
                    ) : (
                      <div
                        className="ka-dispatched-thumb-wrap"
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "var(--text-muted, #64748b)",
                          fontSize: "0.8rem",
                          gap: "6px",
                          padding: "16px",
                          textAlign: "center",
                        }}
                      >
                        <Image size={24} style={{ color: "#6366f1" }} />
                        <span>Visual Dispatched</span>
                      </div>
                    )}

                    {/* Right: Title, Source Excerpt & Dynamic Prompt */}
                    <div className="ka-dispatched-details">
                      <h4 className="ka-dispatched-title">{item.title}</h4>

                      {item.source_excerpt && (
                        <p className="ka-dispatched-excerpt">
                          &ldquo;{item.source_excerpt}&rdquo;
                        </p>
                      )}

                      {item.concept_prompt && (
                        <div className="ka-prompt-box">
                          <button
                            type="button"
                            className="ka-prompt-copy-btn"
                            onClick={() => handleCopyPrompt(item.id, item.concept_prompt)}
                            title="Copy visual prompt"
                          >
                            {hasCopied ? <Check size={11} style={{ color: "#059669" }} /> : <Copy size={11} />}
                            {hasCopied ? "Copied!" : "Copy Prompt"}
                          </button>
                          <div style={{ fontWeight: 600, fontSize: "0.74rem", textTransform: "uppercase", color: "#6366f1", marginBottom: "4px" }}>
                            FLUX.1 Dynamic Prompt Grounded in Document
                          </div>
                          <div style={{ paddingRight: "70px", color: "var(--text, #334155)", fontSize: "0.8rem" }}>
                            {item.concept_prompt}
                          </div>
                        </div>
                      )}

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "4px", fontSize: "0.78rem", color: "var(--text-muted, #64748b)" }}>
                        <span>
                          Delivered live to: <b>{channels.join(", ")}</b>
                        </span>
                        {item.post_result?.postId && (
                          <span style={{ color: "#059669", fontWeight: 600 }}>
                            Post ID: #{item.post_result.postId}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Festival Greetings Card */}
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
                      `Festival greeting time updated to ${newTime}!`
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

      {/* Target Channels & Preferences */}
      {data && config && (
        <section className="ka-config" id="ka-preferences">
          <div className="ka-config-header">
            <div className="ka-config-title">
              <div className="ka-config-icon-wrap">
                <Settings2 size={20} />
              </div>
              <div>
                <h3>Target Channels &amp; Automation Preferences</h3>
                <p>
                  {config.enabled ? "Automation is active" : "Automation is paused"} · {data.workspace.timezone}
                </p>
              </div>
            </div>
            <small className="ka-config-sub">
              Schedules sequential posts and leaves room for festivals. Managed via <Link to="/app/studio?tab=pdf">Business Knowledge</Link>.
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
                <span>Advanced Planning Horizon &amp; Topic Cooldown</span>
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
          </div>
        </section>
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
