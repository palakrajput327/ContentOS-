import { Link, useOutletContext } from "react-router-dom";
import {
  Plus,
  Sparkles,
  CalendarDays,
  CheckCheck,
  FileText,
  Radio,
  ArrowRight,
  Lightbulb,
  Users,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Button, PlatformIcon, Empty } from "../components/ui";
import { dateLabel, platforms, type Snapshot } from "../lib/model";
import { useSession } from "../lib/session";
import "../dashboard.css";
export default function Overview() {
  const s = useOutletContext<Snapshot>();
  const user = useSession((x) => x.user);
  const count = (st: string) => s.posts.filter((p) => p.status === st).length;
  const scheduled = s.posts.filter((p) => p.status === "SCHEDULED");
  const published = s.posts.filter((p) => p.status === "PUBLISHED");
  const cards = [
    [
      "Connected accounts",
      s.accounts.filter((a) => a.state === "Connected").length,
      Users,
      "Your publishing destinations",
    ],
    [
      "Scheduled posts",
      scheduled.length,
      CalendarDays,
      "Ready for the calendar",
    ],
    [
      "Published posts",
      published.length,
      Send,
      "Published from this workspace",
    ],
    ["Drafts", count("DRAFT"), FileText, "Ideas taking shape"],
    [
      "Awaiting approval",
      count("NEEDS_REVIEW"),
      CheckCheck,
      "Ready for a second look",
    ],
    ["AI processing jobs", "—", Sparkles, "AI integration not configured"],
  ] as const;
  const steps = [
    ["Source", null, Lightbulb, "#b58aff"],
    ["AI processing", null, Sparkles, "#958aff"],
    ["Draft", "DRAFT", FileText, "#77a7ff"],
    ["Review", "NEEDS_REVIEW", Users, "#74a7ff"],
    ["Approved", "APPROVED", CheckCheck, "#57d7d3"],
    ["Scheduled", "SCHEDULED", CalendarDays, "#61d5b1"],
    ["Published", "PUBLISHED", Send, "#6dd3a3"],
  ] as const;
  return (
    <>
      <div className="page-heading reference-heading">
        <div>
          <span className="overline">
            {new Intl.DateTimeFormat("en", {
              dateStyle: "full",
              timeZone: s.workspace.timezone,
            }).format(new Date())}
          </span>
          <h1>
            Hello, {user?.name?.trim() ? user.name.trim().split(" ")[0] : "there"}{" "}
            <span aria-hidden>✦</span>
          </h1>
          <p>Here’s what’s happening with your social presence.</p>
        </div>
        <Button asChild variant="primary">
          <Link to="/app/compose">
            <Plus size={17} />
            Create post
          </Link>
        </Button>
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
              <p>Track your content from idea to publication.</p>
            </div>
            <Link to="/app/library">
              View content <ArrowRight size={14} />
            </Link>
          </div>
          <div className="pipeline-steps">
            {steps.map(([label, status, Icon, color]) => (
              <Link
                className="pipeline-step"
                key={label}
                to={status ? "/app/library?status=" + status : "/app/studio"}
                style={{ "--step-color": color } as React.CSSProperties}
              >
                <i>
                  <Icon size={23} />
                </i>
                <span>{label}</span>
                <strong>{status ? count(status) : "—"}</strong>
              </Link>
            ))}
          </div>
          <small className="form-note">
            Source processing and AI jobs will be available when their
            integrations are configured.
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
            <strong>{s.members.length}</strong>
          </div>
          <p>
            Your workspace is saved to your account and stays with you when you
            return.
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
              const a = s.accounts.find((a) => a.platform === p);
              return (
                <Link
                  className="channel-tile"
                  key={p}
                  to={"/app/channels?platform=" + p}
                >
                  <PlatformIcon platform={p} />
                  <strong>{p}</strong>
                  <small>{a?.state || "Not connected"}</small>
                  <small>{a?.name || "Connect in a later setup step"}</small>
                </Link>
              );
            })}
          </div>
        </section>
        <section className="panel studio-callout">
          <Sparkles size={28} color="#ad8bff" />
          <h2>AI Studio & Brand Kit</h2>
          <p>
            Give your content a consistent voice. Set your brand now; AI
            generation requires a configured provider.
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
                  <small>{p.platforms.join(", ")}</small>
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
                Scheduled content will appear here. Start with your first draft.
              </p>
            </Empty>
          )}
        </section>
        <section className="panel">
          <div className="panel-title">
            <h2>Platform distribution</h2>
            <span className="badge">Published posts</span>
          </div>
          <div className="distribution-zero">
            <div className="distribution-ring">{published.length}</div>
            <p>
              {published.length
                ? "Published content across your channels."
                : "No published content yet. Your actual platform counts will appear here."}
            </p>
          </div>
          <div className="distribution-list">
            {platforms.map((p) => (
              <div key={p}>
                <span>{p}</span>
                <strong>
                  {
                    published.filter((post) => post.platforms.includes(p))
                      .length
                  }
                </strong>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-title">
            <h2>Recent activity</h2>
            <Link to="/app/activity">View all →</Link>
          </div>
          {s.activity.slice(0, 4).map((a) => (
            <div className="dashboard-row" key={a.id}>
              <span>
                <strong>{a.actor}</strong> {a.action}
                <small>{a.entity}</small>
              </span>
              <small>{dateLabel(a.at, s.workspace.timezone)}</small>
            </div>
          ))}
          {!s.activity.length && (
            <Empty title="A fresh start">
              <p>Your team’s actions will appear here.</p>
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}
