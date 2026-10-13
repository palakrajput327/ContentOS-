import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { request } from "../lib/api";
import { useSession } from "../lib/session";
import "../pages/festival.css";
export default function DailyPostingNotice() {
  const wid = useSession((s) => s.workspaceId),
    demo = useSession((s) => s.demo);
  const query = useQuery({
    queryKey: ["daily-notice", wid],
    enabled: !demo,
    refetchInterval: 30000,
    queryFn: async () => {
      const settings = await request<{ timezone: string }>(
        "/calendar/festivals/settings",
      );
      const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: settings.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      return request<{
        target: number;
        scheduled: number;
        reserved: number;
        remaining: number;
        overTarget: number;
      }>(`/calendar/festivals/daily-capacity?date=${date}`);
    },
  });
  const data = query.data;
  if (!data) return null;
  return (
    <div role="status" className="festival-card daily-posting-notice">
      {data.scheduled === 0 ? "No posts scheduled today. " : ""}
      {data.scheduled} / {data.target} daily posts allocated · {data.reserved}{" "}
      festival slots reserved · {data.remaining} slots available.{" "}
      {data.overTarget > 0
        ? "Existing schedules exceed the target and are preserved. "
        : ""}
      <Link to="/app/festivals">Manage daily posting</Link>
    </div>
  );
}
