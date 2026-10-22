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
} from "lucide-react";
import { request } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, Empty, StatusBadge } from "../components/ui";
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
  content_id: string | null;
  title: string;
  state: string;
  content_status: string;
  proposed_at: string;
  error_message: string;
  source_snapshot: Topic;
  attempts: number;
};
type Config = {
  enabled: boolean;
  horizon_days: number;
  cooldown_days: number;
  platforms: string[];
  posting_time?: string;
  poster_style?: 'DIRECT' | 'BRANDED_CANVAS';
  last_message?: string;
  last_run_at?: string;
};
type Overview = {
  topics: Topic[];
  plans: Plan[];
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
          posterStyle: config.poster_style || "DIRECT",
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
      {!embedded && <header className="ka-heading">
        <div>
          <span className="ka-eyebrow">YOUR KNOWLEDGE, WORKING FOR YOU</span>
          <h1>Knowledge & Automation</h1>
          <p>
            Turn approved business knowledge into a steady stream of
            source-linked content.
          </p>
        </div>
        <Button asChild>
          <Link to="/app/studio?tab=pdf">Add a business PDF</Link>
        </Button>
      </header>}
      {/* 100% Zero-Touch Auto-Pilot Dashboard Banner */}
      <div className="ka-autopilot-hero">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px", flexWrap: "wrap" }}>
              <span style={{
                background: "linear-gradient(135deg, #6366f1, #a855f7)",
                color: "#fff",
                padding: "4px 10px",
                borderRadius: "20px",
                fontSize: "0.75rem",
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                letterSpacing: "0.04em",
              }}>
                <Zap size={13} /> 100% ZERO-TOUCH AUTO-PILOT
              </span>
              <span style={{
                background: "rgba(16, 185, 129, 0.15)",
                color: "var(--success, #10b981)",
                border: "1px solid rgba(16, 185, 129, 0.35)",
                padding: "3px 8px",
                borderRadius: "12px",
                fontSize: "0.72rem",
                fontWeight: 600,
              }}>
                HANDS-FREE
              </span>
              {data?.workspace?.festival_automation_enabled && (
                <span style={{
                  background: "rgba(245, 158, 11, 0.15)",
                  color: "var(--warning, #d97706)",
                  border: "1px solid rgba(245, 158, 11, 0.35)",
                  padding: "3px 8px",
                  borderRadius: "12px",
                  fontSize: "0.72rem",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}>
                  <PartyPopper size={12} /> Festivals Enabled
                </span>
              )}
            </div>
            <h2>Autonomous PDF Publishing & Day-by-Day Scheduling</h2>
            <p>
              Upload business PDFs, and AI handles everything automatically: auto-pairs PDF visuals, creates platform-specific copy, schedules posts day-by-day (10:00 AM), and auto-injects morning festival greeting posters.
            </p>
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
            {/* Master Toggle Button */}
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              <span className="ka-autopilot-select-label">⚡ Auto-Pilot Status</span>
              <button
                type="button"
                disabled={!data?.canManage || busy}
                onClick={() => save(!config?.enabled)}
                style={{
                  height: "38px",
                  padding: "0 14px",
                  borderRadius: "8px",
                  fontWeight: 700,
                  fontSize: "0.82rem",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: config?.enabled ? "rgba(16, 185, 129, 0.2)" : "rgba(239, 68, 68, 0.15)",
                  color: config?.enabled ? "#34d399" : "#fca5a5",
                  border: config?.enabled ? "1px solid rgba(16, 185, 129, 0.4)" : "1px solid rgba(239, 68, 68, 0.3)",
                }}
              >
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: config?.enabled ? "#10b981" : "#ef4444" }} />
                {config?.enabled ? "ACTIVE (Running)" : "PAUSED (Click to Turn On)"}
              </button>
            </div>

            {/* Poster Style Selector */}
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              <label className="ka-autopilot-select-label">🎨 Poster Visual Style</label>
              <select
                aria-label="Poster Visual Style"
                className="ka-autopilot-select"
                value={config?.poster_style || "DIRECT"}
                disabled={!data?.canManage || busy}
                onChange={(e) => {
                  const style = e.target.value as 'DIRECT' | 'BRANDED_CANVAS';
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
                      `Poster style set to ${style === 'DIRECT' ? 'Direct PDF Slide' : 'Branded Canvas Poster'}!`
                    );
                  }
                }}
              >
                <option value="DIRECT">🖼️ Direct PDF Slide (Clean)</option>
                <option value="BRANDED_CANVAS">🎨 Branded Canvas Poster (Framed + CTA)</option>
              </select>
            </div>

            {/* Daily Post Slot Time */}
            <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
              <label className="ka-autopilot-select-label">⏰ Daily Post Slot</label>
              <select
                aria-label="Daily Post Slot Time"
                className="ka-autopilot-select"
                value={config?.posting_time || "10:00"}
                disabled={!data?.canManage || busy}
                onChange={(e) => {
                  const newTime = e.target.value;
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
                          posterStyle: config.poster_style || "DIRECT",
                        }),
                      `Daily posting slot set to ${newTime}!`
                    );
                  }
                }}
              >
                <option value="08:00">08:00 AM</option>
                <option value="09:00">09:00 AM</option>
                <option value="10:00">10:00 AM (Recommended)</option>
                <option value="11:00">11:00 AM</option>
                <option value="12:00">12:00 PM</option>
                <option value="14:00">02:00 PM</option>
                <option value="16:00">04:00 PM</option>
                <option value="18:00">06:00 PM (Target Slot)</option>
                <option value="20:00">08:00 PM</option>
              </select>
            </div>

            <button
              type="button"
              className="ka-autopilot-btn"
              disabled={busy || !data?.canEdit}
              onClick={triggerAutoPilot}
              style={{ alignSelf: "flex-end" }}
            >
              <Zap size={16} />
              {busy ? "Running Auto-Pilot…" : "⚡ Run Auto-Pilot Now"}
            </button>
          </div>
        </div>

        {/* 4 Feature Pillars */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "12px",
          marginTop: "4px",
        }}>
          <div className="ka-feature-pill-card">
            <div className="pill-title" style={{ color: "var(--accent, #6366f1)" }}>
              <span>🖼️ Auto-Visual Pairing</span>
            </div>
            <p>
              PDF se nikli images AI poster banakar relevant post ke sath jod deta hai.
            </p>
          </div>

          <div className="ka-feature-pill-card">
            <div className="pill-title" style={{ color: "#8b5cf6" }}>
              <span>✍️ Auto-Copywriting</span>
            </div>
            <p>
              LinkedIn, Instagram, Facebook, Telegram ke captions & trending hashtags.
            </p>
          </div>

          <div className="ka-feature-pill-card">
            <div className="pill-title" style={{ color: "var(--success, #10b981)" }}>
              <span>📅 Day-by-Day Scheduling</span>
            </div>
            <p>
              Day 1 (10:00 AM), Day 2 (10:00 AM)... seedhe SCHEDULED mark ho jati hain.
            </p>
          </div>

          <div className="ka-feature-pill-card">
            <div className="pill-title" style={{ color: "var(--warning, #d97706)" }}>
              <span>🪔 Festival Auto-Greeting</span>
            </div>
            <p>
              Diwali, Holi, Eid, Independence Day posters morning slot ({data?.workspace?.festival_post_time || "09:00 AM"}) me auto-inject.
            </p>
          </div>
        </div>
      </div>

      {/* Festival Auto-Greeting Setting Card */}
      {data && (
        <div className="ka-festival-card">
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              background: "rgba(245, 158, 11, 0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#d97706",
              flexShrink: 0,
            }}>
              <PartyPopper size={20} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <strong>
                  🪔 Indian & Global Festival Auto-Greetings
                </strong>
                <span style={{
                  fontSize: "0.7rem",
                  padding: "2px 8px",
                  borderRadius: "10px",
                  background: data.workspace.festival_automation_enabled ? "rgba(16, 185, 129, 0.2)" : "rgba(148, 163, 184, 0.2)",
                  color: data.workspace.festival_automation_enabled ? "var(--success, #10b981)" : "var(--muted, #64748b)",
                  fontWeight: 600,
                }}>
                  {data.workspace.festival_automation_enabled ? "ACTIVE · AUTO-INJECT ON" : "PAUSED"}
                </span>
              </div>
              <p>
                {data.workspace.festival_automation_enabled
                  ? `Festival greeting posters will auto-schedule at ${data.workspace.festival_post_time || "09:00"} AM on festival days (Diwali, Holi, Eid, Independence Day, etc.).`
                  : "Enable to automatically detect festival days and schedule festive greetings in morning slots."}
              </p>
            </div>
          </div>
          {data.canManage && (
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <select
                aria-label="Festival greeting slot"
                className="ka-autopilot-select"
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
              <Button
                variant={data.workspace.festival_automation_enabled ? "secondary" : "primary"}
                disabled={busy}
                onClick={() => toggleFestivalAutomation(!data.workspace.festival_automation_enabled)}
                style={{ fontSize: "0.82rem", padding: "6px 14px" }}
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
            Upload business PDFs in AI Studio to build your knowledge pool and
            enable automation.
          </p>
        </Empty>
      ) : (
        <>
          {overview.isLoading && (
            <p role="status">Loading workspace knowledge…</p>
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
              {!embedded && <div className="ka-metrics">
                <article>
                  <BookOpen size={20} />
                  <strong>{data.topics.length}</strong>
                  <span>Unique knowledge topics</span>
                </article>
                <article>
                  <ShieldCheck size={20} />
                  <strong>
                    {data.topics.filter((t) => t.eligible).length}
                  </strong>
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
              </div>}
              {embedded && <div className="studio-readiness"><strong>{data.topics.filter(t=>t.eligible).length} approved topics · {data.workspace.daily_posting_target} post{data.workspace.daily_posting_target===1?'':'s'} per day</strong><p>{data.topics.some(t=>t.eligible) ? 'Automation uses the same PDFs and facts you manage in Business knowledge.' : 'Start in Business knowledge: upload a PDF and approve the facts you want to use.'}</p><Link to="/app/studio?tab=pdf">Manage business knowledge →</Link></div>}
              <section className="ka-config">
                <div>
                  <h2>Automatic content from your business knowledge</h2>
                  <p>
                    {config.enabled
                      ? "Automation is active"
                      : "Automation is paused"}{" "}
                    · {data.workspace.timezone}
                  </p>
                  <small>
                    Uses your{" "}
                    <Link to="/app/calendar">Calendar posting slots</Link> and
                    leaves room for festivals. New drafts appear in Approvals and proposed dates appear in Calendar.
                  </small>
                </div>
                <details className="studio-advanced"><summary>Planning preferences</summary><div className="ka-fields">
                  <label>
                    Planning horizon
                    <select
                      disabled={!data.canManage || busy}
                      value={config.horizon_days}
                      onChange={(e) =>
                        change({ horizon_days: Number(e.target.value) })
                      }
                    >
                      {[1, 3, 7, 14].map((n) => (
                        <option key={n} value={n}>
                          {n} days
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Topic cooldown
                    <input
                      aria-label="Topic cooldown in days"
                      type="number"
                      min={1}
                      max={365}
                      disabled={!data.canManage || busy}
                      value={config.cooldown_days}
                      onChange={(e) =>
                        change({ cooldown_days: Number(e.target.value) })
                      }
                    />
                    <small>days before reuse</small>
                  </label>
                  <label>
                    Daily Auto-Pilot Slot Time
                    <select
                      disabled={!data.canManage || busy}
                      value={config.posting_time || "10:00"}
                      onChange={(e) =>
                        change({ posting_time: e.target.value })
                      }
                    >
                      <option value="08:00">08:00 AM</option>
                      <option value="09:00">09:00 AM</option>
                      <option value="10:00">10:00 AM (Recommended)</option>
                      <option value="11:00">11:00 AM</option>
                      <option value="12:00">12:00 PM</option>
                      <option value="14:00">02:00 PM</option>
                      <option value="16:00">04:00 PM</option>
                      <option value="18:00">06:00 PM</option>
                      <option value="20:00">08:00 PM</option>
                    </select>
                    <small>Day 1, Day 2... posts iss slot par assign hongi</small>
                  </label>
                </div></details>
                <fieldset disabled={!data.canManage || busy}>
                  <legend>Target channels</legend>
                  {["LinkedIn", "Instagram", "Facebook", "Telegram", "X"].map((p) => (
                    <label key={p}>
                      <input
                        type="checkbox"
                        checked={config.platforms.includes(p)}
                        onChange={(e) =>
                          change({
                            platforms: e.target.checked
                              ? [...config.platforms, p]
                              : config.platforms.filter((x) => x !== p),
                          })
                        }
                      />
                      {p}
                      <small>
                        {data.accounts.some((a) => a.platform.toLowerCase() === p.toLowerCase())
                          ? "Connected"
                          : "Connect account"}
                      </small>
                    </label>
                  ))}
                </fieldset>
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
                  >
                    {busy
                      ? "Working…"
                      : dirty
                        ? "Save preferences"
                        : "Save preferences"}
                  </Button>
                  <Button
                    disabled={
                      !data.canManage ||
                      busy ||
                      dirty ||
                      !config.platforms.length
                    }
                    onClick={() => save(!config.enabled)}
                  >
                    {config.enabled ? "Pause automation" : "Enable automation"}
                  </Button>
                  <Button
                    disabled={
                      !data.canManage || busy || dirty || !config.enabled
                    }
                    onClick={() =>
                      action(
                        () => request(base + "/run", "POST", {}),
                        "Planner requested. Results appear here after the next worker cycle.",
                      )
                    }
                  >
                    Plan now
                  </Button>
                </div>
                {!data.canManage && (
                  <small>
                    Your workspace owner or admin can change automation
                    settings.
                  </small>
                )}
                <p className="ka-last">
                  {data.settings.last_message ||
                    "Confirm useful knowledge, select connected channels, then enable the planner."}
                  {data.settings.last_run_at && (
                    <> Last run: {date(data.settings.last_run_at)}.</>
                  )}
                </p>
              </section>
              {!embedded && <nav className="ka-tabs" aria-label="Knowledge automation views">
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
              </nav>}
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
                        Upload a PDF in AI Studio. Extracted facts appear here
                        with their source pages.
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
                              {t.sources.length === 1 ? "" : "s"} · View
                              evidence
                            </summary>
                            {t.sources.map((s) => (
                              <div className="ka-source" key={s.knowledgeId}>
                                <strong>
                                  {s.documentName} · Pages {s.pageStart}
                                  {s.pageEnd !== s.pageStart
                                    ? `–${s.pageEnd}`
                                    : ""}
                                </strong>
                                <blockquote>
                                  {s.excerpt ||
                                    "No source excerpt. This fact cannot be used automatically."}
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
                  <div className="ka-section-heading">
                    <h2>Planned ideas & generation history</h2>
                    <Link to="/app/approvals">Open approval queue →</Link>
                  </div>
                  {!data.plans.length ? (
                    <Empty
                      icon={<CalendarClock />}
                      title="Your first content plan starts here"
                    >
                      <p>
                        Confirm source facts in the Knowledge pool, then enable
                        the planner. Insufficient knowledge leaves slots empty.
                      </p>
                    </Empty>
                  ) : (
                    <div className="ka-plan-list">
                      {data.plans.map((p) => {
                        const mediaUrl = (p as any).variants ? Object.values((p as any).variants).find((v: any) => v?.mediaUrl)?.mediaUrl : null;
                        const cleanTitle = p.title && !p.title.startsWith('{') ? p.title : (p.source_snapshot?.value || p.source_snapshot?.key || "Social Media Post");
                        return (
                        <article className="ka-plan" key={p.id} style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                          {mediaUrl && (
                            <img
                              src={mediaUrl}
                              alt="Poster Thumbnail"
                              style={{
                                width: "64px",
                                height: "64px",
                                objectFit: "cover",
                                borderRadius: "8px",
                                border: "1px solid var(--border)",
                                flexShrink: 0,
                              }}
                            />
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <h3 style={{ margin: "0 0 4px", fontSize: "0.95rem" }}>{cleanTitle}</h3>
                            <p style={{ margin: "0 0 2px", fontSize: "0.8rem", color: "var(--color-text-muted)" }}>Proposed: {date(p.proposed_at)}</p>
                            <small style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                              {p.source_snapshot.sources
                                ?.map((s) => s.documentName)
                                .filter((v, i, a) => a.indexOf(v) === i)
                                .join(", ")}
                            </small>
                            {p.error_message && (
                              <p className="ka-error" style={{ margin: "4px 0 0" }}>
                                {p.error_message} · Attempt {p.attempts}/3
                              </p>
                            )}
                          </div>
                          <div className="ka-plan-actions" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            <StatusBadge
                              status={
                                p.state === "REVIEW"
                                  ? p.content_status
                                  : p.state
                              }
                            />
                            {p.content_id && p.content_status === "SCHEDULED" && data.canManage && (
                              <Button
                                disabled={busy}
                                onClick={() =>
                                  action(
                                    async () => {
                                      await request(`${base}/plans/${p.id}/publish-now`, "POST");
                                      await query.invalidateQueries({ queryKey: ["knowledge-automation"] });
                                    },
                                    "🚀 Post successfully published to all connected social channels!"
                                  )
                                }
                                style={{
                                  background: "linear-gradient(135deg, #10b981, #059669)",
                                  color: "#fff",
                                  fontSize: "0.8rem",
                                  padding: "6px 12px",
                                  fontWeight: 600,
                                }}
                              >
                                🚀 Publish Now
                              </Button>
                            )}
                            {p.content_id && (
                              <Button asChild>
                                <Link to={`/app/compose?id=${p.content_id}`}>
                                  Review & edit
                                </Link>
                              </Button>
                            )}
                            {data.canManage &&
                              p.state === "FAILED" &&
                              !p.content_id && (
                                <Button
                                  disabled={busy}
                                  onClick={() =>
                                    action(
                                      () =>
                                        request(
                                          `${base}/plans/${p.id}/retry`,
                                          "POST",
                                          {},
                                        ),
                                      "Generation retry requested. Enable automation to process it.",
                                    )
                                  }
                                >
                                  Retry generation
                                </Button>
                              )}
                            {data.canManage &&
                              p.state === "REVIEW" &&
                              ["DRAFT", "NEEDS_REVIEW"].includes(
                                p.content_status,
                              ) && (
                                <Button
                                  disabled={busy}
                                  onClick={() =>
                                    action(
                                      () =>
                                        request(
                                          `${base}/plans/${p.id}/dismiss`,
                                          "POST",
                                          {},
                                        ),
                                      "Proposal dismissed. The draft is retained in your library.",
                                    )
                                  }
                                >
                                  Dismiss
                                </Button>
                              )}
                          </div>
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
    </div>
  );
}
