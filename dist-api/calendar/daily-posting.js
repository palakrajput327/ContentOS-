import { assertWorkspaceActive, getWorkspaceEntitlement } from "../billing/entitlement.service.js";
import { ConflictException } from "@nestjs/common";
import { listFestivalsForYear } from "./festival.data.js";
export function dailyCapacity(target, scheduled, festivals, scheduledFestivals) {
    const reserved = Math.max(0, festivals - scheduledFestivals);
    return {
        target,
        scheduled,
        reserved,
        remaining: Math.max(0, target - scheduled - reserved),
        overTarget: Math.max(0, scheduled + reserved - target),
    };
}
export async function getDailyCapacity(db, workspaceId, date, excludeId) {
    const limitRow = (await db.query(`SELECT
         COALESCE(ws.custom_daily_limit, p.daily_post_limit, wt.daily_post_limit, w.daily_posting_target, 3) AS daily_limit,
         w.timezone,
         w.festival_automation_enabled,
         w.festival_region
       FROM workspaces w
       LEFT JOIN workspace_subscriptions ws ON ws.workspace_id = w.id
       LEFT JOIN subscription_plans p ON p.id = ws.plan_id
       LEFT JOIN workspace_trials wt ON wt.workspace_id = w.id
       WHERE w.id = $1`, [workspaceId])).rows[0] || {
        daily_limit: 3,
        timezone: "Asia/Kolkata",
        festival_automation_enabled: false,
        festival_region: "National",
    };
    const timezone = limitRow.timezone || "Asia/Kolkata";
    const rows = (await db.query("SELECT q.scheduled_post_id AS id,c.variants FROM publication_quota q LEFT JOIN content c ON c.id=q.content_id AND c.workspace_id=q.workspace_id WHERE q.workspace_id=$1 AND (q.business_date=$2::date AND q.state IN ('SUCCESS','RESERVED') OR q.state IN ('PROCESSING','UNCERTAIN')) AND ($3::uuid IS NULL OR q.content_id<>$3)", [workspaceId, date, excludeId || null])).rows;
    const entitlement = await getWorkspaceEntitlement(workspaceId, db);
    const festivals = limitRow.festival_automation_enabled
        ? listFestivalsForYear(Number(date.slice(0, 4)), {
            region: limitRow.festival_region,
        }).filter((f) => f.dateForYear === date).length
        : 0;
    return dailyCapacity(entitlement.dailyPostingLimit, rows.length, festivals, rows.filter((r) => r.variants?.metadata?.content_source === "INDIAN_FESTIVAL_ENGINE").length);
}
// Slot planning is a preflight; the publication_quota trigger serializes actual reservations.
// Avoid upgrading a workspace SHARE lock while another scheduler holds it.
export async function assertDailySlot(db, workspaceId, post, at) {
    await assertWorkspaceActive(workspaceId, "scheduling", db);
    const ws = (await db.query("SELECT timezone FROM workspaces WHERE id=$1", [
        workspaceId,
    ])).rows[0];
    const timezone = ws?.timezone || "Asia/Kolkata";
    const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(at);
    const capacity = await getDailyCapacity(db, workspaceId, date, post.id);
    if (post.variants?.metadata?.content_source !== "INDIAN_FESTIVAL_ENGINE" &&
        capacity.remaining < (Array.isArray(post.platforms) ? post.platforms.length : 1))
        throw new ConflictException("Daily posting target reached or slots reserved for festivals. Choose another date.");
    const conflict = await db.query(`SELECT 1 FROM scheduled_posts WHERE workspace_id=$1 AND content_id<>$2
    AND state <> 'CANCELLED' AND ABS(EXTRACT(EPOCH FROM (execute_at-$3::timestamptz))) < 600 LIMIT 1`, [workspaceId, post.id, at]);
    if (conflict.rows.length)
        throw new ConflictException("Another post occupies this time. Choose a slot at least 10 minutes apart.");
}
