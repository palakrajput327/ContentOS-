import { useState, useEffect } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  ExternalLink,
  Layers,
  Send,
  CheckSquare,
  Square,
  RotateCw,
  MessageSquare,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
import {
  Button,
  PlatformIcon,
  StatusBadge,
  Modal,
  Empty,
} from "../components/ui";
import { data, request } from "../lib/api";
import { dateLabel, type Snapshot, type Post } from "../lib/model";
import { BatchProgressIndicator } from "../components/BatchProgressIndicator";
import { ContentDiscussionPanel } from "../components/ContentDiscussionPanel";
import { BulkDeletePostsModal } from "../components/BulkDeletePostsModal";
import { useSession } from '../lib/session';

const noDeleteIds: string[] = [];

function getLivePostUrl(platform: string, providerPostId: string): string | null {
  if (!providerPostId) return null;
  const p = (platform || "").toLowerCase();
  if (p === "linkedin") {
    return `https://www.linkedin.com/feed/update/${providerPostId}/`;
  }
  if (p === "youtube") {
    return `https://www.youtube.com/watch?v=${providerPostId}`;
  }
  if (p === "x" || p === "twitter") {
    return `https://x.com/i/web/status/${providerPostId}`;
  }
  if (p === "facebook") {
    return `https://facebook.com/${providerPostId}`;
  }
  return null;
}


