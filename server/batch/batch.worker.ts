import { Worker, UnrecoverableError } from "bullmq";
import { randomUUID } from "node:crypto";
import { pool, transaction, audit, type DB } from "../db.js";
import { redis, publishingQueue } from "../queues.js";
import { generateCaptions } from "../ai.controller.js";
import { assertEditable, validateSchedule } from "../content.controller.js";
import { serializePost } from "../workspace.controller.js";
import { createPublishPlan } from "../publish-planner.js";
import type { Platform } from "../platform-capabilities.js";
import { NotificationsService } from "../notifications/notifications.service.js";

async function executeChildItem(db: DB, item: any, workspaceId: string): Promise<any> {
  const op = item.operation_type;
  const payload = item.payload || {};

  switch (op) {
    case "ai_generation": {
      const topic = payload.topic || "AI Post Topic";
      const tone = payload.tone || "Professional";
      const goal = payload.goal || "Engagement";
      const platforms = payload.platforms || ["LinkedIn"];
      const result = await generateCaptions(topic, tone, goal, platforms);
      return { title: result.title, variants: result.variants };
    }

    case "bulk_save": {
      const id = payload.id || randomUUID();
      const title = payload.title || "Untitled Post";
      const body = payload.body || "";
      const platforms = payload.platforms || ["LinkedIn"];
      const variants = payload.variants || {};
      const userId = payload.userId || item.created_by || "00000000-0000-0000-0000-000000000000";

      const p = (
        await db.query(
          "INSERT INTO content(id, workspace_id, title, body, platforms, variants, created_by, updated_by) VALUES($1, $2, $3, $4, $5, $6, $7, $7) RETURNING *",
          [id, workspaceId, title, body, JSON.stringify(platforms), JSON.stringify(variants), userId]
        )
      ).rows[0];

      await db.query(
        "INSERT INTO content_versions(id, workspace_id, content_id, version, snapshot, created_by) VALUES($1, $2, $3, $4, $5, $6)",
        [randomUUID(), workspaceId, id, 1, JSON.stringify(payload), userId]
      );

      return { contentId: p.id, status: p.status, title: p.title };
    }

    case "bulk_approve":
    case "bulk_reject": {
      const contentId = item.target_id || payload.contentId;
      if (!contentId) throw new Error("Target content ID required for review transition.");
      const isApprove = op === "bulk_approve";
      const userId = payload.userId || "00000000-0000-0000-0000-000000000000";

      const post = (
        await db.query(
          "SELECT * FROM content WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
          [contentId, workspaceId]
        )
      ).rows[0];

      if (!post) throw new Error("Content item not found in workspace.");
      if (post.status !== "NEEDS_REVIEW") {
        throw new Error(`Content item must be in NEEDS_REVIEW state (current: ${post.status}).`);
      }

      const newStatus = isApprove ? "APPROVED" : "DRAFT";
      await db.query(
        "INSERT INTO approvals(id, workspace_id, content_id, version, actor_id, decision) VALUES($1, $2, $3, $4, $5, $6)",
        [randomUUID(), workspaceId, contentId, post.version, userId, isApprove ? "approve" : "reject"]
      );

      await db.query(
        "UPDATE content SET status = $3, approved_by = $4, version = version + 1, updated_at = NOW(), updated_by = $4 WHERE id = $1 AND workspace_id = $2",
        [contentId, workspaceId, newStatus, isApprove ? userId : null]
      );

      return { contentId, status: newStatus };
    }

    case "bulk_schedule": {
      const contentId = item.target_id || payload.contentId;
      if (!contentId) throw new Error("Target content ID required for scheduling.");
      const scheduledAtStr = payload.scheduledAt;
      const timezone = payload.timezone || "UTC";
      if (!scheduledAtStr) throw new Error("scheduledAt date timestamp required.");
      const at = new Date(scheduledAtStr);
      const userId = payload.userId || "00000000-0000-0000-0000-000000000000";

      const post = (
        await db.query(
          "SELECT * FROM content WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
          [contentId, workspaceId]
        )
      ).rows[0];
      if (!post) throw new Error("Content item not found.");

      const ws = (
        await db.query("SELECT require_approval FROM workspaces WHERE id = $1", [workspaceId])
      ).rows[0];

      validateSchedule(post.status, ws?.require_approval ?? true, at);

      const targetPlatforms = post.platforms as string[];
      for (const platform of targetPlatforms) {
        const plan = await createPublishPlan(db, post, platform as Platform, { isPublishing: false });
        const account = (
          await db.query(
            "SELECT a.id FROM social_accounts a JOIN social_account_tokens t ON t.account_id=a.id WHERE a.workspace_id=$1 AND lower(a.platform)=lower($2) AND lower(a.state)='connected'",
            [workspaceId, platform]
          )
        ).rows[0];

        if (!account) {
          throw new Error(`Connect a healthy ${platform} account before scheduling.`);
        }

        const schedId = randomUUID();
        await db.query(
          "INSERT INTO scheduled_posts(id, workspace_id, content_id, account_id, content_version, execute_at, timezone) VALUES($1, $2, $3, $4, $5, $6, $7)",
          [schedId, workspaceId, contentId, account.id, post.version + 1, at, timezone]
        );
      }

      await db.query(
        "UPDATE content SET status = 'SCHEDULED', scheduled_at = $3, timezone = $4, scheduled_by = $5, version = version + 1, updated_at = NOW() WHERE id = $1 AND workspace_id = $2",
        [contentId, workspaceId, at, timezone, userId]
      );

      return { contentId, status: "SCHEDULED", scheduledAt: at.toISOString() };
    }

    case "bulk_publish": {
      const contentId = item.target_id || payload.contentId;
      if (!contentId) throw new Error("Target content ID required for bulk publish.");

      const post = (
        await db.query(
          "SELECT * FROM content WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
          [contentId, workspaceId]
        )
      ).rows[0];
      if (!post) throw new Error("Content item not found.");

      if (post.status === "PUBLISHING") throw new Error("Post is currently being published.");
      if (post.status === "PUBLISHED") throw new Error("Post has already been published.");

      const targetPlatforms = post.platforms as string[];
      const scheduledIds: string[] = [];

      for (const platform of targetPlatforms) {
        const plan = await createPublishPlan(db, post, platform as Platform, { isPublishing: true });
        const account = (
          await db.query(
            "SELECT a.id FROM social_accounts a JOIN social_account_tokens t ON t.account_id=a.id WHERE a.workspace_id=$1 AND lower(a.platform)=lower($2) AND lower(a.state)='connected'",
            [workspaceId, platform]
          )
        ).rows[0];

        if (!account) throw new Error(`No connected ${platform} channel found in workspace.`);

        const schedId = randomUUID();
        await db.query(
          "INSERT INTO scheduled_posts(id, workspace_id, content_id, account_id, content_version, execute_at, timezone, state) VALUES($1, $2, $3, $4, $5, NOW(), 'UTC', 'ENQUEUED')",
          [schedId, workspaceId, contentId, account.id, post.version, "UTC"]
        );
        scheduledIds.push(schedId);

        // Enqueue into existing social-publishing queue to reuse existing worker!
        await publishingQueue.add("publish", { id: schedId }, { jobId: schedId });
      }

      await db.query(
        "UPDATE content SET status = 'PUBLISHING', updated_at = NOW() WHERE id = $1 AND workspace_id = $2",
        [contentId, workspaceId]
      );

      return { contentId, status: "PUBLISHING", enqueuedCount: scheduledIds.length };
    }

    default:
      throw new Error(`Unsupported batch operation type '${op}'`);
  }
}

