import { useState, useEffect } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Search,
  Plus,
  FileText,
  CalendarDays,
  Check,
  X,
  Copy,
  ArrowUpRight,
} from "lucide-react";
import {
  Button,
  PlatformIcon,
  StatusBadge,
  Modal,
  Empty,
} from "../components/ui";
import { data } from "../lib/api";
import { dateLabel, type Snapshot, type Post } from "../lib/model";
export default function Library({
  approvals = false,
}: {
  approvals?: boolean;
}) {
  const s = useOutletContext<Snapshot>();
  const query = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  useEffect(() => {
    setSearch(params.get("q") || "");
  }, [params]);
  const filter = approvals ? "NEEDS_REVIEW" : params.get("status") || "ALL";
  const [schedule, setSchedule] = useState<Post | null>(null);
  const [date, setDate] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const [busy, setBusy] = useState(false);
  const role = s.workspace.role;
  const canApprove = ["Owner", "Admin", "Approver"].includes(role);
  const canSchedule = ["Owner", "Admin", "Content Manager"].includes(role);
  const canEdit = ["Owner", "Admin", "Content Manager", "Editor"].includes(
    role,
  );
  const posts = s.posts.filter(
    (p) =>
      (filter === "ALL" || p.status === filter) &&
      `${p.title} ${p.body} ${p.platforms.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  async function action(p: Post, a: string, options?: unknown) {
    try {
      setBusy(true);
      if (a === "schedule") setScheduleError("");
      await data.transition(p.id, a, options);
      await query.invalidateQueries({ queryKey: ["workspace"] });
      toast.success(
        a === "schedule"
          ? "Post scheduled"
          : a === "approve"
            ? "Post approved"
            : a === "reject"
              ? "Returned to drafts"
              : "Post updated",
      );
      setSchedule(null);
    } catch (e) {
      if (a === "schedule") setScheduleError((e as Error).message);
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="overline">
            {approvals ? "A FRESH PAIR OF EYES" : "YOUR CONTENT, CONNECTED"}
          </span>
          <h1>
            {approvals
              ? "Great work is a team effort."
              : "A home for every idea."}
          </h1>
          <p>
            {approvals
              ? "Review the details. Keep the quality. Move the good work forward."
              : "From the first draft to the final word, everything lives here."}
          </p>
        </div>
        {canEdit && (
          <Button asChild variant="primary">
            <Link to="/app/compose">
              <Plus size={17} />
              Create post
            </Link>
          </Button>
        )}
      </div>
      <div className="library-toolbar">
        <div className="tabs">
          {!approvals &&
            [
              ["ALL", "All content"],
              ["DRAFT", "Drafts"],
              ["NEEDS_REVIEW", "In review"],
              ["APPROVED", "Approved"],
              ["SCHEDULED", "Scheduled"],
              ["PUBLISHED", "Published"],
              ["FAILED", "Failed"],
              ["UNCERTAIN", "Check status"],
            ].map(([v, l]) => (
              <button
                className={filter === v ? "active" : ""}
                key={v}
                onClick={() => setParams(v === "ALL" ? {} : { status: v })}
              >
                {l}
              </button>
            ))}
        </div>
        <div className="search-input">
          <Search size={17} />
          <input
            aria-label="Search content"
            placeholder="Find your content…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="content-grid">
        {posts.map((p) => (
          <article className="content-card" key={p.id}>
            <div className="content-card-head">
              <div className="row">
                {p.platforms.map((pl) => (
                  <PlatformIcon platform={pl} key={pl} />
                ))}
              </div>
              <StatusBadge status={p.status} />
            </div>
            <Link to={`/app/compose?id=${p.id}`}>
              <h2>{p.title}</h2>
              <p className="content-excerpt">{p.body}</p>
            </Link>
            <div className="content-card-meta">
              <span className="avatar tiny">{p.creator[0]}</span>
              <span>{p.creator}</span>
              <small>
                {p.scheduledAt
                  ? dateLabel(p.scheduledAt, s.workspace.timezone)
                  : "Unscheduled"}
              </small>
            </div>
            <div className="content-card-actions">
              <Button asChild variant="ghost">
                <Link to={`/app/compose?id=${p.id}`}>
                  Open <ArrowUpRight size={14} />
                </Link>
              </Button>
              {p.status === "NEEDS_REVIEW" && canApprove ? (
                <>
                  <Button
                    title="Return to drafts"
                    aria-label={`Return ${p.title} to drafts`}
                    onClick={() => action(p, "reject")}
                    disabled={busy}
                  >
                    <X size={15} />
                  </Button>
                  <Button onClick={() => action(p, "approve")} disabled={busy}>
                    <Check size={15} />
                    Approve
                  </Button>
                </>
              ) : p.status === "SCHEDULED" && canSchedule ? (
                <Button onClick={() => action(p, "cancel")} disabled={busy}>
                  Cancel schedule
                </Button>
              ) : (p.status === "APPROVED" ||
                  (!s.workspace.requireApproval && p.status === "DRAFT")) &&
                canSchedule ? (
                <Button onClick={() => setSchedule(p)}>
                  <CalendarDays size={15} />
                  Schedule
                </Button>
              ) : canEdit ? (
                <Button
                  title="Duplicate draft"
                  aria-label={`Duplicate ${p.title}`}
                  onClick={async () => {
                    try {
                      await data.save({
                        title: `${p.title} (copy)`,
                        body: p.body,
                        platforms: p.platforms,
                        variants: p.variants,
                        youtube: p.youtube,
                      });
                      await query.invalidateQueries({
                        queryKey: ["workspace"],
                      });
                      toast.success("Draft duplicated");
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}
                >
                  <Copy size={15} />
                </Button>
              ) : null}
            </div>
            {p.status === "UNCERTAIN" && (
              <p className="error">
                Publishing outcome needs manual verification. Automatic retry is
                blocked to prevent duplicates.
              </p>
            )}
          </article>
        ))}
      </div>
      {!posts.length && (
        <Empty
          icon={approvals ? <Check size={30} /> : <FileText size={30} />}
          title={approvals ? "You’re all caught up." : "No content here yet."}
        >
          <p>
            {approvals
              ? "Posts submitted for review will appear here."
              : "Try another filter, or bring your next idea to life."}
          </p>
        </Empty>
      )}
      <Modal
        open={!!schedule}
        onOpenChange={(o) => {
          if (!o) {
            setSchedule(null);
            setScheduleError("");
          }
        }}
        title="Give this post its moment."
        description={schedule?.title}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const d = new Date(date);
            if (!Number.isFinite(d.getTime()) || d.getTime() < Date.now() + 30000) {
              const message = "Choose a time at least 30 seconds in the future.";
              setScheduleError(message);
              toast.error(message);
              return;
            }
            if (schedule)
              action(schedule, "schedule", {
                scheduledAt: d.toISOString(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              });
          }}
        >
          <label>
            Publishing date and time
            <input
              type="datetime-local"
              required
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setScheduleError("");
              }}
            />
          </label>
          <p className="form-note">
            Entered in {Intl.DateTimeFormat().resolvedOptions().timeZone}.
            Displayed in your workspace timezone: {s.workspace.timezone}.
          </p>
          <p className="form-note">Choose a time at least 30 seconds ahead. Two minutes ahead gives you time to confirm.</p>
          {scheduleError && <p role="alert">{scheduleError}</p>}
          <Button type="submit" variant="primary" disabled={busy}>
            <CalendarDays size={16} />
            {busy ? "Scheduling…" : "Schedule post"}
          </Button>
        </form>
      </Modal>
    </>
  );
}
