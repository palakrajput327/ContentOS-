import { pool, transaction, type DB } from "../db.js";
import { decryptToken } from "../security.js";
import { SocialPlatformDeleteService, type PlatformDeleteResult } from "./social-platform-delete.service.js";
import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";

export interface DeletionFilterOptions {
  workspaceId: string;
  scope: "all" | "today" | "custom_range" | "selected_ids";
  channel?: string; // "all", "linkedin", "telegram", "facebook", "instagram", "x", "youtube"
  startDate?: string; // ISO date string or YYYY-MM-DD
  endDate?: string; // ISO date string or YYYY-MM-DD
  postIds?: string[]; // Array of scheduled_posts.id or content.id
  state?: string; // "ALL", "PUBLISHED", "SCHEDULED", "FAILED", "DRAFT", etc.
  timezone?: string; // e.g. "Asia/Kolkata" or "UTC"
}

export interface DeletionExecutionOptions extends DeletionFilterOptions {
  userId: string;
  role: string;
  deleteFromPlatform?: boolean; // default true
  confirm: boolean; // must be true
}

export interface PostPreviewItem {
  id: string; // scheduled_post id (or content id for drafts)
  contentId: string | null;
  title: string;
  snippet: string;
  platform: string;
  accountName: string;
  state: string;
  providerPostId: string | null;
  executeAt: string | null;
  createdAt: string;
  canDeleteFromPlatform: boolean;
}

export interface DeletionLogItem {
  id: string;
  title: string;
  platform: string;
  status: "DELETED" | "FAILED" | "SKIPPED";
  platformDeleted: boolean;
  message: string;
}

export class PostDeletionService {
  /**
   * Builds SQL where conditions and parameter list from filter options
   */
  private static buildFilterConditions(opts: DeletionFilterOptions) {
    const conditions: string[] = ["sp.workspace_id = $1"];
    const params: any[] = [opts.workspaceId];
    let paramIndex = 2;

    // Channel filter
    if (opts.channel && opts.channel.toLowerCase() !== "all") {
      conditions.push(`LOWER(a.platform) = LOWER($${paramIndex})`);
      params.push(opts.channel.trim());
      paramIndex++;
    }

    // State filter
    if (opts.state && opts.state.toUpperCase() !== "ALL") {
      conditions.push(`UPPER(sp.state) = UPPER($${paramIndex})`);
      params.push(opts.state.trim());
      paramIndex++;
    }

    // Scope: today
    if (opts.scope === "today") {
      const tz = opts.timezone || "Asia/Kolkata";
      conditions.push(`
        (
          (sp.execute_at AT TIME ZONE $${paramIndex})::date = (NOW() AT TIME ZONE $${paramIndex})::date
          OR
          (sp.execute_at IS NULL AND (sp.created_at AT TIME ZONE $${paramIndex})::date = (NOW() AT TIME ZONE $${paramIndex})::date)
        )
      `);
      params.push(tz);
      paramIndex++;
    }

    // Scope: custom_range
    if (opts.scope === "custom_range") {
      if (opts.startDate) {
        const start = new Date(opts.startDate);
        if (!isNaN(start.getTime())) {
          conditions.push(`COALESCE(sp.execute_at, sp.created_at) >= $${paramIndex}`);
          params.push(start.toISOString());
          paramIndex++;
        }
      }
      if (opts.endDate) {
        const end = new Date(opts.endDate);
        if (!isNaN(end.getTime())) {
          // If date without time (e.g. YYYY-MM-DD), extend to end of day
          if (opts.endDate.length <= 10) {
            end.setHours(23, 59, 59, 999);
          }
          conditions.push(`COALESCE(sp.execute_at, sp.created_at) <= $${paramIndex}`);
          params.push(end.toISOString());
          paramIndex++;
        }
      }
    }

    if (opts.scope === "selected_ids" && (!Array.isArray(opts.postIds) || !opts.postIds.length)) {
      throw new BadRequestException("Select at least one post.");
    }

    // Scope: selected_ids (matches scheduled_posts.id or content.id)
    if (opts.scope === "selected_ids" && Array.isArray(opts.postIds) && opts.postIds.length > 0) {
      conditions.push(`(sp.id = ANY($${paramIndex}) OR sp.content_id = ANY($${paramIndex}))`);
      params.push(opts.postIds);
      paramIndex++;
    }

    return { whereClause: conditions.join(" AND "), params };
  }