export const batchWorker = new Worker(
  "batch-processing",
  async (job) => {
    const { batchId, workspaceId } = job.data;

    // 1. Set parent batch status to PROCESSING
    await pool.query(
      "UPDATE batch_jobs SET status = 'PROCESSING', started_at = COALESCE(started_at, NOW()), updated_at = NOW() WHERE id = $1 AND workspace_id = $2",
      [batchId, workspaceId]
    );

    // 2. Fetch pending child items
    const childItems = (
      await pool.query(
        "SELECT * FROM batch_child_items WHERE batch_id = $1 AND workspace_id = $2 AND status = 'PENDING' ORDER BY item_index ASC, created_at ASC",
        [batchId, workspaceId]
      )
    ).rows;

    for (const item of childItems) {
      // Set child status to PROCESSING
      await pool.query(
        "UPDATE batch_child_items SET status = 'PROCESSING', updated_at = NOW() WHERE id = $1",
        [item.id]
      );

      try {
        const result = await transaction(async (db) => {
          return executeChildItem(db, item, workspaceId);
        });

        // Child item succeeded!
        await pool.query(
          "UPDATE batch_child_items SET status = 'COMPLETED', result = $2, error = NULL, updated_at = NOW() WHERE id = $1",
          [item.id, JSON.stringify(result || {})]
        );
      } catch (err) {
        const errMsg = (err as Error).message || "Child item execution failed";

        // Child item failed — do NOT fail parent loop
        await pool.query(
          "UPDATE batch_child_items SET status = 'FAILED', error = $2, updated_at = NOW() WHERE id = $1",
          [item.id, errMsg]
        );
      }
    }

    // 3. Aggregate final batch counts and status
    const allItems = (
      await pool.query(
        "SELECT status FROM batch_child_items WHERE batch_id = $1 AND workspace_id = $2",
        [batchId, workspaceId]
      )
    ).rows;

    const completedCount = allItems.filter((i) => i.status === "COMPLETED").length;
    const failedCount = allItems.filter((i) => i.status === "FAILED").length;
    const totalCount = allItems.length;

    let finalStatus = "COMPLETED";
    if (completedCount === 0 && failedCount > 0) {
      finalStatus = "FAILED";
    } else if (failedCount > 0) {
      finalStatus = "PARTIAL";
    }

    await pool.query(
      `UPDATE batch_jobs 
       SET status = $1, completed_items = $2, failed_items = $3, completed_at = NOW(), updated_at = NOW() 
       WHERE id = $4 AND workspace_id = $5`,
      [finalStatus, completedCount, failedCount, batchId, workspaceId]
    );

    const notifType =
      finalStatus === "COMPLETED"
        ? "batch_completed"
        : finalStatus === "PARTIAL"
        ? "batch_partial"
        : "batch_failed";

    await NotificationsService.createNotification(pool, {
      workspaceId,
      type: notifType as any,
      title: `Batch Operation ${finalStatus.toLowerCase()}`,
      message: `Batch job finished: ${completedCount} succeeded, ${failedCount} failed out of ${totalCount} items.`,
      data: { batchId, completedCount, failedCount, totalCount, status: finalStatus },
    });

    console.log(
      JSON.stringify({
        event: "batch_completed",
        batchId,
        status: finalStatus,
        completed: completedCount,
        failed: failedCount,
        total: totalCount,
      })
    );
  },
  {
    connection: redis,
    concurrency: 3,
  }
);

batchWorker.on("failed", (j, err) => {
  console.error(JSON.stringify({ event: "batch_worker_failed", jobId: j?.id, error: err?.message }));
});