export default function Library({
  approvals = false,
}: {
  approvals?: boolean;
}) {
  const s = useOutletContext<Snapshot>();
  const query = useQueryClient();
  const demo = useSession(x=>x.demo);
  const proposals = useQuery({queryKey:['knowledge-automation',s.workspace.id],queryFn:()=>request<{plans:{content_id:string|null;state:string;proposed_at:string}[]}>('/knowledge-automation'),enabled:!demo});
  async function approveAndSchedule(p: Post) {
    setBusy(true);
    try {
      await request(`/calendar/proposals/${p.id}/schedule`,'POST',{approve:true,version:p.version});
      await Promise.all([query.invalidateQueries({queryKey:['workspace']}),query.invalidateQueries({queryKey:['knowledge-automation',s.workspace.id]})]);
      toast.success('Approved and scheduled at the proposed time');
    } catch (e: any) { toast.error(e.message || 'Scheduling failed'); }
    finally { setBusy(false); }
  }
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

  // Bulk Operations State
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [showBulkScheduleModal, setShowBulkScheduleModal] = useState(false);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  useEffect(() => { setSelectedIds([]); setDeleteIds(null); }, [s.workspace.id]);
  const [bulkScheduleDate, setBulkScheduleDate] = useState("");
  const [discussionPost, setDiscussionPost] = useState<Post | null>(null);

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

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  function toggleSelectAll() {
    if (selectedIds.length === posts.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(posts.map((p) => p.id));
    }
  }

  async function handleBulkAction(endpoint: string, payload?: Record<string, any>) {
    if (!selectedIds.length) return;
    try {
      setBusy(true);
      const res = (await request(`/batch/${endpoint}`, "POST", {
        confirm: true,
        contentIds: selectedIds,
        ...payload,
      })) as { batchId: string };
      setActiveBatchId(res.batchId);
      toast.success(`Batch ${endpoint.replace("bulk-", "")} initialized for ${selectedIds.length} items!`);
      setSelectedIds([]);
      await query.invalidateQueries({ queryKey: ["workspace"] });
    } catch (e: any) {
      toast.error(e.message || "Bulk operation failed.");
    } finally {
      setBusy(false);
      setShowBulkScheduleModal(false);
    }
  }

  async function action(p: Post, a: string, options?: unknown) {
    try {
      setBusy(true);
      if (a === "schedule") setScheduleError("");

      // Approving a DRAFT: must first submit for review, then approve
      if (a === "approve" && p.status === "DRAFT") {
        await data.transition(p.id, "review");
      }

      // Scheduling a DRAFT when workspace requires approval:
      // auto-approve first if the acting user has approve permission
      if (a === "schedule" && p.status === "DRAFT" && s.workspace.requireApproval && canApprove) {
        try {
          await data.transition(p.id, "review");
          await data.transition(p.id, "approve");
        } catch {
          // already in NEEDS_REVIEW/APPROVED — continue
        }
      }

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
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {canSchedule && (
            <Button
              variant="secondary"
              onClick={() => setDeleteIds([])}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <Trash2 size={15} style={{ color: "var(--danger, #ef4444)" }} />
              Bulk Delete
            </Button>
          )}
          {canEdit && (
            <Button asChild variant="primary">
              <Link to="/app/compose">
                <Plus size={17} />
                Create post
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Active Batch Progress Bar */}
      {activeBatchId && (
        <BatchProgressIndicator
          batchId={activeBatchId}
          onComplete={() => {
            query.invalidateQueries({ queryKey: ["workspace"] });
          }}
        />
      )}

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
              ["PUBLISHING", "Publishing"],
              ["FAILED", "Failed"],
              ["UNCERTAIN", "Check status"],
            ].map(([v, l]) => (
              <button
                className={filter === v ? "active" : ""}
                key={v}
                onClick={() => {
                  setParams(v === "ALL" ? {} : { status: v });
                  setSelectedIds([]);
                }}
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

      {/* Multi-select Header Controls - Responsive Inline Actions */}
      {posts.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "10px",
            marginBottom: "16px",
            padding: "10px 14px",
            background: selectedIds.length > 0 ? "rgba(99, 102, 241, 0.08)" : "var(--surface)",
            borderRadius: "10px",
            border: selectedIds.length > 0 ? "1px solid rgba(99, 102, 241, 0.3)" : "1px solid var(--border)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            transition: "all 0.2s ease-in-out",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              type="button"
              className="text-button"
              onClick={toggleSelectAll}
              style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.85rem", cursor: "pointer", background: "none", border: "none", color: "var(--ink)" }}
            >
              {selectedIds.length === posts.length ? <CheckSquare size={18} style={{ color: "var(--success)" }} /> : <Square size={18} />}
              Select All ({posts.length} posts)
            </button>
            {selectedIds.length > 0 && (
              <span style={{ fontSize: "0.85rem", color: "var(--accent)", fontWeight: 600 }}>
                {selectedIds.length} item{selectedIds.length > 1 ? "s" : ""} selected
              </span>
            )}
          </div>

          {selectedIds.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              {canApprove && (
                <>
                  <Button variant="secondary" onClick={() => handleBulkAction("bulk-approve")} disabled={busy} style={{ fontSize: "0.82rem", padding: "6px 12px" }}>
                    <Check size={13} /> Approve
                  </Button>
                  <Button variant="secondary" onClick={() => handleBulkAction("bulk-reject")} disabled={busy} style={{ fontSize: "0.82rem", padding: "6px 12px" }}>
                    <X size={13} /> Return to Drafts
                  </Button>
                </>
              )}
              {canSchedule && (
                <>
                  <Button variant="secondary" onClick={() => setShowBulkScheduleModal(true)} disabled={busy} style={{ fontSize: "0.82rem", padding: "6px 12px" }}>
                    <CalendarDays size={13} /> Schedule
                  </Button>
                  <Button variant="primary" onClick={() => handleBulkAction("bulk-publish")} disabled={busy} style={{ fontSize: "0.82rem", padding: "6px 12px" }}>
                    <Send size={13} /> Publish Now
                  </Button>
                  <Button variant="danger" onClick={() => setDeleteIds([...selectedIds])} disabled={busy} style={{ fontSize: "0.82rem", padding: "6px 12px", display: "flex", alignItems: "center", gap: "5px" }}>
                    <Trash2 size={13} /> Delete ({selectedIds.length})
                  </Button>
                </>
              )}
              <Button variant="ghost" onClick={() => setSelectedIds([])} style={{ fontSize: "0.82rem", color: "var(--color-text-muted)", padding: "6px 10px" }}>
                Clear
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Floating Bulk Operations Bar - Light/Dark Adaptive & Responsive */}
      {selectedIds.length > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 99,
            background: "var(--surface)",
            color: "var(--ink)",
            border: "1px solid var(--border)",
            borderRadius: "14px",
            padding: "10px 18px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
            width: "max-content",
            maxWidth: "min(94vw, 880px)",
            boxShadow: "0 12px 36px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.08)",
            backdropFilter: "blur(14px)",
            animation: "overlay-in 0.2s ease-out",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Layers size={18} style={{ color: "var(--accent, #6366f1)" }} />
            <strong style={{ fontSize: "0.9rem", color: "var(--ink)" }}>{selectedIds.length} Selected</strong>
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            {canApprove && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => handleBulkAction("bulk-approve")}
                  disabled={busy}
                  style={{ fontSize: "0.85rem" }}
                >
                  <Check size={14} /> Bulk Approve
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => handleBulkAction("bulk-reject")}
                  disabled={busy}
                  style={{ fontSize: "0.85rem" }}
                >
                  <X size={14} /> Bulk Return to Drafts
                </Button>
              </>
            )}

            {canSchedule && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setShowBulkScheduleModal(true)}
                  disabled={busy}
                  style={{ fontSize: "0.85rem" }}
                >
                  <CalendarDays size={14} /> Bulk Schedule
                </Button>
                <Button
                  variant="primary"
                  onClick={() => handleBulkAction("bulk-publish")}
                  disabled={busy}
                  style={{ fontSize: "0.85rem" }}
                >
                  <Send size={14} /> Bulk Publish Now
                </Button>
                <Button
                  variant="danger"
                  onClick={() => setDeleteIds([...selectedIds])}
                  disabled={busy}
                  style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <Trash2 size={14} /> Delete Selected ({selectedIds.length})
                </Button>
              </>
            )}

            <Button
              variant="ghost"
              onClick={() => setSelectedIds([])}
              style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      <div className="content-grid">
        {posts.map((p) => {
          const isSelected = selectedIds.includes(p.id);
          return (
            <article
              className="content-card"
              key={p.id}
              style={{
                border: isSelected ? "1px solid #6366f1" : undefined,
                background: isSelected ? "rgba(99, 102, 241, 0.05)" : undefined,
              }}
            >
              <div className="content-card-head">
                <div className="row" style={{ alignItems: "center", gap: "10px" }}>
                  <button
                    type="button"
                    onClick={() => toggleSelect(p.id)}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: isSelected ? "var(--success)" : "var(--color-text-muted)" }}
                  >
                    {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                  </button>
                  {p.platforms.map((pl) => (
                    <PlatformIcon platform={pl} key={pl} />
                  ))}
                </div>
                <div className="row">
                  <StatusBadge status={p.status} />
                  {((canSchedule && !["PUBLISHING", "UNCERTAIN"].includes(p.status)) || (canEdit && p.status === "DRAFT")) && (
                    <details className="library-post-menu" onBlur={event => {
                      if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
                    }} onKeyDown={event => {
                      if (event.key === "Escape") {
                        event.currentTarget.open = false;
                        event.currentTarget.querySelector("summary")?.focus();
                      }
                    }}>
                      <summary aria-label={`Actions for ${p.title}`}><MoreHorizontal size={18} /></summary>
                      <div className="library-post-menu-items">
                        {canEdit && p.status === "DRAFT" && (
                          <button type="button" disabled={busy} onClick={() => action(p, "review")}>Send for review</button>
                        )}
                        {canApprove && p.status === "DRAFT" && (
                          <button type="button" disabled={busy} onClick={() => action(p, "approve")}><Check size={15} /> Approve</button>
                        )}
                        {canSchedule && !["PUBLISHING", "UNCERTAIN"].includes(p.status) && (
                          <button type="button" className="library-delete-action" onClick={() => setDeleteIds([p.id])}>
                            <Trash2 size={15} /> Delete post
                          </button>
                        )}
                      </div>
                    </details>
                  )}
                </div>
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
                {p.status === "PUBLISHED" && p.providerPostId && (
                  <Button asChild variant="secondary" style={{ borderColor: "rgba(10, 102, 194, 0.4)", color: "#0a66c2" }}>
                    <a
                      href={getLivePostUrl(p.platforms[0] || "linkedin", p.providerPostId) || `https://www.linkedin.com/feed/update/${p.providerPostId}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="View post on live platform"
                    >
                      Live Post <ExternalLink size={13} style={{ marginLeft: 4 }} />
                    </a>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  title="Open Discussion & Activity Timeline"
                  onClick={() => setDiscussionPost(p)}
                >
                  <MessageSquare size={14} /> Discuss
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
                    {canSchedule && proposals.data?.plans.some(plan=>plan.content_id===p.id && plan.state==='REVIEW') && (
                      <Button disabled={busy} onClick={()=>approveAndSchedule(p)}>
                        Approve & schedule · {dateLabel(proposals.data.plans.find(plan=>plan.content_id===p.id && plan.state==='REVIEW')!.proposed_at,s.workspace.timezone)}
                      </Button>
                    )}
                  </>
                ) : p.status === "SCHEDULED" && canSchedule ? (
                  <Button onClick={() => action(p, "cancel")} disabled={busy}>
                    Cancel schedule
                  </Button>
                ) : (p.status === "APPROVED" ||
                    p.status === "DRAFT") &&
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
          );
        })}
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

      {/* Bulk Schedule Modal */}
      <Modal
        open={showBulkScheduleModal}
        onOpenChange={(o) => setShowBulkScheduleModal(o)}
        title="Bulk Schedule Selected Posts"
        description={`Schedule ${selectedIds.length} posts simultaneously.`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const d = new Date(bulkScheduleDate);
            if (!Number.isFinite(d.getTime()) || d.getTime() < Date.now() + 30000) {
              toast.error("Choose a time at least 30 seconds in the future.");
              return;
            }
            handleBulkAction("bulk-schedule", { scheduledAt: d.toISOString() });
          }}
        >
          <label>
            Publishing date and time
            <input
              type="datetime-local"
              required
              value={bulkScheduleDate}
              onChange={(e) => setBulkScheduleDate(e.target.value)}
            />
          </label>
          <p className="form-note">
            Entered in {Intl.DateTimeFormat().resolvedOptions().timeZone}.
            Displayed in your workspace timezone: {s.workspace.timezone}.
          </p>
          <Button type="submit" variant="primary" disabled={busy}>
            <CalendarDays size={16} />
            {busy ? "Scheduling..." : `Schedule ${selectedIds.length} Posts`}
          </Button>
        </form>
      </Modal>

      {/* Single Item Schedule Modal */}
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

      {/* Content Discussion Panel Drawer */}
      <ContentDiscussionPanel
        open={!!discussionPost}
        onClose={() => setDiscussionPost(null)}
        post={discussionPost}
        members={s.members}
      />

      {/* Bulk Post Deletion Modal */}
      <BulkDeletePostsModal
        open={deleteIds !== null}
        onClose={() => setDeleteIds(null)}
        preselectedPostIds={deleteIds ?? noDeleteIds}
        onSuccess={() => {
          setSelectedIds([]);
          query.invalidateQueries({ queryKey: ["workspace"] });
          query.invalidateQueries({ queryKey: ["posts"] });
          query.invalidateQueries({ queryKey: ["calendar"] });
          query.invalidateQueries({ queryKey: ["knowledge-automation"] });
        }}
      />
    </>
  );
}