  private static async unscheduledSelection(opts: DeletionFilterOptions) {
    if (opts.scope !== "selected_ids") return [];
    return (await pool.query(
      `SELECT c.id AS scheduled_post_id,c.id AS content_id,c.status AS post_state,
              c.title,c.body,c.created_at AS post_created_at,'Local' AS platform
       FROM content c
       WHERE c.workspace_id=$1 AND c.id=ANY($2::uuid[])
         AND c.status IN ('DRAFT','NEEDS_REVIEW','APPROVED','FAILED')
         AND ($3::text IS NULL OR upper(c.status)=upper($3))
         AND ($4::text IS NULL OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(c.platforms) AS platform(name)
           WHERE lower(platform.name)=lower($4)
         ))
         AND NOT EXISTS (SELECT 1 FROM scheduled_posts sp WHERE sp.workspace_id=c.workspace_id AND sp.content_id=c.id)`,
      [opts.workspaceId, opts.postIds, opts.state && opts.state.toUpperCase() !== "ALL" ? opts.state : null,
        opts.channel && opts.channel.toLowerCase() !== "all" ? opts.channel : null],
    )).rows;
  }

  private static async deleteUnscheduledContent(db: DB, workspaceId: string, contentId: string) {
    await db.query("DELETE FROM content_comments WHERE workspace_id=$1 AND content_id=$2", [workspaceId, contentId]).catch(() => {});
    await db.query("DELETE FROM content_sources WHERE workspace_id=$1 AND content_id=$2", [workspaceId, contentId]).catch(() => {});
    await db.query("DELETE FROM video_renders WHERE content_id=$1", [contentId]).catch(() => {});
    for (const table of ["content_versions", "approvals", "knowledge_content_plans"]) {
      await db.query(`DELETE FROM ${table} WHERE workspace_id=$1 AND content_id=$2`, [workspaceId, contentId]).catch(() => {});
    }
    await db.query("DELETE FROM content WHERE workspace_id=$1 AND id=$2", [workspaceId, contentId]);
  }

  /**
   * Previews matching posts according to the selected filter criteria
   */
  static async getDeletionPreview(opts: DeletionFilterOptions): Promise<{
    totalMatching: number;
    items: PostPreviewItem[];
    breakdownByChannel: Record<string, number>;
    breakdownByStatus: Record<string, number>;
    canDeletePlatformCount: number;
  }> {
    const { whereClause, params } = this.buildFilterConditions(opts);

    const query = `
      SELECT 
        sp.id as scheduled_post_id,
        sp.content_id,
        sp.account_id,
        sp.state as post_state,
        sp.provider_post_id,
        sp.execute_at,
        sp.created_at as post_created_at,
        a.platform,
        a.name as account_name,
        c.title,
        c.body
      FROM scheduled_posts sp
      JOIN social_accounts a ON a.id = sp.account_id
      LEFT JOIN content c ON c.id = sp.content_id
      WHERE ${whereClause}
      ORDER BY COALESCE(sp.execute_at, sp.created_at) DESC
      LIMIT 250
    `;

    const res = await pool.query(query, params);

    const items: PostPreviewItem[] = [];
    const breakdownByChannel: Record<string, number> = {};
    const breakdownByStatus: Record<string, number> = {};
    let canDeletePlatformCount = 0;

    const rows = [...res.rows, ...await this.unscheduledSelection(opts)].slice(0, 250);
    for (const r of rows) {
      const plat = (r.platform || "Unknown").toLowerCase();
      breakdownByChannel[plat] = (breakdownByChannel[plat] || 0) + 1;

      const st = r.post_state || "UNKNOWN";
      breakdownByStatus[st] = (breakdownByStatus[st] || 0) + 1;

      const canPlatform = Boolean(
        st === "PUBLISHED" &&
        r.provider_post_id &&
        ["telegram", "linkedin", "facebook", "instagram", "x", "twitter", "youtube"].includes(plat)
      );
      if (canPlatform) canDeletePlatformCount++;

      const bodyClean = (r.body || "").replace(/<[^>]*>?/gm, "").trim();
      const snippet = bodyClean.length > 90 ? bodyClean.slice(0, 87) + "..." : bodyClean;

      items.push({
        id: r.scheduled_post_id,
        contentId: r.content_id,
        title: r.title || "Untitled Post",
        snippet: snippet || (r.title || "No preview available"),
        platform: r.platform || "Unknown",
        accountName: r.account_name || r.platform || "Channel",
        state: st,
        providerPostId: r.provider_post_id || null,
        executeAt: r.execute_at ? new Date(r.execute_at).toISOString() : null,
        createdAt: new Date(r.post_created_at).toISOString(),
        canDeleteFromPlatform: canPlatform,
      });
    }

    return {
      totalMatching: rows.length,
      items,
      breakdownByChannel,
      breakdownByStatus,
      canDeletePlatformCount,
    };
  }

