import { useState, useMemo } from "react";
import { Link, useOutletContext, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  Filter,
  Calendar as CalendarIcon,
  Layers,
  Sparkles,
  CheckCircle,
  XCircle,
  Send,
  Edit,
  Trash2,
} from "lucide-react";
import { Button, PlatformIcon, StatusBadge, Empty } from "../components/ui";
import { type Snapshot, type Platform, type Status, dateLabel } from "../lib/model";
import { request } from "../lib/api";
import { toast } from "sonner";
import { PostingSlotsModal } from "../components/PostingSlotsModal";
import { BatchRescheduleModal } from "../components/BatchRescheduleModal";

export default function Calendar() {
  const s = useOutletContext<Snapshot>();
  const nav = useNavigate();
  const query = useQueryClient();

  // Navigation & View state
  const [cursor, setCursor] = useState(new Date());
  const [view, setView] = useState<"Month" | "Week" | "Day" | "Agenda">("Month");

  // Filters state
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | "ALL">("ALL");
  const [selectedStatus, setSelectedStatus] = useState<Status | "ALL">("ALL");

  // Drag and Drop state
  const [draggedPostId, setDraggedPostId] = useState<string | null>(null);
  const [dropTargetDate, setDropTargetDate] = useState<string | null>(null);

  // Modals state
  const [showSlotsModal, setShowSlotsModal] = useState(false);
  const [showBatchRescheduleModal, setShowBatchRescheduleModal] = useState(false);
  const [selectedPostIds, setSelectedPostIds] = useState<string[]>([]);
  const [detailPostId, setDetailPostId] = useState<string | null>(null);

  const tz = s.workspace.timezone || "UTC";

  // Filtered post items
  const filteredPosts = useMemo(() => {
    return s.posts.filter((p) => {
      if (!p.scheduledAt && view !== "Agenda") return false;
      if (selectedPlatform !== "ALL" && !p.platforms.includes(selectedPlatform)) return false;
      if (selectedStatus !== "ALL" && p.status !== selectedStatus) return false;
      return true;
    });
  }, [s.posts, view, selectedPlatform, selectedStatus]);

  // Date formatting helpers
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const firstDayOfMonth = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const monthOffset = (firstDayOfMonth.getDay() + 6) % 7; // Monday start

  const dateToKey = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: tz,
    }).format(d);

  // Drag and Drop Handlers
  function handleDragStart(e: React.DragEvent, postId: string) {
    e.dataTransfer.setData("text/plain", postId);
    setDraggedPostId(postId);
  }

  function handleDragOver(e: React.DragEvent, targetDateKey: string) {
    e.preventDefault();
    setDropTargetDate(targetDateKey);
  }

  function handleDragLeave() {
    setDropTargetDate(null);
  }

  async function handleDrop(e: React.DragEvent, targetDateStr: string) {
    e.preventDefault();
    setDropTargetDate(null);
    const postId = e.dataTransfer.getData("text/plain") || draggedPostId;
    if (!postId) return;

    const post = s.posts.find((p) => p.id === postId);
    if (!post) return;

    // Preserve existing scheduled time if present, else default to 09:00 local time
    const origDate = post.scheduledAt ? new Date(post.scheduledAt) : new Date();
    const hours = origDate.getHours();
    const minutes = origDate.getMinutes();

    const [targetY, targetM, targetD] = targetDateStr.split("-").map(Number);
    const newScheduledDate = new Date(targetY, targetM - 1, targetD, hours, minutes);

    try {
      await request("/calendar/reschedule-item", "POST", {
        contentId: postId,
        scheduledAt: newScheduledDate.toISOString(),
      });

      await query.invalidateQueries({ queryKey: ["workspace"] });
      toast.success(`Rescheduled "${post.title}" to ${dateLabel(newScheduledDate.toISOString(), tz)}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to reschedule post.");
    } finally {
      setDraggedPostId(null);
    }
  }

  async function handleAutoSchedule(postId: string) {
    try {
      const res = (await request(`/calendar/auto-schedule/${postId}`, "POST", {})) as {
        scheduledAt: string;
      };
      await query.invalidateQueries({ queryKey: ["workspace"] });
      toast.success(`Auto-scheduled to next available slot: ${dateLabel(res.scheduledAt, tz)}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to auto-schedule post.");
    }
  }

  const detailPost = s.posts.find((p) => p.id === detailPostId);

  return (
    <div style={{ paddingBottom: "40px" }}>
      {/* Page Heading & Main Actions */}
      <div className="page-heading">
        <div>
          <span className="overline">CALENDAR & AUTO-SCHEDULING</span>
          <h1>Your Content, Perfectly Timed</h1>
          <p>
            Timezone-aware scheduling & conflict-free auto-slot placement. All times in{" "}
            <strong>{tz}</strong>.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <Button variant="secondary" onClick={() => setShowSlotsModal(true)}>
            <Clock size={16} />
            Posting Slots
          </Button>

          {selectedPostIds.length > 0 && (
            <Button variant="secondary" onClick={() => setShowBatchRescheduleModal(true)}>
              <Layers size={16} />
              Bulk Reschedule ({selectedPostIds.length})
            </Button>
          )}

          <Button asChild variant="primary">
            <Link to="/app/library?status=APPROVED">
              <Plus size={16} />
              Schedule Content
            </Link>
          </Button>
        </div>
      </div>

      {/* Toolbar & Filters */}
      <div className="calendar-toolbar" style={{ flexWrap: "wrap", gap: "16px" }}>
        <div className="row" style={{ gap: "12px" }}>
          <h2>
            {cursor.toLocaleDateString("en", {
              month: "long",
              year: "numeric",
            })}
          </h2>
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              className="icon-button"
              aria-label="Previous"
              onClick={() => {
                if (view === "Month") setCursor(new Date(y, m - 1, 1));
                else if (view === "Week") setCursor(new Date(cursor.getTime() - 7 * 24 * 60 * 60 * 1000));
                else setCursor(new Date(cursor.getTime() - 24 * 60 * 60 * 1000));
              }}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="icon-button"
              aria-label="Next"
              onClick={() => {
                if (view === "Month") setCursor(new Date(y, m + 1, 1));
                else if (view === "Week") setCursor(new Date(cursor.getTime() + 7 * 24 * 60 * 60 * 1000));
                else setCursor(new Date(cursor.getTime() + 24 * 60 * 60 * 1000));
              }}
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <Button variant="ghost" onClick={() => setCursor(new Date())}>
            Today
          </Button>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <select
            value={selectedPlatform}
            onChange={(e) => setSelectedPlatform(e.target.value as any)}
            style={{
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "8px",
              color: "#fff",
              padding: "6px 12px",
              fontSize: "0.85rem",
            }}
          >
            <option value="ALL">All Platforms</option>
            {["LinkedIn", "X", "Instagram", "Telegram", "YouTube"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as any)}
            style={{
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "8px",
              color: "#fff",
              padding: "6px 12px",
              fontSize: "0.85rem",
            }}
          >
            <option value="ALL">All Statuses</option>
            {["DRAFT", "NEEDS_REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED", "FAILED"].map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>

          <div className="tabs">
            {(["Month", "Week", "Day", "Agenda"] as const).map((v) => (
              <button
                className={view === v ? "active" : ""}
                key={v}
                onClick={() => setView(v)}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* MONTH VIEW */}
      {view === "Month" && (
        <div className="calendar-scroll">
          <div className="calendar-grid">
            {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((d) => (
              <div className="day-header" key={d}>
                {d}
              </div>
            ))}
            {Array.from({ length: Math.ceil((monthOffset + daysInMonth) / 7) * 7 }, (_, i) => {
              const dayNum = i - monthOffset + 1;
              const inMonth = dayNum > 0 && dayNum <= daysInMonth;
              const cellDate = new Date(y, m, dayNum, 12);
              const dateStrKey = `${y}-${String(m + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;

              const dayPosts = filteredPosts.filter(
                (p) => p.scheduledAt && dateToKey(new Date(p.scheduledAt)) === dateStrKey
              );

              const isDropTarget = dropTargetDate === dateStrKey;

              return (
                <div
                  key={i}
                  className={`calendar-cell ${!inMonth ? "outside" : ""} ${isDropTarget ? "drop-active" : ""}`}
                  onDragOver={(e) => inMonth && handleDragOver(e, dateStrKey)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => inMonth && handleDrop(e, dateStrKey)}
                  style={{
                    background: isDropTarget ? "rgba(99, 102, 241, 0.15)" : undefined,
                    border: isDropTarget ? "1px dashed #6366f1" : undefined,
                    transition: "all 0.15s ease",
                  }}
                >
                  <span className={cellDate.toDateString() === new Date().toDateString() ? "today" : ""}>
                    {cellDate.getDate()}
                  </span>

                  {inMonth &&
                    dayPosts.map((p) => (
                      <div
                        key={p.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, p.id)}
                        onClick={() => setDetailPostId(p.id)}
                        className="calendar-post"
                        style={{ cursor: "grab" }}
                      >
                        <div className="row">
                          <PlatformIcon platform={p.platforms[0]} />
                          <small>
                            {new Date(p.scheduledAt!).toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                              timeZone: tz,
                            })}
                          </small>
                        </div>
                        <strong>{p.title}</strong>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AGENDA VIEW */}
      {view === "Agenda" && (
        <div className="panel" style={{ padding: "20px" }}>
          {filteredPosts.length ? (
            filteredPosts
              .sort((a, b) => (a.scheduledAt || "").localeCompare(b.scheduledAt || ""))
              .map((p) => (
                <div
                  key={p.id}
                  onClick={() => setDetailPostId(p.id)}
                  className="agenda-row"
                  style={{ cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px", borderRadius: "8px" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <PlatformIcon platform={p.platforms[0]} />
                    <div>
                      <strong>{p.title}</strong>
                      <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                        {p.scheduledAt ? dateLabel(p.scheduledAt, tz) : "Unscheduled Draft"}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <StatusBadge status={p.status} />
                    {p.status === "APPROVED" && !p.scheduledAt && (
                      <Button variant="ghost" onClick={(e) => { e.stopPropagation(); handleAutoSchedule(p.id); }}>
                        <Sparkles size={14} /> Auto-Schedule
                      </Button>
                    )}
                  </div>
                </div>
              ))
          ) : (
            <Empty title="No posts match your filters">
              <p>Schedule an approved post to see it on your calendar.</p>
            </Empty>
          )}
        </div>
      )}

      {/* QUICK DETAIL MODAL */}
      {detailPost && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div
            className="panel"
            style={{
              width: "100%",
              maxWidth: "540px",
              borderRadius: "16px",
              overflow: "hidden",
              background: "var(--color-bg-panel, #18181b)",
              border: "1px solid rgba(255,255,255,0.12)",
              padding: "24px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
              <div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
                  <StatusBadge status={detailPost.status} />
                  {detailPost.platforms.map((pl) => (
                    <PlatformIcon key={pl} platform={pl} />
                  ))}
                </div>
                <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0 }}>{detailPost.title}</h2>
              </div>
              <button onClick={() => setDetailPostId(null)} className="icon-button">
                <XCircle size={20} />
              </button>
            </div>

            <p style={{ fontSize: "0.9rem", color: "var(--color-text-muted)", background: "rgba(255,255,255,0.03)", padding: "12px", borderRadius: "8px", marginBottom: "16px" }}>
              {detailPost.body}
            </p>

            <div style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", marginBottom: "20px" }}>
              Scheduled Time: <strong>{detailPost.scheduledAt ? dateLabel(detailPost.scheduledAt, tz) : "Not Scheduled"}</strong>
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={() => setDetailPostId(null)}>Close</Button>
              {detailPost.status === "APPROVED" && (
                <Button variant="secondary" onClick={() => { handleAutoSchedule(detailPost.id); setDetailPostId(null); }}>
                  <Sparkles size={16} /> Auto-Schedule
                </Button>
              )}
              <Button variant="primary" onClick={() => nav(`/app/compose?id=${detailPost.id}`)}>
                <Edit size={16} /> Edit Post
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* POSTING SLOTS MODAL */}
      <PostingSlotsModal
        isOpen={showSlotsModal}
        onClose={() => setShowSlotsModal(false)}
        onSaved={() => query.invalidateQueries({ queryKey: ["workspace"] })}
      />

      {/* BATCH RESCHEDULE MODAL */}
      <BatchRescheduleModal
        isOpen={showBatchRescheduleModal}
        onClose={() => setShowBatchRescheduleModal(false)}
        selectedContentIds={selectedPostIds}
        onRescheduled={() => query.invalidateQueries({ queryKey: ["workspace"] })}
      />
    </div>
  );
}
