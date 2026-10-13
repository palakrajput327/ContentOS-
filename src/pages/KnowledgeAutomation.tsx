import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  BookOpen,
  CalendarClock,
  ShieldCheck,
  Sparkles,
  Search,
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
  last_message?: string;
  last_run_at?: string;
};
type Overview = {
  topics: Topic[];
  plans: Plan[];
  settings: Config;
  workspace: { timezone: string; daily_posting_target: number };
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
      await fn();
      setMessage(success);
      await Promise.all([
        query.invalidateQueries({ queryKey: ["knowledge-automation", wid] }),
        query.invalidateQueries({ queryKey: ["workspace", wid] }),
      ]);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Action failed. Please retry.",
      );
    } finally {
      setBusy(false);
    }
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
      <div className="ka-policy">
        <ShieldCheck size={22} />
        <div>
          <strong>Review Mode</strong>
          <p>
            Content generation and time proposals run automatically. Approve and
            schedule each post before it can publish. Proposed times are
            tentative.
          </p>
        </div>
        <span className="ka-pill">Approval required</span>
      </div>
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
                </div></details>
                <fieldset disabled={!data.canManage || busy}>
                  <legend>Text channels</legend>
                  {["LinkedIn", "Telegram", "X", "Facebook"].map((p) => (
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
                        {data.accounts.some((a) => a.platform === p)
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
                      {data.plans.map((p) => (
                        <article className="ka-plan" key={p.id}>
                          <div>
                            <h3>{p.title || p.source_snapshot.key}</h3>
                            <p>Proposed: {date(p.proposed_at)}</p>
                            <small>
                              {p.source_snapshot.sources
                                ?.map((s) => s.documentName)
                                .filter((v, i, a) => a.indexOf(v) === i)
                                .join(", ")}
                            </small>
                            {p.error_message && (
                              <p className="ka-error">
                                {p.error_message} · Attempt {p.attempts}/3
                              </p>
                            )}
                          </div>
                          <div className="ka-plan-actions">
                            <StatusBadge
                              status={
                                p.state === "REVIEW"
                                  ? p.content_status
                                  : p.state
                              }
                            />
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
                      ))}
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
