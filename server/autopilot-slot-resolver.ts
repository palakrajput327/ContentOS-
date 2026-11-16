import type { Pool, PoolClient } from "pg";
import type { DB } from "./db.js";
import { PostingSlotsService } from "./calendar/posting-slots.service.js";
import { getDailyCapacity } from "./calendar/daily-posting.js";

export interface ResolvedAutopilotSlot {
  executeAt: Date;
  timezone: string;
  formattedLocal: string;
}

/**
 * Resolves the next available eligible time slot for a manual post based on
 * the workspace's configured Autopilot schedule, timezone, daily capacity,
 * and existing scheduled posts (preventing slot collisions).
 */
export async function resolveNextAutopilotSlot(
  db: Pool | PoolClient | DB,
  workspaceId: string,
  platforms: string[],
  postId?: string,
): Promise<ResolvedAutopilotSlot> {
  // 1. Fetch workspace timezone & fallback settings
  const ws = (
    await db.query(
      "SELECT timezone, festival_post_time FROM workspaces WHERE id = $1",
      [workspaceId],
    )
  ).rows[0];
  const timezone = ws?.timezone || "Asia/Kolkata";

  // 2. Fetch configured recurring slots
  const configuredSlots = await PostingSlotsService.getWorkspaceSlots(
    db as any,
    workspaceId,
  );

  // 3. Fetch knowledge automation autopilot time string (e.g. "10:00, 14:00, 18:00")
  const autoSettings = (
    await db.query(
      "SELECT posting_time FROM knowledge_automation_settings WHERE workspace_id = $1",
      [workspaceId],
    )
  ).rows[0];

  const now = new Date();
  const requiredPlatformSlots = Array.isArray(platforms) ? Math.max(1, platforms.length) : 1;

  // Search forward up to 14 days
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    // Determine the date in the workspace's timezone
    const targetDate = new Date(now.getTime() + dayOffset * 86400000);
    const dayStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(targetDate);

    // Get day of week in workspace timezone (0 = Sunday, 1 = Monday, ...)
    const weekdayStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "narrow",
    }).format(targetDate);
    // Safer day of week calculation via Date in timezone
    const dayOfWeek = new Date(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }).format(targetDate),
    ).getDay();

    // Check daily capacity limit for this day
    const capacity = await getDailyCapacity(db, workspaceId, dayStr, postId);
    if (capacity.remaining < requiredPlatformSlots) {
      // Day is already full; move to the next day
      continue;
    }

    // Determine eligible times of day for this day
    const eligibleTimes: string[] = [];

    // Check slots configured in posting_slots table for this dayOfWeek
    const daySlots = configuredSlots
      .filter((s) => s.enabled && s.day_of_week === dayOfWeek)
      .map((s) => s.time_of_day);

    if (daySlots.length > 0) {
      eligibleTimes.push(...daySlots);
    } else if (autoSettings?.posting_time) {
      // Fallback to comma-separated posting times from knowledge automation settings
      const parsed = String(autoSettings.posting_time)
        .split(",")
        .map((t) => t.trim())
        .filter((t) => /^[0-2][0-9]:[0-5][0-9]$/.test(t));
      if (parsed.length > 0) eligibleTimes.push(...parsed);
    }

    // Default fallback if no slots configured
    if (eligibleTimes.length === 0) {
      eligibleTimes.push("09:00", "14:00", "18:00");
    }

    // Sort times chronologically
    const sortedTimes = Array.from(new Set(eligibleTimes)).sort((a, b) => {
      const [hA, mA] = a.split(":").map(Number);
      const [hB, mB] = b.split(":").map(Number);
      return hA * 60 + mA - (hB * 60 + mB);
    });

    for (const timeStr of sortedTimes) {
      const localIso = `${dayStr}T${timeStr}:00`;
      const timeRes = await db.query(
        "SELECT ($1::timestamp AT TIME ZONE $2) AS slot_utc",
        [localIso, timezone],
      );
      const slotUtc: Date = timeRes.rows[0]?.slot_utc;
      if (!slotUtc) continue;

      const slotTimestamp = new Date(slotUtc).getTime();

      // Must be at least 2 minutes in the future
      if (slotTimestamp <= Date.now() + 120000) {
        continue;
      }

      // Check collision: Ensure no other post is scheduled within 10 minutes of this slot
      const collision = await db.query(
        `SELECT 1 FROM scheduled_posts 
         WHERE workspace_id = $1 
           AND ($3::uuid IS NULL OR content_id <> $3)
           AND state NOT IN ('CANCELLED', 'FAILED') 
           AND ABS(EXTRACT(EPOCH FROM (execute_at - $2::timestamptz))) < 600 
         LIMIT 1`,
        [workspaceId, slotUtc, postId || null],
      );

      if (collision.rowCount && collision.rowCount > 0) {
        // Slot is already taken; try next slot
        continue;
      }

      // Free, valid slot found!
      const formattedLocal = new Intl.DateTimeFormat("en-IN", {
        timeZone: timezone,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(slotUtc));

      return {
        executeAt: new Date(slotUtc),
        timezone,
        formattedLocal,
      };
    }
  }

  // Fallback: If all configured slots across 14 days were filled, schedule for tomorrow at 10:00
  const fallbackDate = new Date(now.getTime() + 86400000);
  const fallbackDayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(fallbackDate);

  const fallbackRes = await db.query(
    "SELECT ($1::timestamp AT TIME ZONE $2) AS slot_utc",
    [`${fallbackDayStr}T10:00:00`, timezone],
  );
  const fallbackUtc = new Date(fallbackRes.rows[0]?.slot_utc || fallbackDate);

  return {
    executeAt: fallbackUtc,
    timezone,
    formattedLocal: new Intl.DateTimeFormat("en-IN", {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(fallbackUtc),
  };
}

