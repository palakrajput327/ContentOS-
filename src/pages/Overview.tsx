import { Link, useOutletContext } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Plus,
  Sparkles,
  CalendarDays,
  CheckCheck,
  FileText,
  ArrowRight,
  Lightbulb,
  Users,
  Send,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { Button, PlatformIcon, Empty } from "../components/ui";
import { dateLabel, platforms, type Snapshot, type Post } from "../lib/model";
import { useSession } from "../lib/session";
import { request } from "../lib/api";
import "../dashboard.css";

interface DashboardSummary {
  metrics: {
    connectedAccounts: number;
    scheduledPosts: number;
    publishedPosts: number;
    drafts: number;
    awaitingApproval: number;
    approved: number;
    totalPosts: number;
    aiPosts: number;
    aiConfigured: boolean;
    aiProvider: string;
    memberCount: number;
  };
  pipeline: {
    draft: number;
    review: number;
    approved: number;
    scheduled: number;
    published: number;
  };
  platformCounts: Record<string, number>;
  upcomingContent: Post[];
  recentActivity: {
    id: string;
    actor: string;
    action: string;
    entity: string;
    at: string;
  }[];
}

export default function Overview() {
  const s = useOutletContext<Snapshot>();
  const user = useSession((x) => x.user);
  const wid = useSession((x) => x.workspaceId);

  // Real-time live dashboard query from real database API with 5s auto-polling
  const {
    data: summary,
    isFetching,
    refetch,
  } = useQuery<DashboardSummary>({
    queryKey: ["dashboard-summary", wid],
    queryFn: () => request<DashboardSummary>("/dashboard/summary"),
    refetchInterval: 5000,
  });

  const count = (st: string) => s.posts.filter((p) => p.status === st).length;
  const scheduled =
    summary?.upcomingContent && summary.upcomingContent.length > 0
      ? summary.upcomingContent
      : s.posts.filter((p) => p.status === "SCHEDULED");
  const published = s.posts.filter((p) => p.status === "PUBLISHED");

  const connectedAccountsCount =
    summary?.metrics?.connectedAccounts ??
    s.accounts.filter((a) => a.state?.toLowerCase() === "connected").length;

  const scheduledCount = summary?.metrics?.scheduledPosts ?? scheduled.length;
  const publishedCount = summary?.metrics?.publishedPosts ?? published.length;
  const draftsCount = summary?.metrics?.drafts ?? count("DRAFT");
  const awaitingApprovalCount =
    summary?.metrics?.awaitingApproval ?? count("NEEDS_REVIEW");
  const aiPostsCount = summary?.metrics?.aiPosts ?? 0;
  const isAiConfigured = summary?.metrics?.aiConfigured ?? true;
  const aiProviderName = summary?.metrics?.aiProvider || "Gemini 2.5 Flash";

  const cards = [
    [
      "Connected accounts",
      connectedAccountsCount,
      Users,
      connectedAccountsCount > 0
        ? `${connectedAccountsCount} active channels`
        : "Your publishing destinations",
    ],
    [
      "Scheduled posts",
      scheduledCount,
      CalendarDays,
      "Ready for the calendar",
    ],
    [
      "Published posts",
      publishedCount,
      Send,
      "Published from this workspace",
    ],
    ["Drafts", draftsCount, FileText, "Ideas taking shape"],
    [
      "Awaiting approval",
      awaitingApprovalCount,
      CheckCheck,
      "Ready for a second look",
    ],
    [
      "AI Studio & Engine",
      isAiConfigured
        ? aiPostsCount > 0
          ? `${aiPostsCount} generated`
          : "Active"
        : "Standby",
      Sparkles,
      isAiConfigured ? `Powered by ${aiProviderName}` : "AI models ready",
    ],
  ] as const;

  const pipeline = summary?.pipeline ?? {
    draft: draftsCount,
    review: awaitingApprovalCount,
    approved: count("APPROVED"),
    scheduled: scheduledCount,
    published: publishedCount,
  };

  const steps = [
    [
      "Source",
      null,
      Lightbulb,
      "#b58aff",
      summary?.metrics?.totalPosts ?? s.posts.length,
      "/app/compose",
    ],
    [
      "AI Studio",
      null,
      Sparkles,
      "#958aff",
      aiPostsCount > 0 ? aiPostsCount : "Ready",
      "/app/studio",
    ],
    ["Draft", "DRAFT", FileText, "#77a7ff", pipeline.draft, "/app/library?status=DRAFT"],
    [
      "Review",
      "NEEDS_REVIEW",
      Users,
      "#74a7ff",
      pipeline.review,
      "/app/library?status=NEEDS_REVIEW",
    ],
    [
      "Approved",
      "APPROVED",
      CheckCheck,
      "#57d7d3",
      pipeline.approved,
      "/app/library?status=APPROVED",
    ],
    [
      "Scheduled",
      "SCHEDULED",
      CalendarDays,
      "#61d5b1",
      pipeline.scheduled,
      "/app/calendar",
    ],
    [
      "Published",
      "PUBLISHED",
      Send,
      "#6dd3a3",
      pipeline.published,
      "/app/library?status=PUBLISHED",
    ],
  ] as const;

  const recentActivity = summary?.recentActivity || s.activity;

  return (
    <>
      <div className="page-heading reference-heading">
        <div>
          <span className="overline" style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <span>
              {new Intl.DateTimeFormat("en", {
                dateStyle: "full",
                timeZone: s.workspace.timezone,
              }).format(new Date())}
            </span>
            <span style={{ opacity: 0.3 }}>•</span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                color: "#10b981",
                fontSize: "0.78rem",
                fontWeight: 600,
                background: "rgba(16, 185, 129, 0.12)",
                padding: "2px 8px",
                borderRadius: "999px",
                border: "1px solid rgba(16, 185, 129, 0.25)",
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: "#10b981",
                  boxShadow: "0 0 6px #10b981",
                }}
              />
              Live Sync
            </span>
          </span>
          <h1>
            Hello, {user?.name?.trim() ? user.name.trim().split(" ")[0] : "there"}{" "}
            <span aria-hidden>✦</span>
          </h1>
          <p>Here’s what’s happening with your social presence.</p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            onClick={() => refetch()}
            className="icon-button"
            title="Sync live workspace data"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 14px",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text-muted)",
              fontSize: "0.84rem",
              cursor: "pointer",
            }}
          >
            <RefreshCw
              size={14}
              style={{
                animation: isFetching ? "spin 1s linear infinite" : "none",
              }}
            />
            Sync
          </button>
          <Button asChild variant="primary">
            <Link to="/app/compose">
              <Plus size={17} />
              Create post
            </Link>
          </Button>
        </div>
      </div>

      <div className="overview-stats">
        {cards.map(([label, value, Icon, note]) => (
          <div className="stat-card" key={label}>
            <div>
              <span className="stat-glyph">
                <Icon size={20} />
              </span>
              {label}
            </div>
            <strong>{value}</strong>
            <small>{note}</small>
          </div>
        ))}
      </div>

      <div className="overview-layout">
        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>Content pipeline</h2>
              <p>Track your content from idea to publication in real-time.</p>
            </div>
            <Link to="/app/library">
              View content <ArrowRight size={14} />
            </Link>
          </div>
          <div className="pipeline-steps">
            {steps.map(([label, , Icon, color, stepCount, linkTo]) => (
              <Link
                className="pipeline-step"
                key={label}
                to={linkTo}
                style={{ "--step-color": color } as React.CSSProperties}
              >
                <i>
                  <Icon size={23} />
                </i>
                <span>{label}</span>
                <strong>{stepCount}</strong>
              </Link>
            ))}
          </div>
          <small className="form-note">
            ✦ Real-time content lifecycle synced with PostgreSQL and {aiProviderName}.
          </small>
        </section>

        <section className="panel verified-card">
          <div className="panel-title">
            <h2>Account & workspace</h2>
            <ShieldCheck size={21} />
          </div>
          <span className="verified-label">
            <ShieldCheck size={15} />
            Email verified
          </span>
          <div className="identity-detail">
            <span>Account</span>
            <strong>{user?.name}</strong>
          </div>
          <div className="identity-detail">
            <span>Workspace role</span>
            <strong>{s.workspace.role}</strong>
          </div>
          <div className="identity-detail">
            <span>Team members</span>
            <strong>{summary?.metrics?.memberCount ?? s.members.length}</strong>
          </div>
          <p>
            Your workspace is saved to your account and stays with you when you return.
          </p>
        </section>

        <section className="panel">
          <div className="panel-title">
            <div>
              <h2>Connected accounts</h2>
              <p>Your social channels, together.</p>
            </div>
            <Link to="/app/channels">
              Manage channels <ArrowRight size={14} />
            </Link>
          </div>
          <div className="channel-strip">
            {platforms.map((p) => {
              const a = s.accounts.find(
                (acc) =>
                  acc.platform.toLowerCase() === p.toLowerCase() ||
                  acc.platform === p,
              );
              const isConnected = a?.state?.toLowerCase() === "connected";
              return (
                <Link
                  className="channel-tile"
                  key={p}
                  to={"/app/channels?platform=" + p}
                >
                  <PlatformIcon platform={p} />
                  <strong>{p}</strong>
                  <small style={{ color: isConnected ? "#10b981" : undefined }}>
                    {isConnected ? "Connected" : "Not connected"}
                  </small>
                  <small>{a?.name || "1-Click OAuth connect"}</small>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="panel studio-callout">
          <Sparkles size={28} color="#ad8bff" />
          <h2>AI Studio & Brand Kit</h2>
          <p>
            Create consistent, platform-tailored posts with{" "}
            <strong>{aiProviderName}</strong>. Generate multi-channel variations,
            captions, and schedules.
          </p>
          <Button asChild variant="primary">
            <Link to="/app/studio">
              Open AI Studio <ArrowRight size={15} />
            </Link>
          </Button>
          <Link to="/app/settings">Configure your Brand Kit →</Link>
        </section>
      </div>

      <div className="overview-bottom">
        <section className="panel">
          <div className="panel-title">
            <h2>Upcoming content</h2>
            <Link to="/app/calendar">View calendar →</Link>
          </div>
          {scheduled.length ? (
            scheduled.slice(0, 4).map((p) => (
              <Link
                className="dashboard-row"
                key={p.id}
                to={"/app/compose?id=" + p.id}
              >
                <span>
                  {p.title}
                  <small>{Array.isArray(p.platforms) ? p.platforms.join(", ") : ""}</small>
                </span>
                <small>
                  {p.scheduledAt &&
                    dateLabel(p.scheduledAt, s.workspace.timezone)}
                </small>
              </Link>
            ))
          ) : (
            <Empty icon={<CalendarDays size={26} />} title="A clear calendar">
              <p>
                Scheduled content will appear here. Start by creating a post in Composer or AI Studio.
              </p>
            </Empty>
          )}
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>Platform distribution</h2>
            <span className="badge">Published & scheduled</span>
          </div>
          <div className="distribution-zero">
            <div className="distribution-ring">
              {publishedCount + scheduledCount}
            </div>
            <p>
              {publishedCount + scheduledCount > 0
                ? "Active content across your social channels."
                : "No posts yet. Content created in Composer or AI Studio will appear here."}
            </p>
          </div>
          <div className="distribution-list">
            {platforms.map((p) => {
              const countForP =
                summary?.platformCounts?.[p] ??
                s.posts.filter((post) => post.platforms.includes(p)).length;
              return (
                <div key={p}>
                  <span>{p}</span>
                  <strong>{countForP}</strong>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <h2>Recent activity</h2>
            <Link to="/app/activity">View all →</Link>
          </div>
          {recentActivity && recentActivity.length > 0 ? (
            recentActivity.slice(0, 4).map((a) => (
              <div className="dashboard-row" key={a.id}>
                <span>
                  <strong>{a.actor}</strong> {a.action}
                  <small>{a.entity}</small>
                </span>
                <small>{dateLabel(a.at, s.workspace.timezone)}</small>
              </div>
            ))
          ) : (
            <Empty title="A fresh start">
              <p>Your team’s actions and content publications will appear here.</p>
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}
