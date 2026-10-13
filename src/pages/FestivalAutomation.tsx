import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { request } from "../lib/api";
import { useSession } from "../lib/session";
import { Button } from "../components/ui";
import "./festival.css";

type Settings = {
  festival_automation_enabled: boolean;
  festival_auto_publish_enabled: boolean;
  festival_approval_mode: string;
  festival_social_account_ids: string[];
  festival_region: string;
  festival_language: string;
  festival_post_time: string;
  festival_prep_days: number;
  timezone: string;
  daily_posting_target: number;
};
type Job = {
  id: string;
  platform: string;
  name: string;
  state: string;
  error: string;
  providerPostId: string | null;
};
type RecordRow = {
  id: string;
  festival_id: string;
  festival_date: string;
  content_id: string;
  title: string;
  content_status: string;
  status: string;
  error_message: string;
  variants: { mediaUrl?: string };
  jobs: Job[];
};
const base = "/calendar/festivals";
export default function FestivalAutomation() {
  const wid = useSession((s) => s.workspaceId),
    demo = useSession((s) => s.demo);
  const [settings, setSettings] = useState<Settings | null>(null),
    [dirty, setDirty] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(""),
    [filter, setFilter] = useState("All");
  const [schedule, setSchedule] = useState<Record<string, string>>({});
  const config = useQuery({
    queryKey: ["festival-settings", wid],
    queryFn: () => request<Settings>(base + "/settings"),
    enabled: !demo,
  });
  const monitor = useQuery({
    queryKey: ["festival-monitor", wid],
    queryFn: () =>
      request<{
        posts: RecordRow[];
        accounts: {
          id: string;
          name: string;
          platform: string;
          eligible: boolean;
        }[];
        hasBrand: boolean;
      }>(base + "/monitor"),
    enabled: !demo,
    refetchInterval: 15000,
  });
  useEffect(() => {
    setSettings(null);
    setDirty(false);
    setPreview("");
    setMessage("");
  }, [wid]);
  useEffect(() => {
    if (config.data && !dirty) setSettings(config.data);
  }, [config.data, dirty]);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings?.timezone || "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const calendar = useQuery({
    queryKey: ["festivals", wid, settings?.festival_region, today],
    queryFn: async () => {
      const year = Number(today.slice(0, 4));
      const results = await Promise.all(
        [year, year + 1].map((y) =>
          request<{
            festivals: {
              id: string;
              name: string;
              dateForYear: string;
              category: string;
            }[];
          }>(`${base}?year=${y}&region=${settings?.festival_region || "ALL"}`),
        ),
      );
      return results
        .flatMap((r) => r.festivals)
        .filter((f) => f.dateForYear >= today)
        .slice(0, 20);
    },
    enabled: !demo && !!settings,
  });
  const capacity = useQuery({
    queryKey: ["daily-capacity", wid, today],
    queryFn: () =>
      request<{
        target: number;
        scheduled: number;
        reserved: number;
        remaining: number;
        overTarget: number;
      }>(`${base}/daily-capacity?date=${today}`),
    enabled: !demo && !!settings,
    refetchInterval: 15000,
  });
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
      await Promise.all([monitor.refetch(), capacity.refetch()]);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function change(key: keyof Settings, value: unknown) {
    setDirty(true);
    setSettings((s) => (s ? { ...s, [key]: value } : s));
  }
  function status(p: RecordRow) {
    if (p.jobs.length) {
      if (p.jobs.some((j) => j.state === "UNCERTAIN")) return "Uncertain";
      if (p.jobs.some((j) => j.state === "FAILED")) return "Failed";
      if (p.jobs.every((j) => j.state === "PUBLISHED")) return "Published";
      return "Scheduled";
    }
    if (p.status === "FAILED") return "Failed";
    return ["NEEDS_REVIEW", "APPROVED"].includes(p.content_status)
      ? "Pending Approval"
      : p.content_status || p.status;
  }
  if (demo)
    return (
      <div className="festival-page">
        <h1>Festival Automation</h1>
        <p>
          Open a connected workspace to configure automation and view real
          publishing records.
        </p>
      </div>
    );
  return (
    <div className="festival-page">
      <h1>Festival Automation</h1>
      <p>
        Branded festival posters, publishing monitoring and daily posting
        controls.
      </p>
      <p role="status">
        {message ||
          (config.error || monitor.error || calendar.error || capacity.error)
            ?.message}
      </p>
      {!settings ? (
        <p>
          {config.isPending
            ? "Loading settings…"
            : "Settings unavailable. Please reload."}
        </p>
      ) : (
        <>
          <section className="festival-card">
            <h2>Workspace controls</h2>
            <p>
              Poster generation and social publishing are separate. Publishing
              starts only after you enable it or manually approve and schedule a
              post.
            </p>
            {!monitor.data?.hasBrand && (
              <p className="festival-warning">
                Add your company details in{" "}
                <Link to="/app/settings">Brand settings</Link> before generating
                posters.
              </p>
            )}
            <div className="festival-fields">
              <label>
                <input
                  type="checkbox"
                  checked={settings.festival_automation_enabled}
                  onChange={(e) => {
                    change("festival_automation_enabled", e.target.checked);
                    if (!e.target.checked)
                      change("festival_auto_publish_enabled", false);
                  }}
                />{" "}
                Generate festival posters
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.festival_auto_publish_enabled}
                  onChange={(e) =>
                    change("festival_auto_publish_enabled", e.target.checked)
                  }
                />{" "}
                Authorize automatic social publishing
              </label>
              <label>
                Approval mode
                <select
                  value={settings.festival_approval_mode}
                  onChange={(e) =>
                    change("festival_approval_mode", e.target.value)
                  }
                >
                  <option value="MANUAL_APPROVAL">Manual approval</option>
                  <option value="AUTO_APPROVAL">Automatic approval</option>
                </select>
              </label>
              <label>
                Region
                <select
                  value={settings.festival_region}
                  onChange={(e) => change("festival_region", e.target.value)}
                >
                  {["ALL", "NORTH", "SOUTH", "EAST", "WEST"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Language
                <select
                  value={settings.festival_language}
                  onChange={(e) => change("festival_language", e.target.value)}
                >
                  <option value="EN">English</option>
                  <option value="HI">Hindi</option>
                  <option value="HINGLISH">Hinglish</option>
                </select>
              </label>
              <label>
                Posting time
                <input
                  type="time"
                  value={settings.festival_post_time}
                  onChange={(e) => change("festival_post_time", e.target.value)}
                />
              </label>
              <label>
                Timezone
                <input
                  value={settings.timezone}
                  onChange={(e) => change("timezone", e.target.value)}
                />
              </label>
              <label>
                Prepare days ahead
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={settings.festival_prep_days}
                  onChange={(e) =>
                    change("festival_prep_days", Number(e.target.value))
                  }
                />
              </label>
              <label>
                Daily posting target
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={settings.daily_posting_target}
                  onChange={(e) =>
                    change("daily_posting_target", Number(e.target.value))
                  }
                />
              </label>
            </div>
            <h3>Publishing accounts</h3>
            {monitor.data?.accounts.map((a) => (
              <label className="festival-account" key={a.id}>
                <input
                  type="checkbox"
                  disabled={
                    !a.eligible &&
                    !settings.festival_social_account_ids.includes(a.id)
                  }
                  checked={settings.festival_social_account_ids.includes(a.id)}
                  onChange={(e) =>
                    change(
                      "festival_social_account_ids",
                      e.target.checked
                        ? [...settings.festival_social_account_ids, a.id]
                        : settings.festival_social_account_ids.filter(
                            (id) => id !== a.id,
                          ),
                    )
                  }
                />
                {a.platform} · {a.name}{" "}
                {!a.eligible && (
                  <Link to="/app/channels">Reconnect / check permissions</Link>
                )}
              </label>
            ))}
            <Button
              disabled={busy || !dirty}
              variant="primary"
              onClick={() =>
                run(async () => {
                  const { settings: s } = await request<{ settings: Settings }>(
                    base + "/settings",
                    "POST",
                    Object.fromEntries(
                      [
                        "festival_automation_enabled",
                        "festival_auto_publish_enabled",
                        "festival_approval_mode",
                        "festival_social_account_ids",
                        "festival_region",
                        "festival_language",
                        "festival_post_time",
                        "festival_prep_days",
                        "timezone",
                        "daily_posting_target",
                      ].map((k) => [k, settings[k as keyof Settings]]),
                    ),
                  );
                  setDirty(false);
                  await config.refetch();
                }, "Settings saved.")
              }
            >
              Save settings
            </Button>
          </section>
          <section className="festival-card">
            <h2>Today’s posting slots</h2>
            {capacity.data && (
              <p>
                {capacity.data.scheduled} posts allocated ·{" "}
                {capacity.data.reserved} festival slots reserved ·{" "}
                {capacity.data.remaining} slots available out of{" "}
                {capacity.data.target}.{" "}
                {capacity.data.overTarget > 0
                  ? "Existing schedules exceed the target and are preserved."
                  : ""}
              </p>
            )}
            <p>
              Festival posts count once across platforms. Festival dates reserve
              capacity before normal or PDF content. Existing approved schedules
              stay in place.
            </p>
            {capacity.data?.scheduled === 0 && (
              <p className="festival-warning">
                No posts scheduled today. Review your content queue.
              </p>
            )}
          </section>
          <section className="festival-card">
            <h2>Upcoming festivals</h2>
            <div className="festival-grid">
              {calendar.data?.map((f) => (
                <article key={f.id + f.dateForYear}>
                  <strong>{f.name}</strong>
                  <p>
                    {f.dateForYear} · {f.category}
                  </p>
                  <p>
                    {monitor.data?.posts.find(
                      (p) =>
                        p.festival_id === f.id &&
                        String(p.festival_date).slice(0, 10) === f.dateForYear,
                    )?.content_status || "Not generated"}
                  </p>
                  <Button
                    disabled={busy || !monitor.data?.hasBrand}
                    onClick={() =>
                      run(async () => {
                        const r = await request<{ svg: string }>(
                          `${base}/${f.id}/preview`,
                          "POST",
                          {
                            year: Number(f.dateForYear.slice(0, 4)),
                            language: settings.festival_language,
                          },
                        );
                        setPreview(
                          "data:image/svg+xml;charset=utf-8," +
                            encodeURIComponent(r.svg),
                        );
                      }, "Preview ready.")
                    }
                  >
                    Preview poster
                  </Button>
                </article>
              ))}
            </div>
            {preview && (
              <img
                className="festival-preview"
                src={preview}
                alt="1080 by 1080 branded festival poster preview"
              />
            )}
          </section>
          <section className="festival-card">
            <h2>Publishing monitor & poster history</h2>
            <label>
              Filter
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                {[
                  "All",
                  "Scheduled",
                  "Published",
                  "Failed",
                  "Pending Approval",
                  "Uncertain",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            {!monitor.data?.posts.length && (
              <p>
                No festival records yet. Enable generation to prepare upcoming
                festivals.
              </p>
            )}
            {monitor.data?.posts
              .filter((p) => filter === "All" || status(p) === filter)
              .map((p) => (
                <article className="festival-record" key={p.id}>
                  <h3>
                    {p.title || p.festival_id} ·{" "}
                    {String(p.festival_date).slice(0, 10)}
                  </h3>
                  <strong>{status(p)}</strong>
                  {p.variants?.mediaUrl && (
                    <a
                      href={p.variants.mediaUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        className="festival-history"
                        src={p.variants.mediaUrl}
                        alt={p.title}
                      />
                    </a>
                  )}
                  <p>{p.error_message}</p>
                  {p.status === 'FAILED' && !p.content_id && <Button disabled={busy} onClick={()=>run(()=>request(`${base}/records/${p.id}/retry-generation`,'POST',{}),'Generation retry requested. The worker will retry eligible upcoming festivals.')}>Retry poster generation</Button>}
                  {p.jobs.map((j) => (
                    <p key={j.id}>
                      {j.platform} · {j.name}: {j.state}{" "}
                      {j.error && `(${j.error})`}{" "}
                      {j.error === "RECONNECT_REQUIRED" && (
                        <Link to="/app/channels">Reconnect account</Link>
                      )}{" "}
                      {j.state === "FAILED" && !j.providerPostId && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            run(
                              () =>
                                request(
                                  `${base}/jobs/${j.id}/retry`,
                                  "POST",
                                  {},
                                ),
                              "Retry requested.",
                            )
                          }
                        >
                          Retry failed account
                        </Button>
                      )}
                    </p>
                  ))}
                  {["NEEDS_REVIEW", "APPROVED"].includes(p.content_status) && (
                    <div>
                      <label>
                        Posting date and time (your browser timezone)
                        <input
                          type="datetime-local"
                          value={schedule[p.id] || ""}
                          onChange={(e) =>
                            setSchedule({ ...schedule, [p.id]: e.target.value })
                          }
                        />
                      </label>
                      <Button
                        disabled={busy || !schedule[p.id]}
                        onClick={() =>
                          run(
                            () =>
                              request(
                                `${base}/posts/${p.content_id}/approve-schedule`,
                                "POST",
                                {
                                  scheduledAt: new Date(
                                    schedule[p.id],
                                  ).toISOString(),
                                },
                              ),
                            "Approved and scheduled.",
                          )
                        }
                      >
                        Approve & schedule
                      </Button>
                    </div>
                  )}
                </article>
              ))}
          </section>
        </>
      )}
    </div>
  );
}
