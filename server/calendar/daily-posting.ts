import type { Pool, PoolClient } from "pg";
import type { DB } from "../db.js";
import { ConflictException } from "@nestjs/common";
import { listFestivalsForYear } from "./festival.data.js";

export function dailyCapacity(
  target: number,
  scheduled: number,
  festivals: number,
  scheduledFestivals: number,
) {
  const reserved = Math.max(0, festivals - scheduledFestivals);
  return {
    target,
    scheduled,
    reserved,
    remaining: Math.max(0, target - scheduled - reserved),
    overTarget: Math.max(0, scheduled + reserved - target),
  };
}

export async function getDailyCapacity(
  db: Pool | PoolClient | DB,
  workspaceId: string,
  date: string,
  excludeId?: string,
) {
  const ws = (
    await db.query(
      "SELECT timezone, daily_posting_target, festival_automation_enabled, festival_region FROM workspaces WHERE id=$1",
      [workspaceId],
    )
  ).rows[0];
  const rows = (
    await db.query(
      `SELECT DISTINCT c.id, c.variants FROM content c JOIN scheduled_posts s ON s.content_id=c.id AND s.workspace_id=c.workspace_id
    WHERE c.workspace_id=$1 AND (s.execute_at AT TIME ZONE $2)::date=$3::date
    AND s.state <> 'CANCELLED' AND ($4::uuid IS NULL OR c.id<>$4)`,
      [workspaceId, ws.timezone, date, excludeId || null],
    )
  ).rows;
  const festivals = ws.festival_automation_enabled
    ? listFestivalsForYear(Number(date.slice(0, 4)), {
        region: ws.festival_region,
      }).filter((f) => f.dateForYear === date).length
    : 0;
  return dailyCapacity(
    ws.daily_posting_target,
    rows.length,
    festivals,
    rows.filter(
      (r) => r.variants?.metadata?.content_source === "INDIAN_FESTIVAL_ENGINE",
    ).length,
  );
}

// All schedule writers take the same workspace lock before checking capacity.
// Existing approved schedules are never moved to make room for new automation.
export async function assertDailySlot(
  db: DB,
  workspaceId: string,
  post: any,
  at: Date,
) {
  const ws = (
    await db.query("SELECT timezone FROM workspaces WHERE id=$1 FOR UPDATE", [
      workspaceId,
    ])
  ).rows[0];
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: ws.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  const capacity = await getDailyCapacity(db, workspaceId, date, post.id);
  if (
    post.variants?.metadata?.content_source !== "INDIAN_FESTIVAL_ENGINE" &&
    !capacity.remaining
  )
    throw new ConflictException(
      "Daily posting target reached or slots reserved for festivals. Choose another date.",
    );
  const conflict = await db.query(
    `SELECT 1 FROM scheduled_posts WHERE workspace_id=$1 AND content_id<>$2
    AND state <> 'CANCELLED' AND ABS(EXTRACT(EPOCH FROM (execute_at-$3::timestamptz))) < 600 LIMIT 1`,
    [workspaceId, post.id, at],
  );
  if (conflict.rows.length)
    throw new ConflictException(
      "Another post occupies this time. Choose a slot at least 10 minutes apart.",
    );
}
