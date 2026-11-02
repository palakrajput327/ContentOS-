import { useState, useMemo } from "react";
import { Link, useOutletContext, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  Filter,
  Calendar as CalendarIcon,
  CalendarDays,
  Layers,
  Sparkles,
  CheckCircle,
  XCircle,
  Send,
  Edit,
  Trash2,
  PartyPopper,
  Copy,
  ExternalLink,
} from "lucide-react";
import { Button, PlatformIcon, StatusBadge, Empty, ModalFrame } from "../components/ui";
import { type Snapshot, type Platform, type Status, dateLabel } from "../lib/model";
import { request } from "../lib/api";
import { toast } from "sonner";
import { PostingSlotsModal } from "../components/PostingSlotsModal";
import { BatchRescheduleModal } from "../components/BatchRescheduleModal";
import { useSession } from "../lib/session";
import {
  COMPREHENSIVE_FESTIVALS,
  getFestivalsForDate,
  getFestivalsForMonth,
  type CalendarFestival,
  type FestivalCommunity,
} from "../lib/festivals";
import "./studio-integration.css";
import "./calendar-festivals.css";

export default function Calendar() {
  const s = useOutletContext<Snapshot>();
  const nav = useNavigate();
  const query = useQueryClient();
  const demo = useSession((x) => x.demo);
  const canApprove = ["Owner", "Admin", "Approver"].includes(s.workspace.role);
  const canSchedule = ["Owner", "Admin", "Content Manager"].includes(s.workspace.role);
  const canEdit = ["Owner", "Admin", "Content Manager", "Editor"].includes(s.workspace.role);
  const [proposalBusy, setProposalBusy] = useState(false);

  async function scheduleProposal(post: Snapshot["posts"][number]) {
    setProposalBusy(true);
    try {
      await request(`/calendar/proposals/${post.id}/schedule`, "POST", {
        approve: post.status === "NEEDS_REVIEW",
        version: post.version,
      });
      await Promise.all([
        query.invalidateQueries({ queryKey: ["workspace"] }),
        query.invalidateQueries({ queryKey: ["knowledge-automation", s.workspace.id] }),
      ]);
      setDetailPostId(null);
      toast.success("Post scheduled at the proposed time");
    } catch (error: any) {
      toast.error(error.message || "Scheduling failed. Review the post and its connected accounts.");
    } finally {
      setProposalBusy(false);
    }
  }

  const proposals = useQuery({
    queryKey: ["knowledge-automation", s.workspace.id],
    queryFn: () =>
      request<{ plans: { content_id: string | null; state: string; proposed_at: string }[] }>(
        "/knowledge-automation",
      ),
    enabled: !demo,
    refetchInterval: 15000,
  });

  const festivalSettings = useQuery({
    queryKey: ["festival-settings", s.workspace.id],
    queryFn: () => request<any>("/calendar/festivals/settings"),
    enabled: !demo,
  });

  const calendarPosts = useMemo(
    () =>
      s.posts.map((post) => {
        const proposal = proposals.data?.plans.find(
          (p) => p.content_id === post.id && p.state === "REVIEW",
        );
        return {
          ...post,
          proposedAt:
            !post.scheduledAt && proposal && ["NEEDS_REVIEW", "APPROVED"].includes(post.status)
              ? proposal.proposed_at
              : undefined,
        };
      }),
    [s.posts, proposals.data],
  );

  const displayAt = (post: { scheduledAt?: string; proposedAt?: string }) =>
    post.scheduledAt || post.proposedAt;

  // Navigation & View state
  const [cursor, setCursor] = useState(new Date());
  const [view, setView] = useState<"Month" | "Week" | "Day" | "Agenda">("Month");

  // Filters state
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | "ALL">("ALL");
  const [selectedStatus, setSelectedStatus] = useState<Status | "ALL">("ALL");
  const [selectedCommunity, setSelectedCommunity] = useState<FestivalCommunity | "NONE">("ALL");

  // Drag and Drop state
  const [draggedPostId, setDraggedPostId] = useState<string | null>(null);
  const [dropTargetDate, setDropTargetDate] = useState<string | null>(null);

  // Modals state
  const [showSlotsModal, setShowSlotsModal] = useState(false);
  const [showBatchRescheduleModal, setShowBatchRescheduleModal] = useState(false);
  const [selectedPostIds, setSelectedPostIds] = useState<string[]>([]);
  const [detailPostId, setDetailPostId] = useState<string | null>(null);

  // Festival Quick Action Modal State
  const [selectedFestival, setSelectedFestival] = useState<CalendarFestival | null>(null);
  const [selectedFestivalDate, setSelectedFestivalDate] = useState<string | null>(null);
  const [activeWishLang, setActiveWishLang] = useState<"hinglish" | "hi" | "en">("hinglish");
  const [generatingDraft, setGeneratingDraft] = useState(false);

  const tz = s.workspace.timezone || "Asia/Kolkata";

  // Filtered post items
  const filteredPosts = useMemo(() => {
    return calendarPosts.filter((p) => {
      if (!displayAt(p) && view !== "Agenda") return false;
      if (selectedPlatform !== "ALL" && !p.platforms.includes(selectedPlatform)) return false;
      if (selectedStatus !== "ALL" && p.status !== selectedStatus) return false;
      return true;
    });
  }, [calendarPosts, view, selectedPlatform, selectedStatus]);

  // Date formatting helpers
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const firstDayOfMonth = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const monthOffset = (firstDayOfMonth.getDay() + 6) % 7; // Monday start

  // Month's festivals
  const festivalsInCurrentMonth = useMemo(() => {
    const list = getFestivalsForMonth(y, m);
    if (selectedCommunity === "NONE") return [];
    if (selectedCommunity === "ALL") return list;
    return list.filter((f) => f.community === selectedCommunity);
  }, [y, m, selectedCommunity]);

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

  const detailPost = calendarPosts.find((p) => p.id === detailPostId);
  const isFestivalAutoPilotOn = festivalSettings.data?.festival_automation_enabled === true;

  return (
    <div style={{ paddingBottom: "40px" }}>
      {/* Page Heading & Main Actions */}
      <div className="page-heading">
        <div>
          <span className="overline" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <PartyPopper size={14} className="text-amber-400" />
            INDIAN FESTIVALS & SOCIAL CONTENT CALENDAR
          </span>
          <h1>Your Content & Festivals, Perfectly Timed</h1>
          <p>
            Connected to <strong>Festival Automation</strong> & Timezone-aware slot placement. All times in{" "}
            <strong>{tz}</strong>.
          </p>
        </div>

        <div className="page-actions" style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={() => setShowSlotsModal(true)}>
            <Clock size={16} />
            Posting Slots
          </Button>

          <Button asChild variant="secondary">
            <Link to="/app/festivals">
              <Sparkles size={16} className={isFestivalAutoPilotOn ? "text-emerald-400" : "text-amber-400"} />
              Festival Auto-Pilot {isFestivalAutoPilotOn ? "• Active" : ""}
            </Link>
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

      {/* FESTIVAL MONTH BANNER */}
      {festivalsInCurrentMonth.length > 0 && selectedCommunity !== "NONE" && (
        <div className="festival-month-banner">
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
              <PartyPopper size={16} />
              {festivalsInCurrentMonth.length} Indian Festival{festivalsInCurrentMonth.length > 1 ? "s" : ""} in{" "}
              {cursor.toLocaleDateString("en", { month: "long", year: "numeric" })}:
            </span>
            <div className="festival-banner-chips">
              {festivalsInCurrentMonth.map((f) => (
                <span
                  key={f.id}
                  className="festival-chip"
                  style={{
                    background: "var(--surface)",
                    color: "var(--ink)",
                    borderColor: f.accentColor,
                  }}
                  onClick={() => {
                    setSelectedFestival(f);
                    setSelectedFestivalDate(f.dates[y] || null);
                  }}
                  title="Click to view details & auto-generate poster"
                >
                  <span>{f.emoji}</span>
                  <strong>{f.name}</strong>
                  <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>
                    ({new Date(f.dates[y] + "T12:00:00").toLocaleDateString("en-US", { day: "numeric", month: "short" })})
                  </span>
                </span>
              ))}
            </div>
          </div>

          <Link
            to="/app/festivals"
            style={{
              fontSize: "0.8rem",
              fontWeight: 600,
              color: "var(--accent)",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              whiteSpace: "nowrap",
              textDecoration: "none",
            }}
          >
            Auto-Pilot Setup <ExternalLink size={13} />
          </Link>
        </div>
      )}

      {/* Toolbar & Filters */}
      <div className="calendar-toolbar" style={{ flexWrap: "wrap", gap: "16px" }}>
        <div className="row" style={{ gap: "12px", alignItems: "center" }}>
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
        <div className="calendar-filters" style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          {/* Festivals Filter */}
          <select
            aria-label="Filter festivals on calendar"
            value={selectedCommunity}
            onChange={(e) => setSelectedCommunity(e.target.value as any)}
            style={{
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              color: "var(--ink)",
              padding: "6px 12px",
              fontSize: "0.85rem",
              fontWeight: 600,
            }}
          >
            <option value="ALL">🎉 All Indian Festivals (45+)</option>
            <option value="HINDU">🪔 Hindu Festivals</option>
            <option value="SIKH">ੴ Sikh Gurpurabs & Days</option>
            <option value="ISLAMIC">🌙 Islamic & Eid Days</option>
            <option value="CHRISTIAN">✝️ Christian Holidays</option>
            <option value="NATIONAL">🇮🇳 National & Observances</option>
            <option value="NONE">✕ Hide Festivals</option>
          </select>

          {/* Platform Filter */}
          <select
            aria-label="Filter calendar by platform"
            value={selectedPlatform}
            onChange={(e) => setSelectedPlatform(e.target.value as any)}
            style={{
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              color: "var(--ink)",
              padding: "6px 12px",
              fontSize: "0.85rem",
            }}
          >
            <option value="ALL">All Platforms</option>
            {["LinkedIn", "X", "Instagram", "Facebook", "Telegram", "YouTube"].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            aria-label="Filter calendar by status"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as any)}
            style={{
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              color: "var(--ink)",
              padding: "6px 12px",
              fontSize: "0.85rem",
            }}
          >
            <option value="ALL">All Statuses</option>
            {["DRAFT", "NEEDS_REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED", "FAILED"].map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>

          {/* View Tabs */}
          <div className="tabs">
            {(["Month", "Week", "Day", "Agenda"] as const).map((v) => (
              <button className={view === v ? "active" : ""} key={v} onClick={() => setView(v)}>
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
                (p) => displayAt(p) && dateToKey(new Date(displayAt(p)!)) === dateStrKey,
              );

              const rawDayFestivals = inMonth ? getFestivalsForDate(dateStrKey) : [];
              const dayFestivals =
                selectedCommunity === "NONE"
                  ? []
                  : selectedCommunity === "ALL"
                  ? rawDayFestivals
                  : rawDayFestivals.filter((f) => f.community === selectedCommunity);

              const isDropTarget = dropTargetDate === dateStrKey;
              const isToday = inMonth && cellDate.toDateString() === new Date().toDateString();
              const primaryFestival = dayFestivals[0];

              return (
                <div
                  key={i}
                  className={`calendar-cell ${!inMonth ? "outside" : ""} ${dayFestivals.length > 0 ? "has-festival" : ""} ${isDropTarget ? "drop-active" : ""}`}
                  onDragOver={(e) => inMonth && handleDragOver(e, dateStrKey)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => inMonth && handleDrop(e, dateStrKey)}
                  style={{
                    background: isDropTarget ? "rgba(99, 102, 241, 0.15)" : undefined,
                    border: isDropTarget ? "1px dashed #6366f1" : undefined,
                    transition: "all 0.15s ease",
                    // @ts-ignore
                    "--festive-bar": primaryFestival?.accentColor || undefined,
                  }}
                >
                  <div className="calendar-cell-header">
                    <span className={isToday ? "today" : ""}>{inMonth ? cellDate.getDate() : ""}</span>
                    {inMonth && (
                      <button
                        className="calendar-add-post-btn"
                        title={`Schedule new post on ${dateStrKey}`}
                        onClick={() => nav(`/app/compose?date=${dateStrKey}`)}
                      >
                        <Plus size={11} />
                      </button>
                    )}
                  </div>

                  {/* Festivals in this day cell */}
                  {inMonth && dayFestivals.length > 0 && (
                    <div style={{ marginBottom: "6px" }}>
                      {dayFestivals.slice(0, 2).map((fest) => (
                        <div
                          key={fest.id}
                          className={`festive-tag-pill community-${fest.community.toLowerCase()}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFestival(fest);
                            setSelectedFestivalDate(dateStrKey);
                          }}
                          title={`${fest.name} (${fest.nameHindi}) - Click to auto-generate post`}
                        >
                          <span className="pill-emoji">{fest.emoji}</span>
                          <span className="pill-name">{fest.name}</span>
                        </div>
                      ))}

                      {dayFestivals.length > 2 && (
                        <div
                          className="festive-more-pill"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFestival(dayFestivals[2]);
                            setSelectedFestivalDate(dateStrKey);
                          }}
                        >
                          +{dayFestivals.length - 2} more festival
                        </div>
                      )}
                    </div>
                  )}

                  {/* Posts scheduled for this day */}
                  {inMonth &&
                    dayPosts.map((p) => (
                      <div
                        key={p.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`View ${p.title}`}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setDetailPostId(p.id);
                          }
                        }}
                        draggable={!p.proposedAt}
                        onDragStart={(e) => handleDragStart(e, p.id)}
                        onClick={() => setDetailPostId(p.id)}
                        className={`calendar-post ${p.proposedAt ? "calendar-proposal" : ""}`}
                        style={{ cursor: p.proposedAt ? "pointer" : "grab" }}
                      >
                        <div className="row" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <PlatformIcon platform={p.platforms[0]} />
                          <small>
                            {new Date(displayAt(p)!).toLocaleTimeString("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                              timeZone: tz,
                            })}
                          </small>
                        </div>
                        <strong>{p.title}</strong>
                        {p.proposedAt && (
                          <span className="calendar-proposal-label">Proposed · approval needed</span>
                        )}
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* WEEK VIEW */}
      {view === "Week" && (
        <div className="calendar-scroll">
          <div className="calendar-grid" style={{ minWidth: "850px" }}>
            {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((d, idx) => {
              // Calculate day for this column of current week
              const currDay = cursor.getDay(); // 0 is Sunday
              const mondayOffset = (currDay + 6) % 7;
              const colDate = new Date(cursor);
              colDate.setDate(cursor.getDate() - mondayOffset + idx);
              const colKey = dateToKey(colDate);
              const isToday = colDate.toDateString() === new Date().toDateString();

              const dayPosts = filteredPosts.filter(
                (p) => displayAt(p) && dateToKey(new Date(displayAt(p)!)) === colKey,
              );

              const dayFestivals =
                selectedCommunity === "NONE"
                  ? []
                  : getFestivalsForDate(colKey).filter(
                      (f) => selectedCommunity === "ALL" || f.community === selectedCommunity,
                    );

              return (
                <div key={d} style={{ display: "flex", flexDirection: "column" }}>
                  <div
                    className="day-header"
                    style={{
                      borderBottom: isToday ? "2px solid var(--lime)" : "1px solid var(--border)",
                      background: isToday ? "var(--surface3)" : "var(--surface2)",
                    }}
                  >
                    <strong>{d}</strong>
                    <div style={{ fontSize: "0.85rem", color: isToday ? "var(--lime)" : "var(--muted)", marginTop: "4px" }}>
                      {colDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </div>
                  </div>

                  <div
                    className={`calendar-cell ${dayFestivals.length > 0 ? "has-festival" : ""}`}
                    style={{
                      minHeight: "380px",
                      flex: 1,
                      borderBottom: "1px solid var(--border)",
                      // @ts-ignore
                      "--festive-bar": dayFestivals[0]?.accentColor || undefined,
                    }}
                  >
                    {/* Festivals */}
                    {dayFestivals.map((fest) => (
                      <div
                        key={fest.id}
                        className={`festive-tag-pill community-${fest.community.toLowerCase()}`}
                        onClick={() => {
                          setSelectedFestival(fest);
                          setSelectedFestivalDate(colKey);
                        }}
                      >
                        <span className="pill-emoji">{fest.emoji}</span>
                        <span className="pill-name">{fest.name}</span>
                      </div>
                    ))}

                    {/* Posts */}
                    {dayPosts.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => setDetailPostId(p.id)}
                        className={`calendar-post ${p.proposedAt ? "calendar-proposal" : ""}`}
                        style={{ cursor: "pointer" }}
                      >
                        <div className="row">
                          <PlatformIcon platform={p.platforms[0]} />
                          <small>
                            {new Date(displayAt(p)!).toLocaleTimeString("en-US", {
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
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* DAY VIEW */}
      {view === "Day" && (
        <div className="panel" style={{ padding: "24px" }}>
          {(() => {
            const dayKey = dateToKey(cursor);
            const dayFestivals =
              selectedCommunity === "NONE"
                ? []
                : getFestivalsForDate(dayKey).filter(
                    (f) => selectedCommunity === "ALL" || f.community === selectedCommunity,
                  );

            const dayPosts = filteredPosts.filter(
              (p) => displayAt(p) && dateToKey(new Date(displayAt(p)!)) === dayKey,
            );

            return (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                  <div>
                    <h2 style={{ margin: "0 0 4px", fontSize: "1.4rem" }}>
                      {cursor.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                    </h2>
                    <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.85rem" }}>
                      All times in {tz}
                    </p>
                  </div>
                  <Button variant="primary" asChild>
                    <Link to={`/app/compose?date=${dayKey}`}>
                      <Plus size={16} /> Create Post for Today
                    </Link>
                  </Button>
                </div>

                {/* Festivals on this day */}
                {dayFestivals.length > 0 && (
                  <div style={{ marginBottom: "24px" }}>
                    <h4 style={{ margin: "0 0 10px", fontSize: "0.95rem", color: "var(--ink)", display: "flex", alignItems: "center", gap: "6px" }}>
                      <PartyPopper size={16} className="text-amber-400" /> Festivals Today
                    </h4>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
                      {dayFestivals.map((fest) => (
                        <div
                          key={fest.id}
                          className="panel"
                          style={{
                            padding: "16px",
                            borderRadius: "12px",
                            cursor: "pointer",
                            background: "var(--surface2)",
                            border: `1px solid ${fest.accentColor}40`,
                            transition: "all 0.15s ease",
                          }}
                          onClick={() => {
                            setSelectedFestival(fest);
                            setSelectedFestivalDate(dayKey);
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                            <span style={{ fontSize: "1.4rem" }}>{fest.emoji}</span>
                            <div>
                              <strong style={{ fontSize: "1.05rem" }}>{fest.name}</strong>
                              <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{fest.nameHindi}</div>
                            </div>
                          </div>
                          <p style={{ fontSize: "0.82rem", color: "var(--muted)", margin: "0 0 12px", lineHeight: 1.4 }}>
                            {fest.significance}
                          </p>
                          <Button variant="secondary" style={{ width: "100%", fontSize: "0.8rem" }}>
                            <Sparkles size={13} /> Auto-Generate Branded Poster
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Day's Posts */}
                <h4 style={{ margin: "0 0 12px", fontSize: "0.95rem", color: "var(--ink)" }}>
                  Scheduled Content ({dayPosts.length})
                </h4>
                {dayPosts.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {dayPosts.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => setDetailPostId(p.id)}
                        className="agenda-row"
                        style={{
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "16px",
                          borderRadius: "10px",
                          background: "var(--surface2)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                          <PlatformIcon platform={p.platforms[0]} />
                          <div>
                            <strong>{p.title}</strong>
                            <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                              {dateLabel(displayAt(p)!, tz)}
                            </div>
                          </div>
                        </div>
                        <StatusBadge status={p.status} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty title="No posts scheduled for this day">
                    <p>Click "Create Post for Today" or auto-generate a festival greeting above.</p>
                  </Empty>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* AGENDA VIEW */}
      {view === "Agenda" && (
        <div className="panel" style={{ padding: "20px" }}>
          {filteredPosts.length ? (
            filteredPosts
              .sort((a, b) => (displayAt(a) || "").localeCompare(displayAt(b) || ""))
              .map((p) => (
                <div
                  key={p.id}
                  onClick={() => setDetailPostId(p.id)}
                  className="agenda-row"
                  style={{
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px",
                    borderRadius: "8px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <PlatformIcon platform={p.platforms[0]} />
                    <div>
                      <strong>{p.title}</strong>
                      <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                        {displayAt(p) ? `${p.proposedAt ? "Proposed · " : ""}${dateLabel(displayAt(p)!, tz)}` : "Unscheduled Draft"}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <StatusBadge status={p.status} />
                    {p.status === "APPROVED" && !p.scheduledAt && (
                      <Button
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAutoSchedule(p.id);
                        }}
                      >
                        <Sparkles size={14} /> Auto-Schedule
                      </Button>
                    )}
                  </div>
                </div>
              ))
          ) : (
            <Empty title="No posts match your filters">
              <p>Schedule an approved post or create a festival post to see it on your calendar.</p>
            </Empty>
          )}
        </div>
      )}

      {/* INTERACTIVE FESTIVAL QUICK ACTION MODAL */}
      {selectedFestival && (
        <ModalFrame
          open={!!selectedFestival}
          onClose={() => setSelectedFestival(null)}
          title={`${selectedFestival.name} (${selectedFestival.nameHindi})`}
          className="calendar-dialog"
        >
          <div
            className="panel"
            style={{
              width: "100%",
              maxWidth: "580px",
              borderRadius: "16px",
              overflow: "hidden",
              background: "var(--color-bg-panel, var(--surface2))",
              border: "1px solid var(--border)",
              padding: "24px",
            }}
          >
            {/* Festival Hero Header */}
            <div
              className="festival-modal-hero"
              style={{
                background: `linear-gradient(135deg, ${selectedFestival.themeGradient[0]} 0%, ${selectedFestival.themeGradient[1]} 60%, ${selectedFestival.themeGradient[2]} 100%)`,
              }}
            >
              <div className="festival-modal-badge">
                <span>{selectedFestival.emoji}</span>
                <span>{selectedFestival.community} FESTIVAL</span>
              </div>
              <h2 style={{ fontSize: "1.5rem", fontWeight: 800, margin: "0 0 4px", color: "#ffffff" }}>
                {selectedFestival.name}
              </h2>
              <p style={{ fontSize: "1rem", color: "#fef08a", margin: "0 0 14px", fontWeight: 500 }}>
                {selectedFestival.nameHindi}
              </p>
              <div style={{ display: "flex", gap: "16px", fontSize: "0.82rem", opacity: 0.95 }}>
                <span>
                  📅{" "}
                  <strong>
                    {new Date(
                      (selectedFestivalDate || selectedFestival.dates[y] || "") + "T12:00:00",
                    ).toLocaleDateString("en-US", {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </strong>
                </span>
                <span>
                  📍 <strong>Region: {selectedFestival.region}</strong>
                </span>
              </div>
            </div>

            {/* Significance */}
            <p style={{ fontSize: "0.88rem", color: "var(--muted)", marginBottom: "18px", lineHeight: 1.5 }}>
              {selectedFestival.significance}
            </p>

            {/* Multilingual Wishes Tabs */}
            <div style={{ marginBottom: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase", color: "var(--muted)" }}>
                  Greeting Wish Preview:
                </span>
                <div style={{ display: "flex", gap: "4px" }}>
                  {(["hinglish", "hi", "en"] as const).map((lang) => (
                    <button
                      key={lang}
                      className={`festival-tab-btn ${activeWishLang === lang ? "active" : ""}`}
                      onClick={() => setActiveWishLang(lang)}
                    >
                      {lang === "hi" ? "हिंदी" : lang === "hinglish" ? "Hinglish" : "English"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="festival-wish-box">
                <h4 style={{ margin: "0 0 6px", fontSize: "0.95rem", color: "var(--ink)", fontWeight: 700 }}>
                  {selectedFestival.greetings[activeWishLang].title}
                </h4>
                <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)", lineHeight: 1.5 }}>
                  "{selectedFestival.greetings[activeWishLang].wish}"
                </p>
              </div>
            </div>

            {/* Festival Automation Status Card */}
            <div className="festival-automation-status-card">
              <div>
                <div style={{ fontWeight: 600, color: "var(--ink)", marginBottom: "2px" }}>
                  <span className={`status-indicator-dot ${isFestivalAutoPilotOn ? "active" : "inactive"}`} />
                  Festival Auto-Pilot: {isFestivalAutoPilotOn ? "Active & Automated" : "Manual Mode"}
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                  {isFestivalAutoPilotOn
                    ? "Posts for upcoming festivals are auto-generated and scheduled."
                    : "Enable Festival Automation to automatically post branded greetings."}
                </div>
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  setSelectedFestival(null);
                  nav("/app/festivals");
                }}
              >
                <Sparkles size={14} /> Manage Auto-Pilot
              </Button>
            </div>

            {/* Modal Actions */}
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", flexWrap: "wrap" }}>
              <Button variant="ghost" onClick={() => setSelectedFestival(null)}>
                Close
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const wish = selectedFestival.greetings[activeWishLang];
                  navigator.clipboard.writeText(`${wish.title}\n\n${wish.wish}`);
                  toast.success("Greeting wish copied to clipboard!");
                }}
              >
                <Copy size={15} /> Copy Wish
              </Button>
              <Button
                variant="primary"
                disabled={generatingDraft}
                onClick={async () => {
                  setGeneratingDraft(true);
                  try {
                    const targetDate = selectedFestivalDate || selectedFestival.dates[y] || "";
                    await request(`/calendar/festivals/${selectedFestival.id}/generate-draft`, "POST", {
                      year: y,
                      language: activeWishLang.toUpperCase(),
                      targetDate,
                    });
                    await query.invalidateQueries({ queryKey: ["workspace"] });
                    toast.success(`✨ Branded festival poster draft created for ${selectedFestival.name}!`);
                    setSelectedFestival(null);
                  } catch (err: any) {
                    toast.error(err.message || "Failed to generate festival draft. Check brand kit.");
                  } finally {
                    setGeneratingDraft(false);
                  }
                }}
              >
                <Sparkles size={16} /> Auto-Generate Branded Poster
              </Button>
            </div>
          </div>
        </ModalFrame>
      )}

      {/* QUICK DETAIL MODAL FOR POSTS */}
      {detailPost && (
        <ModalFrame
          open={!!detailPost}
          onClose={() => setDetailPostId(null)}
          title={detailPost.title}
          className="calendar-dialog"
        >
          <div
            className="panel"
            style={{
              width: "100%",
              maxWidth: "540px",
              borderRadius: "16px",
              overflow: "hidden",
              background: "var(--color-bg-panel, var(--surface2))",
              border: "1px solid var(--border)",
              padding: "24px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: "16px",
              }}
            >
              <div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" }}>
                  <StatusBadge status={detailPost.status} />
                  {detailPost.platforms.map((pl) => (
                    <PlatformIcon key={pl} platform={pl} />
                  ))}
                </div>
                <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0 }}>{detailPost.title}</h2>
              </div>
              <button
                onClick={() => setDetailPostId(null)}
                aria-label="Close post details"
                className="icon-button"
              >
                <XCircle size={20} />
              </button>
            </div>

            <p
              style={{
                fontSize: "0.9rem",
                color: "var(--color-text-muted)",
                background: "var(--border)",
                padding: "12px",
                borderRadius: "8px",
                marginBottom: "16px",
              }}
            >
              {detailPost.body}
            </p>

            <div style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", marginBottom: "20px" }}>
              {detailPost.proposedAt ? "Proposed time (approval and scheduling needed)" : "Scheduled time"}:{" "}
              <strong>{displayAt(detailPost) ? dateLabel(displayAt(detailPost)!, tz) : "Not scheduled"}</strong>
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <Button variant="ghost" onClick={() => setDetailPostId(null)}>
                Close
              </Button>
              {detailPost.proposedAt && canSchedule && (detailPost.status === "APPROVED" || canApprove) && (
                <Button disabled={proposalBusy} onClick={() => scheduleProposal(detailPost)}>
                  <CheckCircle size={16} />{" "}
                  {detailPost.status === "NEEDS_REVIEW" ? "Approve & schedule" : "Schedule proposed time"}
                </Button>
              )}
              {detailPost.status === "APPROVED" && canSchedule && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    handleAutoSchedule(detailPost.id);
                    setDetailPostId(null);
                  }}
                >
                  <Sparkles size={16} /> Auto-Schedule
                </Button>
              )}
              {canEdit && (
                <Button variant="primary" onClick={() => nav(`/app/compose?id=${detailPost.id}`)}>
                  <Edit size={16} /> Edit Post
                </Button>
              )}
            </div>
          </div>
        </ModalFrame>
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
