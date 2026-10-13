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
import { assertDailySlot } from './daily-posting.js';
import { validateSchedule } from '../content.controller.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createPublishPlan } from '../publish-planner.js';
import type { Platform } from '../platform-capabilities.js';

@WorkspaceRequired()
@Controller("calendar")
export class CalendarController {
  @Post('proposals/:id/schedule')
  async scheduleProposal(@Req() req: AuthedRequest, @Param('id') contentId: string, @Body() body: { approve?: boolean; version: number }) {
    assertPermission(req.workspace!.role, 'schedule');
    if (body.approve === true) assertPermission(req.workspace!.role, 'approve');
    if (!Number.isInteger(body.version)) throw new BadRequestException('The reviewed content version is required.');
    return this.applyScheduleToPost(req, contentId, undefined, { approve: body.approve === true, version: body.version });
  }
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
      if (!Number.isInteger(slot.day_of_week) || slot.day_of_week < 0 || slot.day_of_week > 6) {
        throw new BadRequestException("day_of_week must be between 0 (Sunday) and 6 (Saturday).");
      }
      if (!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(slot.time_of_day)) {
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
      `SELECT DISTINCT c.id, c.title, c.platforms, c.scheduled_at
       FROM content c
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
             AND sp.state IN ('PENDING','ENQUEUED')
             AND ABS(EXTRACT(EPOCH FROM (sp.execute_at - $3::timestamptz))) < 600`,
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
  private async applyScheduleToPost(req: AuthedRequest, contentId: string, scheduledAtIso?: string, proposal?: { approve: boolean; version: number }) {
    const ws = req.workspace!;
    if (!z.string().uuid().safeParse(contentId).success) throw new BadRequestException('Valid content ID required.');

    return await transaction(async (client: DB) => {
      const workspace = (await client.query('SELECT require_approval,timezone FROM workspaces WHERE id=$1 FOR UPDATE',[ws.id])).rows[0];
      const cRes = await client.query(
        `SELECT * FROM content WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
        [contentId, ws.id]
      );

      if (!cRes.rows.length) {
        throw new NotFoundException(`Content ${contentId} not found.`);
      }

      const post = cRes.rows[0];

      if (proposal) {
        if (post.version !== proposal.version) throw new BadRequestException('This post changed. Refresh and review its latest version.');
        const plan = (await client.query("SELECT proposed_at FROM knowledge_content_plans WHERE workspace_id=$1 AND content_id=$2 AND state='REVIEW' FOR UPDATE", [ws.id,contentId])).rows[0];
        if (!plan || !['NEEDS_REVIEW','APPROVED'].includes(post.status)) throw new BadRequestException('This proposal is no longer available for scheduling.');
        scheduledAtIso = new Date(plan.proposed_at).toISOString();
        if (proposal.approve && post.status === 'NEEDS_REVIEW') {
          await client.query("INSERT INTO approvals(id,workspace_id,content_id,version,actor_id,decision) VALUES($1,$2,$3,$4,$5,'approve')",[randomUUID(),ws.id,contentId,post.version,req.user!.id]);
          await client.query('UPDATE content SET approved_by=$3 WHERE id=$1 AND workspace_id=$2',[contentId,ws.id,req.user!.id]);
          await audit(client,ws.id,req.user!.id,'content_approved','content',contentId,post.title,post.status);
          post.status='APPROVED';
        }
      }
      const knowledge = (await client.query('SELECT 1 FROM knowledge_content_plans WHERE workspace_id=$1 AND content_id=$2 LIMIT 1',[ws.id,contentId])).rows.length > 0;
      const at = new Date(scheduledAtIso || '');
      const approvalStatus = post.status === 'SCHEDULED' ? (post.approved_by ? 'APPROVED' : !workspace.require_approval ? 'DRAFT' : post.status) : post.status;
      validateSchedule(approvalStatus, workspace.require_approval || knowledge, at);
      await assertDailySlot(client,ws.id,post,at);
      const accounts = (await client.query(`SELECT a.id,a.platform FROM social_accounts a JOIN social_account_tokens t ON t.account_id=a.id WHERE a.workspace_id=$1 AND lower(a.platform)=ANY($2) AND lower(a.state)='connected' AND t.ciphertext IS NOT NULL AND (t.expires_at IS NULL OR t.expires_at>now())`,[ws.id,post.platforms.map((p:string)=>p.toLowerCase())])).rows;
      if (!accounts.length || accounts.length !== post.platforms.length) throw new BadRequestException('Connect healthy publishing accounts for every target platform before scheduling.');
      for (const platform of post.platforms) await createPublishPlan(client,post,platform as Platform);
      const active = await client.query(`SELECT 1 FROM scheduled_posts WHERE workspace_id=$1 AND content_id=$2 AND state NOT IN ('PENDING','ENQUEUED','CANCELLED')`,[ws.id,contentId]);
      if(active.rows.length) throw new BadRequestException('A publishing attempt has started. This schedule cannot be changed.');
      await client.query(`UPDATE scheduled_posts SET state='CANCELLED' WHERE workspace_id=$1 AND content_id=$2`,[ws.id,contentId]);
      const version=post.version+1;
      for (const account of accounts) await client.query(`INSERT INTO scheduled_posts(id,workspace_id,content_id,account_id,content_version,execute_at,timezone) VALUES($1,$2,$3,$4,$5,$6,$7)`,[randomUUID(),ws.id,contentId,account.id,version,at,workspace.timezone]);
      await client.query(`UPDATE content SET status='SCHEDULED',scheduled_at=$3,timezone=$4,version=$5,scheduled_by=$6,updated_by=$6,updated_at=now() WHERE id=$1 AND workspace_id=$2`,[contentId,ws.id,at,workspace.timezone,version,req.user!.id]);
      await audit(client,ws.id,req.user!.id,'content_scheduled','content',contentId,post.title,post.status,{scheduledAt:scheduledAtIso});
      return {id:contentId,title:post.title,status:'SCHEDULED',scheduledAt:scheduledAtIso};


    });
  }
}
