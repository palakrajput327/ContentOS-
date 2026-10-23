import { getStorageProvider } from '../storage/storage.factory.js';
import { assertDailySlot } from '../calendar/daily-posting.js';
import { randomUUID } from "node:crypto";
import { pool, transaction } from "../db.js";
import { publishingQueue } from "../queues.js";
import { generateCaptions } from "../ai.controller.js";
import { validateSchedule } from "../content.controller.js";
import { createPublishPlan } from "../publish-planner.js";
import { NotificationsService } from "../notifications/notifications.service.js";
export async function executeChildItem(db, item, workspaceId, saveForReview = false) {
    const op = item.operation_type;
    const payload = item.payload || {};
    switch (op) {
        case "ai_generation": {
            const topic = payload.topic || "AI Post Topic";
            const tone = payload.tone || "Professional";
            const goal = payload.goal || "Engagement";
            const platforms = payload.platforms || ["LinkedIn"];
            const brand = (await db.query('SELECT data FROM brand_kits WHERE workspace_id=$1', [workspaceId])).rows[0]?.data || {};
            const result = await generateCaptions(topic, tone, goal, platforms, brand);
            // By default: Always use images extracted from PDF if available in source evidence
            let autoVisualUrl;
            let autoVisualAssetId;
            const evidence = payload.sourceEvidence || [];
            const preferredAssetId = evidence.find((e) => e.sourceMediaAssetId)?.sourceMediaAssetId;
            const docId = evidence[0]?.documentId;
            const pageNum = evidence[0]?.pageStart;
            if (preferredAssetId) {
                const imgRow = (await db.query('SELECT bucket, object_key, id FROM media_assets WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL', [preferredAssetId, workspaceId])).rows[0];
                if (imgRow) {
                    const { provider } = getStorageProvider();
                    autoVisualUrl = await provider.getSignedDownloadUrl(imgRow.bucket, imgRow.object_key, 7 * 86400);
                    autoVisualAssetId = imgRow.id;
                }
            }
            if (!autoVisualAssetId && docId) {
                let imgRow;
                if (pageNum) {
                    imgRow = (await db.query('SELECT m.bucket, m.object_key, m.id FROM document_source_media dsm JOIN media_assets m ON m.id = dsm.media_asset_id WHERE dsm.document_id = $1 AND dsm.workspace_id = $2 AND dsm.page_number = $3 AND m.deleted_at IS NULL LIMIT 1', [docId, workspaceId, pageNum])).rows[0];
                }
                if (!imgRow) {
                    imgRow = (await db.query('SELECT m.bucket, m.object_key, m.id FROM document_source_media dsm JOIN media_assets m ON m.id = dsm.media_asset_id WHERE dsm.document_id = $1 AND dsm.workspace_id = $2 AND m.deleted_at IS NULL ORDER BY dsm.page_number ASC LIMIT 1', [docId, workspaceId])).rows[0];
                }
                if (imgRow) {
                    const { provider } = getStorageProvider();
                    autoVisualUrl = await provider.getSignedDownloadUrl(imgRow.bucket, imgRow.object_key, 7 * 86400);
                    autoVisualAssetId = imgRow.id;
                }
            }
            const variants = Object.fromEntries(Object.entries(result.variants).map(([platform, caption]) => [
                platform,
                {
                    caption,
                    metadata: { sourceEvidence: payload.sourceEvidence || [] },
                    ...(autoVisualUrl && ["Instagram", "LinkedIn", "Facebook", "Telegram"].includes(platform)
                        ? { mediaUrl: autoVisualUrl, mediaType: "image", mediaAssetId: autoVisualAssetId }
                        : {}),
                },
            ]));
            const saved = await executeChildItem(db, { ...item, operation_type: 'bulk_save', payload: { title: result.title, body: Object.values(result.variants)[0] || topic, platforms, variants, userId: payload.userId } }, workspaceId, true);
            return { ...saved, title: result.title, variants: result.variants };
        }
        case "bulk_save": {
            const id = payload.id || randomUUID();
            const title = payload.title || "Untitled Post";
            const body = payload.body || "";
            const platforms = payload.platforms || ["LinkedIn"];
            const variants = payload.variants || {};
            const userId = payload.userId || item.created_by || "00000000-0000-0000-0000-000000000000";
            const p = (await db.query("INSERT INTO content(id, workspace_id, title, body, platforms, variants, created_by, updated_by,status) VALUES($1, $2, $3, $4, $5, $6, $7, $7,$8) RETURNING *", [id, workspaceId, title, body, JSON.stringify(platforms), JSON.stringify(variants), userId, saveForReview ? 'NEEDS_REVIEW' : 'DRAFT'])).rows[0];
            await db.query("INSERT INTO content_versions(id, workspace_id, content_id, version, snapshot, created_by) VALUES($1, $2, $3, $4, $5, $6)", [randomUUID(), workspaceId, id, 1, JSON.stringify(payload), userId]);
            return { contentId: p.id, status: p.status, title: p.title };
        }
        case "bulk_approve":
        case "bulk_reject": {
            const contentId = item.target_id || payload.contentId;
            if (!contentId)
                throw new Error("Target content ID required for review transition.");
            const isApprove = op === "bulk_approve";
            const userId = payload.userId || "00000000-0000-0000-0000-000000000000";
            const post = (await db.query("SELECT * FROM content WHERE id = $1 AND workspace_id = $2 FOR UPDATE", [contentId, workspaceId])).rows[0];
            if (!post)
                throw new Error("Content item not found in workspace.");
            if (post.status !== "NEEDS_REVIEW") {
                throw new Error(`Content item must be in NEEDS_REVIEW state (current: ${post.status}).`);
            }
            const newStatus = isApprove ? "APPROVED" : "DRAFT";
            await db.query("INSERT INTO approvals(id, workspace_id, content_id, version, actor_id, decision) VALUES($1, $2, $3, $4, $5, $6)", [randomUUID(), workspaceId, contentId, post.version, userId, isApprove ? "approve" : "reject"]);
            await db.query("UPDATE content SET status = $3, approved_by = $4, version = version + 1, updated_at = NOW(), updated_by = $5 WHERE id = $1 AND workspace_id = $2", [contentId, workspaceId, newStatus, isApprove ? userId : null, userId]);
            return { contentId, status: newStatus };
        }
        case "bulk_schedule": {
            const contentId = item.target_id || payload.contentId;
            if (!contentId)
                throw new Error("Target content ID required for scheduling.");
            const scheduledAtStr = payload.scheduledAt;
            const timezone = payload.timezone || "UTC";
            if (!scheduledAtStr)
                throw new Error("scheduledAt date timestamp required.");
            const at = new Date(scheduledAtStr);
            const userId = payload.userId || "00000000-0000-0000-0000-000000000000";
            const post = (await db.query("SELECT * FROM content WHERE id = $1 AND workspace_id = $2 FOR UPDATE", [contentId, workspaceId])).rows[0];
            if (!post)
                throw new Error("Content item not found.");
            const ws = (await db.query("SELECT require_approval FROM workspaces WHERE id = $1", [workspaceId])).rows[0];
            validateSchedule(post.status, ws?.require_approval ?? true, at);
            await assertDailySlot(db, workspaceId, post, at);
            const targetPlatforms = post.platforms;
            for (const platform of targetPlatforms) {
                const plan = await createPublishPlan(db, post, platform, { isPublishing: false });
                const account = (await db.query("SELECT a.id FROM social_accounts a JOIN social_account_tokens t ON t.account_id=a.id WHERE a.workspace_id=$1 AND lower(a.platform)=lower($2) AND lower(a.state)='connected'", [workspaceId, platform])).rows[0];
                if (!account) {
                    throw new Error(`Connect a healthy ${platform} account before scheduling.`);
                }
                const schedId = randomUUID();
                await db.query("INSERT INTO scheduled_posts(id, workspace_id, content_id, account_id, content_version, execute_at, timezone) VALUES($1, $2, $3, $4, $5, $6, $7)", [schedId, workspaceId, contentId, account.id, post.version + 1, at, timezone]);
            }
            await db.query("UPDATE content SET status = 'SCHEDULED', scheduled_at = $3, timezone = $4, scheduled_by = $5, version = version + 1, updated_at = NOW() WHERE id = $1 AND workspace_id = $2", [contentId, workspaceId, at, timezone, userId]);
            return { contentId, status: "SCHEDULED", scheduledAt: at.toISOString() };
        }
        case "bulk_publish": {
            const contentId = item.target_id || payload.contentId;
            if (!contentId)
                throw new Error("Target content ID required for bulk publish.");
            const post = (await db.query("SELECT * FROM content WHERE id = $1 AND workspace_id = $2 FOR UPDATE", [contentId, workspaceId])).rows[0];
            if (!post)
                throw new Error("Content item not found.");
            if (post.status === "PUBLISHING")
                throw new Error("Post is currently being published.");
            if (post.status === "PUBLISHED")
                throw new Error("Post has already been published.");
            const targetPlatforms = post.platforms;
            const scheduledIds = [];
            for (const platform of targetPlatforms) {
                const plan = await createPublishPlan(db, post, platform, { isPublishing: true });
                const account = (await db.query("SELECT a.id FROM social_accounts a JOIN social_account_tokens t ON t.account_id=a.id WHERE a.workspace_id=$1 AND lower(a.platform)=lower($2) AND lower(a.state)='connected'", [workspaceId, platform])).rows[0];
                if (!account)
                    throw new Error(`No connected ${platform} channel found in workspace.`);
                const schedId = randomUUID();
                await db.query("INSERT INTO scheduled_posts(id, workspace_id, content_id, account_id, content_version, execute_at, timezone, state) VALUES($1, $2, $3, $4, $5, NOW(), 'UTC', 'ENQUEUED')", [schedId, workspaceId, contentId, account.id, post.version, "UTC"]);
                scheduledIds.push(schedId);
                // Enqueue into existing social-publishing queue to reuse existing worker!
                await publishingQueue.add("publish", { id: schedId, workspaceId }, { jobId: schedId }, db);
            }
            await db.query("UPDATE content SET status = 'PUBLISHING', updated_at = NOW() WHERE id = $1 AND workspace_id = $2", [contentId, workspaceId]);
            return { contentId, status: "PUBLISHING", enqueuedCount: scheduledIds.length };
        }
        default:
            throw new Error(`Unsupported batch operation type '${op}'`);
    }
}
export async function processBatch(job) {
    const { batchId, workspaceId } = job.data;
    const existing = (await pool.query('SELECT status FROM batch_jobs WHERE id=$1 AND workspace_id=$2', [batchId, workspaceId])).rows[0];
    if (!existing)
        throw new Error('Batch missing or outside tenant');
    if (existing.status === 'COMPLETED')
        return;
    // 1. Set parent batch status to PROCESSING
    await pool.query("UPDATE batch_jobs SET status = 'PROCESSING', started_at = COALESCE(started_at, NOW()), updated_at = NOW() WHERE id = $1 AND workspace_id = $2", [batchId, workspaceId]);
    // 2. Fetch pending child items
    const childItems = (await pool.query("SELECT * FROM batch_child_items WHERE batch_id = $1 AND workspace_id = $2 AND status = 'PENDING' ORDER BY item_index ASC, created_at ASC", [batchId, workspaceId])).rows;
    for (const item of childItems) {
        try {
            await transaction(async (db) => {
                const claimed = (await db.query("SELECT * FROM batch_child_items WHERE id=$1 AND batch_id=$2 AND workspace_id=$3 AND status='PENDING' FOR UPDATE SKIP LOCKED", [item.id, batchId, workspaceId])).rows[0];
                if (!claimed)
                    return;
                const result = await executeChildItem(db, claimed, workspaceId);
                await db.query("UPDATE batch_child_items SET status='COMPLETED',result=$2,error=NULL,updated_at=now() WHERE id=$1 AND batch_id=$3 AND workspace_id=$4", [item.id, JSON.stringify(result || {}), batchId, workspaceId]);
            });
        }
        catch (err) {
            const errMsg = err.message || "Child item execution failed";
            // Child item failed — do NOT fail parent loop
            await pool.query("UPDATE batch_child_items SET status = 'FAILED', error = $2, updated_at = NOW() WHERE id = $1 AND workspace_id=$3 AND batch_id=$4 AND status='PENDING'", [item.id, errMsg, workspaceId, batchId]);
        }
    }
    // 3. Aggregate final batch counts and status
    const allItems = (await pool.query("SELECT status FROM batch_child_items WHERE batch_id = $1 AND workspace_id = $2", [batchId, workspaceId])).rows;
    const completedCount = allItems.filter((i) => i.status === "COMPLETED").length;
    const failedCount = allItems.filter((i) => i.status === "FAILED").length;
    const totalCount = allItems.length;
    let finalStatus = "COMPLETED";
    if (completedCount === 0 && failedCount > 0) {
        finalStatus = "FAILED";
    }
    else if (failedCount > 0) {
        finalStatus = "PARTIAL";
    }
    await pool.query(`UPDATE batch_jobs 
       SET status = $1, completed_items = $2, failed_items = $3, completed_at = NOW(), updated_at = NOW() 
       WHERE id = $4 AND workspace_id = $5`, [finalStatus, completedCount, failedCount, batchId, workspaceId]);
    const notifType = finalStatus === "COMPLETED"
        ? "batch_completed"
        : finalStatus === "PARTIAL"
            ? "batch_partial"
            : "batch_failed";
    await NotificationsService.createNotification(pool, {
        workspaceId,
        type: notifType,
        title: `Batch Operation ${finalStatus.toLowerCase()}`,
        message: `Batch job finished: ${completedCount} succeeded, ${failedCount} failed out of ${totalCount} items.`,
        data: { batchId, completedCount, failedCount, totalCount, status: finalStatus },
    });
    console.log(JSON.stringify({
        event: "batch_completed",
        batchId,
        status: finalStatus,
        completed: completedCount,
        failed: failedCount,
        total: totalCount,
    }));
}
