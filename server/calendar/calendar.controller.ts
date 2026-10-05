import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { assertPermission, WorkspaceRequired, type AuthedRequest } from "../security.js";
import { pool, transaction, audit, type DB } from "../db.js";
import { PostingSlotsService } from "./posting-slots.service.js";
import { AutoSchedulerService } from "./auto-scheduler.js";
import { publishingQueue } from "../queues.js";

@WorkspaceRequired()
@Controller("calendar")
export class CalendarController {
  /**
   * GET /api/v1/calendar/slots
   * Returns workspace posting slots.
   */
  @Get("slots")
  async getSlots(@Req() req: AuthedRequest) {
    const ws = req.workspace!;
    const timezone = await AutoSchedulerService.getWorkspaceTimezone(pool, ws.id);
    const slots = await PostingSlotsService.getWorkspaceSlots(pool, ws.id);
    return { slots, timezone };
  }

  /**
   * POST /api/v1/calendar/slots
   * Configures workspace recurring posting slots.
   */
  @Post("slots")
  async saveSlots(
    @Req() req: AuthedRequest,
    @Body() body: { slots: Array<{ day_of_week: number; time_of_day: string; platform?: string | null; enabled?: boolean }> }
  ) {
    const ws = req.workspace!;
    assertPermission(ws.role, "edit");

    if (!body.slots || !Array.isArray(body.slots)) {
      throw new BadRequestException("slots array is required.");
    }

    for (const slot of body.slots) {
      if (slot.day_of_week < 0 || slot.day_of_week > 6) {
        throw new BadRequestException("day_of_week must be between 0 (Sunday) and 6 (Saturday).");
      }
      if (!/^[0-2][0-9]:[0-5][0-9]$/.test(slot.time_of_day)) {
        throw new BadRequestException("time_of_day must be in HH:MM 24-hour format.");
      }
    }

    const timezone = await AutoSchedulerService.getWorkspaceTimezone(pool, ws.id);
    const updatedSlots = await PostingSlotsService.saveWorkspaceSlots(pool, ws.id, body.slots);
    return { slots: updatedSlots, timezone };
  }

  /**
   * POST /api/v1/calendar/auto-schedule/:id
   * Automatically finds the next unallocated posting slot and schedules the post.
   */
  @Post("auto-schedule/:id")
  async autoSchedule(@Req() req: AuthedRequest, @Param("id") contentId: string, @Body() body: { startDate?: string }) {
    const ws = req.workspace!;
    assertPermission(ws.role, "schedule");

    const contentRes = await pool.query(
      `SELECT * FROM content WHERE id = $1 AND workspace_id = $2`,
      [contentId, ws.id]
    );

    if (!contentRes.rows.length) {
      throw new NotFoundException("Content not found in this workspace.");
    }

    const content = contentRes.rows[0];
    const startDate = body.startDate ? new Date(body.startDate) : new Date();

    const targetIso = await AutoSchedulerService.findNextAvailableSlot(pool, ws.id, {
      startDate,
      platform: content.platforms?.[0],
      excludePostId: contentId,
    });

    return await this.applyScheduleToPost(req, contentId, targetIso);
  }

  /**
   * POST /api/v1/calendar/reschedule-item
   * Reschedules a single post with conflict warning check.
   */
  @Post("reschedule-item")
  async rescheduleItem(
    @Req() req: AuthedRequest,
    @Body() body: { contentId: string; scheduledAt: string }
  ) {
    const ws = req.workspace!;
    assertPermission(ws.role, "schedule");

    if (!body.contentId || !body.scheduledAt) {
      throw new BadRequestException("contentId and scheduledAt are required.");
    }

    const targetDate = new Date(body.scheduledAt);
    if (isNaN(targetDate.getTime()) || targetDate.getTime() <= Date.now()) {
      throw new BadRequestException("scheduledAt must be a valid future ISO timestamp.");
    }

    return await this.applyScheduleToPost(req, body.contentId, targetDate.toISOString());
  }

