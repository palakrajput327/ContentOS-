import { Controller, Get, Req } from "@nestjs/common";
import { pool } from "./db.js";
import { WorkspaceRequired, type AuthedRequest } from "./security.js";

export function serializePost(p: Record<string, any>) {
  return {
    id: p.id,
    title: p.title,
    body: p.body,
    variants: p.variants,
    platforms: p.platforms,
    status: p.status,
    version: p.version,
    creator: p.creator,
    createdAt: p.created_at,
    scheduledAt: p.scheduled_at,
    timezone: p.timezone,
  };
}

@Controller("dashboard")
export class DashboardController {
  @WorkspaceRequired()
  @Get("summary")
  async summary(@Req() r: AuthedRequest) {
    const w = r.workspace.id;
    const [counts, upcoming, activity, platformDist, membersRes] = await Promise.all([
      pool.query(
        `SELECT
          (SELECT COUNT(*)::int FROM social_accounts WHERE workspace_id = $1 AND LOWER(state) = 'connected') AS connected_accounts,
          (SELECT COUNT(*)::int FROM content WHERE workspace_id = $1 AND status = 'SCHEDULED') AS scheduled_posts,
          (SELECT COUNT(*)::int FROM content WHERE workspace_id = $1 AND status = 'PUBLISHED') AS published_posts,
          (SELECT COUNT(*)::int FROM content WHERE workspace_id = $1 AND status = 'DRAFT') AS drafts,
          (SELECT COUNT(*)::int FROM content WHERE workspace_id = $1 AND status = 'NEEDS_REVIEW') AS awaiting_approval,
          (SELECT COUNT(*)::int FROM content WHERE workspace_id = $1 AND status = 'APPROVED') AS approved_posts,
          (SELECT COUNT(*)::int FROM content WHERE workspace_id = $1) AS total_posts,
          (SELECT COUNT(*)::int FROM content WHERE workspace_id = $1 AND (variants IS NOT NULL AND jsonb_array_length(variants) > 0)) AS ai_posts`,
        [w],
      ),
      pool.query(
        "SELECT c.*, u.name AS creator FROM content c JOIN users u ON u.id = c.created_by WHERE c.workspace_id = $1 AND c.status = 'SCHEDULED' ORDER BY c.scheduled_at ASC LIMIT 5",
        [w],
      ),
      pool.query(
        "SELECT a.id, COALESCE(u.name, 'System') AS actor, a.action, a.entity, a.created_at FROM activity_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE a.workspace_id = $1 ORDER BY a.created_at DESC LIMIT 10",
        [w],
      ),
      pool.query(
        `SELECT p.platform, COUNT(*)::int as count 
         FROM content c, jsonb_array_elements_text(c.platforms) as p(platform)
         WHERE c.workspace_id = $1
         GROUP BY p.platform`,
        [w],
      ),
      pool.query(
        "SELECT COUNT(*)::int as count FROM workspace_members WHERE workspace_id = $1",
        [w],
      ),
    ]);

    const c = counts.rows[0] || {};
    const aiConfigured = Boolean(
      process.env.GEMINI_API_KEY ||
      process.env.GROQ_API_KEY ||
      process.env.OPENROUTER_API_KEY
    );
    const aiProvider = process.env.GEMINI_API_KEY
      ? "Gemini 2.5 Flash"
      : process.env.GROQ_API_KEY
        ? "Groq LLaMA 3.3"
        : process.env.OPENROUTER_API_KEY
          ? "OpenRouter AI"
          : "Not configured";

    const platformCounts: Record<string, number> = {
      LinkedIn: 0,
      Instagram: 0,
      X: 0,
      YouTube: 0,
      Telegram: 0,
    };
    for (const row of platformDist.rows) {
      if (row.platform in platformCounts) {
        platformCounts[row.platform] = Number(row.count);
      }
    }

    return {
      metrics: {
        connectedAccounts: c.connected_accounts || 0,
        scheduledPosts: c.scheduled_posts || 0,
        publishedPosts: c.published_posts || 0,
        drafts: c.drafts || 0,
        awaitingApproval: c.awaiting_approval || 0,
        approved: c.approved_posts || 0,
        totalPosts: c.total_posts || 0,
        aiPosts: c.ai_posts || 0,
        aiConfigured,
        aiProvider,
        memberCount: membersRes.rows[0]?.count || 1,
      },
      pipeline: {
        draft: c.drafts || 0,
        review: c.awaiting_approval || 0,
        approved: c.approved_posts || 0,
        scheduled: c.scheduled_posts || 0,
        published: c.published_posts || 0,
      },
      platformCounts,
      upcomingContent: upcoming.rows.map(serializePost),
      recentActivity: activity.rows.map((a) => ({
        id: a.id,
        actor: a.actor,
        action: a.action,
        entity: a.entity,
        at: a.created_at,
      })),
    };
  }
}
