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
    const [counts, upcoming, activity] = await Promise.all([
      pool.query(
        `SELECT
          (SELECT COUNT(*)::int FROM social_accounts WHERE workspace_id = $1 AND state = 'Connected') AS connected_accounts,
          (SELECT COUNT(*)::int FROM content WHERE workspace_id = $1 AND status = 'SCHEDULED') AS scheduled_posts,
          (SELECT COUNT(*)::int FROM content WHERE workspace_id = $1 AND status = 'PUBLISHED') AS published_posts,
          (SELECT COUNT(*)::int FROM content WHERE workspace_id = $1 AND status = 'DRAFT') AS drafts,
          (SELECT COUNT(*)::int FROM content WHERE workspace_id = $1 AND status = 'NEEDS_REVIEW') AS awaiting_approval`,
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
    ]);

    const c = counts.rows[0] || {};
    return {
      metrics: {
        connectedAccounts: c.connected_accounts || 0,
        scheduledPosts: c.scheduled_posts || 0,
        publishedPosts: c.published_posts || 0,
        drafts: c.drafts || 0,
        awaitingApproval: c.awaiting_approval || 0,
        aiJobs: 0,
      },
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
