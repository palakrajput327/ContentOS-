import type { Pool, PoolClient } from "pg";
import { ConflictException } from '@nestjs/common';
import { getDailyCapacity } from './daily-posting.js';
import { PostingSlotsService, type PostingSlot } from "./posting-slots.service.js";

export interface SlotCandidate {
  timestamp: string; // ISO string in UTC
  dayOfWeek: number;
  timeOfDay: string;
  platform: string | null;
  conflict: boolean;
  conflictingPostTitle?: string;
  conflictingPostId?: string;
}

export class AutoSchedulerService {
  /**
   * Gets the workspace timezone string (defaults to UTC if not set).
   */
  static async getWorkspaceTimezone(
    db: Pool | PoolClient,
    workspaceId: string
  ): Promise<string> {
    const res = await db.query(`SELECT timezone FROM workspaces WHERE id = $1`, [
      workspaceId,
    ]);
    return res.rows[0]?.timezone || "UTC";
  }

  /**
   * Finds the next conflict-free posting slot ISO string for a workspace.
   */
  static async findNextAvailableSlot(
    db: Pool | PoolClient,
    workspaceId: string,
    options: {
      startDate?: Date;
      platform?: string;
      excludePostId?: string;
    } = {}
  ): Promise<string> {
    const candidates = await this.getUpcomingSlotCandidates(db, workspaceId, {
      startDate: options.startDate || new Date(),
      platform: options.platform,
      excludePostId: options.excludePostId,
      limit: 50,
    });

    const freeSlot = candidates.find((c) => !c.conflict);

    if (freeSlot) {
      return freeSlot.timestamp;
    }

    // Fallback: If all configured slots for the next 30 days are filled, return tomorrow at 09:00 UTC
    throw new ConflictException('No free posting slots available. Configure more slots or choose a later date.');
  }

  /**
   * Generates upcoming posting slot candidates and checks for existing scheduled conflicts.
   */
  static async getUpcomingSlotCandidates(
    db: Pool | PoolClient,
    workspaceId: string,
    options: {
      startDate?: Date;
      platform?: string;
      excludePostId?: string;
      limit?: number;
    } = {}
  ): Promise<SlotCandidate[]> {
    const timezone = await this.getWorkspaceTimezone(db, workspaceId);
    const slots = await PostingSlotsService.getWorkspaceSlots(db, workspaceId);
    const enabledSlots = slots.filter((s) => s.enabled);

    if (!enabledSlots.length) {
      return [];
    }

    const startDate = options.startDate || new Date();
    const limit = options.limit || 30;

    // Fetch existing scheduled posts for workspace from now up to 60 days out
    const windowEnd = new Date(startDate.getTime() + 60 * 24 * 60 * 60 * 1000);
    const scheduledRes = await db.query(
      `SELECT DISTINCT c.id, sp.execute_at AS scheduled_at, c.title, c.platforms
       FROM scheduled_posts sp
       JOIN content c ON c.id = sp.content_id
       WHERE c.workspace_id = $1
         AND sp.execute_at >= $2
         AND sp.execute_at <= $3
         AND sp.state <> 'CANCELLED'`,
      [workspaceId, startDate.toISOString(), windowEnd.toISOString()]
    );

    const scheduledPosts = scheduledRes.rows.filter(
      (r) => !options.excludePostId || r.id !== options.excludePostId
    );

    const candidates: SlotCandidate[] = [];
    const nowMs = Date.now();

    // Iterate through days
    for (let dayOffset = 0; dayOffset < 45 && candidates.length < limit; dayOffset++) {
      const checkDate = new Date(startDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);

      // Determine day of week in workspace timezone
      const tzDayString = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "short",
      }).format(checkDate);

      const dayOfWeekMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      const dayOfWeek = dayOfWeekMap[tzDayString] ?? checkDate.getDay();

      // Find matching slots for this day of week and platform
      const matchingSlots = enabledSlots.filter(
        (s) =>
          s.day_of_week === dayOfWeek &&
          (!options.platform || !s.platform || s.platform === options.platform)
      );

      for (const slot of matchingSlots) {
        if (candidates.length >= limit) break;

        const [hours, minutes] = slot.time_of_day.split(":").map(Number);

        // Construct target ISO timestamp in workspace timezone
        const dateParts = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(checkDate);

        const yearStr = dateParts.find((p) => p.type === "year")?.value;
        const monthStr = dateParts.find((p) => p.type === "month")?.value;
        const dayStr = dateParts.find((p) => p.type === "day")?.value;

        if (!yearStr || !monthStr || !dayStr) continue;

        // Form YYYY-MM-DDTHH:mm:00 in workspace local time, then construct UTC date
        const localIso = `${yearStr}-${monthStr}-${dayStr}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
        const slotDate = this.parseDateInTimezone(localIso, timezone);

        if (!slotDate || slotDate.getTime() <= nowMs + 60 * 1000) {
          // Skip past slots or slots within 1 minute of current time
          continue;
        }

        const slotIso = slotDate.toISOString();

        // Conflict check: Check if an existing post is scheduled within 10 minutes of this slot
        const slotTime = slotDate.getTime();
        const conflicting = scheduledPosts.find((p) => {
          const postTime = new Date(p.scheduled_at).getTime();
          return Math.abs(postTime - slotTime) < 10 * 60 * 1000;
        });

        candidates.push({
          timestamp: slotIso,
          dayOfWeek,
          timeOfDay: slot.time_of_day,
          platform: slot.platform,
          conflict: !!conflicting || !(await getDailyCapacity(db,workspaceId,`${yearStr}-${monthStr}-${dayStr}`,options.excludePostId)).remaining,
          conflictingPostTitle: conflicting?.title,
          conflictingPostId: conflicting?.id,
        });
      }
    }

    return candidates;
  }

  /**
   * Helper to parse a local ISO string in a target IANA timezone into a UTC Date.
   */
  private static parseDateInTimezone(localIsoStr: string, timezone: string): Date {
    try {
      // Use Intl to calculate offset
      const d = new Date(localIsoStr + "Z");
      const targetStr = d.toLocaleString("en-US", { timeZone: timezone });
      const targetDate = new Date(targetStr);
      const utcStr = d.toLocaleString("en-US", { timeZone: "UTC" });
      const utcDate = new Date(utcStr);
      const offsetMs = targetDate.getTime() - utcDate.getTime();
      return new Date(d.getTime() - offsetMs);
    } catch {
      return new Date(localIsoStr + "Z");
    }
  }
}
