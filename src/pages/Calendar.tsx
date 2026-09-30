import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button, PlatformIcon, Empty } from "../components/ui";
import { type Snapshot, dateLabel } from "../lib/model";
export default function Calendar() {
  const s = useOutletContext<Snapshot>();
  const [cursor, setCursor] = useState(new Date());
  const [view, setView] = useState("Month");
  const y = cursor.getFullYear(),
    m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const days = new Date(y, m + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const posts = s.posts.filter((p) => p.scheduledAt);
  const key = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: s.workspace.timezone,
    }).format(d);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="overline">A LITTLE FORWARD THINKING</span>
          <h1>Your content, in good time.</h1>
          <p>
            A shared calendar for a consistent presence. All times in{" "}
            {s.workspace.timezone}.
          </p>
        </div>
        <Button asChild variant="primary">
          <Link to="/app/library?status=APPROVED">
            <Plus size={16} />
            Schedule content
          </Link>
        </Button>
      </div>
      <div className="calendar-toolbar">
        <div className="row">
          <h2>
            {cursor.toLocaleDateString("en", {
              month: "long",
              year: "numeric",
            })}
          </h2>
          <button
            className="icon-button"
            aria-label="Previous month"
            onClick={() => setCursor(new Date(y, m - 1, 1))}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="Next month"
            onClick={() => setCursor(new Date(y, m + 1, 1))}
          >
            <ChevronRight size={18} />
          </button>
          <Button variant="ghost" onClick={() => setCursor(new Date())}>
            Today
          </Button>
        </div>
        <div className="tabs">
          {["Month", "Agenda"].map((v) => (
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
      {view === "Month" ? (
        <div className="calendar-scroll">
          <div className="calendar-grid">
            {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((d) => (
              <div className="day-header" key={d}>
                {d}
              </div>
            ))}
            {Array.from(
              { length: Math.ceil((offset + days) / 7) * 7 },
              (_, i) => {
                const day = i - offset + 1;
                const inMonth = day > 0 && day <= days;
                const d = new Date(y, m, day, 12);
                const p = posts.filter(
                  (p) =>
                    key(new Date(p.scheduledAt!)) ===
                    `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
                );
                return (
                  <div
                    key={i}
                    className={`calendar-cell ${!inMonth ? "outside" : ""}`}
                  >
                    <span
                      className={
                        d.toDateString() === new Date().toDateString()
                          ? "today"
                          : ""
                      }
                    >
                      {d.getDate()}
                    </span>
                    {inMonth &&
                      p.map((p) => (
                        <Link
                          className="calendar-post"
                          to={`/app/compose?id=${p.id}`}
                          key={p.id}
                        >
                          <div className="row">
                            <PlatformIcon platform={p.platforms[0]} />
                            <small>
                              {new Date(p.scheduledAt!).toLocaleTimeString(
                                "en",
                                {
                                  hour: "numeric",
                                  minute: "2-digit",
                                  timeZone: s.workspace.timezone,
                                },
                              )}
                            </small>
                          </div>
                          <strong>{p.title}</strong>
                        </Link>
                      ))}
                  </div>
                );
              },
            )}
          </div>
        </div>
      ) : (
        <div className="panel">
          {posts.length ? (
            posts
              .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))
              .map((p) => (
                <Link
                  key={p.id}
                  to={`/app/compose?id=${p.id}`}
                  className="agenda-row"
                >
                  <PlatformIcon platform={p.platforms[0]} />
                  <strong>{p.title}</strong>
                  <span>{dateLabel(p.scheduledAt!, s.workspace.timezone)}</span>
                </Link>
              ))
          ) : (
            <Empty title="Your calendar is open">
              <p>Schedule an approved post to get started.</p>
            </Empty>
          )}
        </div>
      )}
      <p className="form-note">
        Reschedule a post by cancelling its schedule in the content library,
        then selecting a new time.
      </p>
    </>
  );
}