  /**
   * Executes bulk deletion with platform synchronization and safety guards
   */
  static async executeBulkDeletion(opts: DeletionExecutionOptions): Promise<{
    success: boolean;
    totalRequested: number;
    deletedFromPlatform: number;
    deletedFromDatabase: number;
    failed: number;
    skipped: number;
    logs: DeletionLogItem[];
  }> {
    if (opts.confirm !== true) {
      throw new BadRequestException("Explicit confirmation is required to execute post deletion.");
    }

    const { whereClause, params } = this.buildFilterConditions(opts);

    // Fetch full records including credentials for deletion
    const query = `
      SELECT 
        sp.id as scheduled_post_id,
        sp.content_id,
        sp.account_id,
        sp.state as post_state,
        sp.provider_post_id,
        sp.execute_at,
        sp.created_at as post_created_at,
        a.platform,
        a.name as account_name,
        a.provider_id as account_destination,
        t.ciphertext,
        c.id as c_id,
        c.title,
        c.body
      FROM scheduled_posts sp
      JOIN social_accounts a ON a.id = sp.account_id
      LEFT JOIN social_account_tokens t ON t.account_id = a.id
      LEFT JOIN content c ON c.id = sp.content_id
      WHERE ${whereClause}
      ORDER BY COALESCE(sp.execute_at, sp.created_at) DESC
    `;

    const res = await pool.query(query, params);
    const rows = res.rows;

    const logs: DeletionLogItem[] = [];
    let deletedFromPlatform = 0;
    let deletedFromDatabase = 0;
    let failed = 0;
    let skipped = 0;

    const shouldDeleteFromPlatform = opts.deleteFromPlatform !== false;


    const unscheduled = await this.unscheduledSelection(opts);
    for (const row of unscheduled) {
      try {
        await transaction(async db => {
          const content = (await db.query("SELECT status FROM content WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
            [opts.workspaceId, row.content_id])).rows[0];
          const scheduled = await db.query("SELECT 1 FROM scheduled_posts WHERE workspace_id=$1 AND content_id=$2 LIMIT 1",
            [opts.workspaceId, row.content_id]);
          if (!content || content.status !== row.post_state || scheduled.rowCount) {
            throw new Error("Post changed after preview. Refresh the selection.");
          }
          await this.deleteUnscheduledContent(db, opts.workspaceId, row.content_id);
        });
        deletedFromDatabase++;
        logs.push({ id: row.content_id, title: row.title, platform: "Local", status: "DELETED",
          platformDeleted: false, message: "Removed from the Content Library." });
      } catch (error) {
        failed++;
        logs.push({ id: row.content_id, title: row.title, platform: "Local", status: "FAILED",
          platformDeleted: false, message: (error as Error).message });
      }
    }

    for (const row of rows) {
      if (["PROCESSING", "UNCERTAIN"].includes(row.post_state) ||
          (row.post_state === "PUBLISHED" && (!row.provider_post_id || !shouldDeleteFromPlatform))) {
        skipped++;
        logs.push({ id: row.scheduled_post_id, title: row.title, platform: row.platform, status: "SKIPPED",
          platformDeleted: false, message: "Resolve the publishing outcome or enable platform deletion first." });
        continue;
      }
      const isPublished = row.post_state === "PUBLISHED";
      const hasProviderId = Boolean(row.provider_post_id && row.provider_post_id.trim());
      let platformDeleted = false;
      let platformDeleteError: string | undefined;

      // 1. External Social Platform Deletion (if published live)
      if (shouldDeleteFromPlatform && isPublished && hasProviderId) {
        let token = "";
        try {
          token = decryptToken(row.ciphertext, opts.workspaceId);
        } catch {
          try {
            token = decryptToken(row.ciphertext, `${opts.workspaceId}:${row.account_id}`);
          } catch {
            if (row.platform.toLowerCase() === "telegram" && process.env.TELEGRAM_BOT_TOKEN) {
              token = process.env.TELEGRAM_BOT_TOKEN.trim();
            }
          }
        }

        const deleteOutcome: PlatformDeleteResult = await SocialPlatformDeleteService.deleteFromPlatform(
          row.platform,
          { token, destination: row.account_destination },
          row.provider_post_id
        );

        if (deleteOutcome.success && deleteOutcome.platformDeleted) {
          platformDeleted = true;
          deletedFromPlatform++;
        } else {
          platformDeleteError = deleteOutcome.error || "Platform API deletion rejected.";
        }
      }

      // 2. Strict Safety Rule: "Never delete unrelated content or local records when platform deletion fails."
      if (shouldDeleteFromPlatform && isPublished && hasProviderId && !platformDeleted) {
        // Platform deletion failed: preserve database record, log error, and flag failure
        failed++;
        await pool.query(
          `UPDATE scheduled_posts SET error_code = $1 WHERE id = $2`,
          [`PLATFORM_DELETE_FAILED: ${platformDeleteError}`, row.scheduled_post_id]
        ).catch((err) => {
          console.warn("[PostDeletionService] Failed to set error_code on scheduled_post:", err?.message || err);
        });

        logs.push({
          id: row.scheduled_post_id,
          title: row.title || "Untitled Post",
          platform: row.platform,
          status: "FAILED",
          platformDeleted: false,
          message: `Platform deletion failed: ${platformDeleteError}. Database record preserved.`,
        });
        continue;
      }

      // 3. Platform deletion succeeded or was not published: safe to delete locally!
      try {
        await transaction(async db => {
          await db.query("SELECT id FROM content WHERE workspace_id=$1 AND id=$2 FOR UPDATE", [opts.workspaceId, row.content_id]);
          const current = (await db.query("SELECT state,provider_post_id FROM scheduled_posts WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
            [opts.workspaceId, row.scheduled_post_id])).rows[0];
          if (!current || current.state !== row.post_state || current.provider_post_id !== row.provider_post_id) {
            throw new Error("Post changed after preview. Refresh the selection.");
          }
          await db.query("DELETE FROM published_posts WHERE workspace_id=$1 AND scheduled_post_id=$2", [opts.workspaceId, row.scheduled_post_id]);
          await db.query("DELETE FROM scheduled_posts WHERE workspace_id=$1 AND id=$2", [opts.workspaceId, row.scheduled_post_id]);
          const remaining = await db.query("SELECT 1 FROM scheduled_posts WHERE workspace_id=$1 AND content_id=$2 LIMIT 1",
            [opts.workspaceId, row.content_id]);
          if (!remaining.rowCount) await this.deleteUnscheduledContent(db, opts.workspaceId, row.content_id);
        });
        deletedFromDatabase++;

        logs.push({
          id: row.scheduled_post_id,
          title: row.title || "Untitled Post",
          platform: row.platform,
          status: "DELETED",
          platformDeleted,
          message: platformDeleted
            ? `Successfully deleted from ${row.platform} and removed from local schedule.`
            : `Removed from local schedule and database.`,
        });
      } catch (dbErr: any) {
        failed++;
        logs.push({
          id: row.scheduled_post_id,
          title: row.title || "Untitled Post",
          platform: row.platform,
          status: "FAILED",
          platformDeleted,
          message: `Local database delete failed: ${dbErr.message}`,
        });
      }
    }

    // 5. Synchronize document visual concepts: if any dispatched concept was deleted, mark back as PENDING
    try {
      await pool.query(
        `UPDATE document_visual_concepts
         SET status = 'PENDING', dispatched_at = NULL, updated_at = NOW()
         WHERE workspace_id = $1 AND status = 'DISPATCHED' AND NOT EXISTS (
           SELECT 1 FROM content c
           JOIN scheduled_posts sp ON sp.content_id = c.id
           WHERE c.title = document_visual_concepts.concept_title
         )`,
        [opts.workspaceId]
      );
    } catch {}

    // 6. Record in activity logs
    try {
      await pool.query(
        `INSERT INTO activity_logs (id, workspace_id, actor_id, action, entity_type, entity_id, entity, new_value)
         VALUES ($1, $2, $3, 'bulk_deleted', 'scheduled_posts', $1, 'Bulk Post Deletion', $4::jsonb)`,
        [
          randomUUID(),
          opts.workspaceId,
          opts.userId,
          JSON.stringify({
            scope: opts.scope,
            channel: opts.channel,
            totalRequested: rows.length + unscheduled.length,
            deletedFromPlatform,
            deletedFromDatabase,
            failed,
          }),
        ]
      );
    } catch {}

    return {
      success: deletedFromDatabase > 0,
      totalRequested: rows.length + unscheduled.length,
      deletedFromPlatform,
      deletedFromDatabase,
      failed,
      skipped,
      logs,
    };
  }
}