  /**
   * POST /api/v1/calendar/reschedule-preview
   * Previews date shifting or bulk auto-distribution before persisting.
   */
  @Post("reschedule-preview")
  async reschedulePreview(
    @Req() req: AuthedRequest,
    @Body() body: {
      mode: "shift" | "auto_distribute";
      contentIds: string[];
      shiftDays?: number;
      shiftHours?: number;
      startDate?: string;
    }
  ) {
    const ws = req.workspace!;

    if (!body.contentIds || !Array.isArray(body.contentIds) || !body.contentIds.length) {
      throw new BadRequestException("contentIds array is required.");
    }

    const contentRes = await pool.query(
      `SELECT c.id, c.title, c.platforms, sp.scheduled_at
       FROM content c
       LEFT JOIN scheduled_posts sp ON sp.content_id = c.id
       WHERE c.id = ANY($1) AND c.workspace_id = $2`,
      [body.contentIds, ws.id]
    );

    const timezone = await AutoSchedulerService.getWorkspaceTimezone(pool, ws.id);
    const previews: Array<{
      contentId: string;
      title: string;
      currentScheduledAt: string | null;
      proposedScheduledAt: string;
      conflict: boolean;
      conflictMessage?: string;
    }> = [];

    if (body.mode === "auto_distribute") {
      let baseDate = body.startDate ? new Date(body.startDate) : new Date();

      for (const item of contentRes.rows) {
        const proposedIso = await AutoSchedulerService.findNextAvailableSlot(pool, ws.id, {
          startDate: baseDate,
          platform: item.platforms?.[0],
          excludePostId: item.id,
        });

        previews.push({
          contentId: item.id,
          title: item.title,
          currentScheduledAt: item.scheduled_at,
          proposedScheduledAt: proposedIso,
          conflict: false,
        });

        // Move baseDate forward by 1 hour for next search to space out posts
        baseDate = new Date(new Date(proposedIso).getTime() + 60 * 60 * 1000);
      }
    } else {
      // Shift mode
      const shiftMs = ((body.shiftDays || 0) * 24 + (body.shiftHours || 0)) * 60 * 60 * 1000;

      for (const item of contentRes.rows) {
        const origMs = item.scheduled_at ? new Date(item.scheduled_at).getTime() : Date.now();
        const proposedIso = new Date(origMs + shiftMs).toISOString();

        // Check conflicts for proposedIso
        const conflictRes = await pool.query(
          `SELECT c.title FROM scheduled_posts sp
           JOIN content c ON c.id = sp.content_id
           WHERE c.workspace_id = $1
             AND sp.content_id != $2
             AND sp.status = 'SCHEDULED'
             AND ABS(EXTRACT(EPOCH FROM (sp.scheduled_at - $3::timestamptz))) < 600`,
          [ws.id, item.id, proposedIso]
        );

        const conflict = conflictRes.rows.length > 0;
        previews.push({
          contentId: item.id,
          title: item.title,
          currentScheduledAt: item.scheduled_at,
          proposedScheduledAt: proposedIso,
          conflict,
          conflictMessage: conflict ? `Conflicts with "${conflictRes.rows[0].title}"` : undefined,
        });
      }
    }

    return { previews, timezone };
  }

  /**
   * POST /api/v1/calendar/reschedule-bulk
   * Executes bulk reschedule across multiple posts.
   */
  @Post("reschedule-bulk")
  async rescheduleBulk(
    @Req() req: AuthedRequest,
    @Body() body: { items: Array<{ contentId: string; scheduledAt: string }> }
  ) {
    const ws = req.workspace!;
    assertPermission(ws.role, "schedule");

    if (!body.items || !Array.isArray(body.items) || !body.items.length) {
      throw new BadRequestException("items array is required.");
    }

    const results = [];
    for (const item of body.items) {
      const res = await this.applyScheduleToPost(req, item.contentId, item.scheduledAt);
      results.push(res);
    }

    return { updatedCount: results.length, items: results };
  }

  /**
   * Helper to schedule or reschedule a post in database and BullMQ queue.
   */
  private async applyScheduleToPost(req: AuthedRequest, contentId: string, scheduledAtIso: string) {
    const ws = req.workspace!;

    return await transaction(async (client: DB) => {
      const cRes = await client.query(
        `SELECT * FROM content WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [contentId, ws.id]
      );

      if (!cRes.rows.length) {
        throw new NotFoundException(`Content ${contentId} not found.`);
      }

      const post = cRes.rows[0];

      // Update content state to SCHEDULED
      await client.query(
        `UPDATE content SET status = 'SCHEDULED', scheduled_at = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3`,
        [scheduledAtIso, req.user!.id, contentId]
      );

      // Fetch active social accounts for workspace
      const accRes = await client.query(
        `SELECT id FROM social_accounts WHERE workspace_id = $1 AND platform = ANY($2)`,
        [ws.id, post.platforms || []]
      );

      // Clean up previous scheduled_posts records
      await client.query(`DELETE FROM scheduled_posts WHERE content_id = $1`, [contentId]);

      // Create new scheduled_posts entry
      const accId = accRes.rows[0]?.id || null;
      const spRes = await client.query(
        `INSERT INTO scheduled_posts (id, workspace_id, content_id, account_id, scheduled_at, status)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'SCHEDULED')
         RETURNING *`,
        [ws.id, contentId, accId, scheduledAtIso]
      );

      // Calculate delay ms for BullMQ publishing queue
      const delayMs = Math.max(0, new Date(scheduledAtIso).getTime() - Date.now());

      await publishingQueue.add(
        "publish_job",
        {
          contentId,
          workspaceId: ws.id,
          scheduledPostId: spRes.rows[0].id,
          scheduledAt: scheduledAtIso,
        },
        {
          delay: delayMs,
          jobId: `pub-${contentId}-${scheduledAtIso}`,
          removeOnComplete: true,
        }
      );

      await audit(
        client,
        ws.id,
        req.user!.id,
        "content_scheduled",
        "content",
        contentId,
        post.title || "Untitled Post",
        post.status,
        { scheduledAt: scheduledAtIso }
      );

      return {
        id: contentId,
        title: post.title,
        status: "SCHEDULED",
        scheduledAt: scheduledAtIso,
      };
    });
  }
}
