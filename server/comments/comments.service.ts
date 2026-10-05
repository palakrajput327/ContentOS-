import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { audit } from "../db.js";
import { NotificationsService } from "../notifications/notifications.service.js";

export interface CommentAuthor {
  id: string;
  name: string;
  email: string;
}

export interface ContentComment {
  id: string;
  workspace_id: string;
  content_id: string;
  parent_id: string | null;
  author_id: string;
  author: CommentAuthor;
  comment: string;
  mentions: string[];
  resolved: boolean;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  replies?: ContentComment[];
}

export class CommentsService {
  /**
   * Lists comments for a content item with author details and nested replies.
   */
  static async listComments(
    pool: Pool,
    workspaceId: string,
    contentId: string
  ): Promise<ContentComment[]> {
    const res = await pool.query(
      `SELECT c.*, u.name as author_name, u.email as author_email
       FROM content_comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.workspace_id = $1 AND c.content_id = $2 AND c.deleted_at IS NULL
       ORDER BY c.created_at ASC`,
      [workspaceId, contentId]
    );

    const commentsMap = new Map<string, ContentComment>();
    const rootComments: ContentComment[] = [];

    for (const row of res.rows) {
      const item: ContentComment = {
        id: row.id,
        workspace_id: row.workspace_id,
        content_id: row.content_id,
        parent_id: row.parent_id,
        author_id: row.author_id,
        author: {
          id: row.author_id,
          name: row.author_name || "Unknown User",
          email: row.author_email || "",
        },
        comment: row.comment,
        mentions: Array.isArray(row.mentions) ? row.mentions : [],
        resolved: Boolean(row.resolved),
        created_at: row.created_at,
        updated_at: row.updated_at,
        edited_at: row.edited_at,
        deleted_at: row.deleted_at,
        replies: [],
      };

      commentsMap.set(item.id, item);

      if (item.parent_id && commentsMap.has(item.parent_id)) {
        commentsMap.get(item.parent_id)!.replies!.push(item);
      } else {
        rootComments.push(item);
      }
    }

    return rootComments;
  }

  /**
   * Creates a comment or threaded reply.
   */
  static async createComment(
    pool: Pool,
    workspaceId: string,
    contentId: string,
    authorId: string,
    input: {
      comment: string;
      parentId?: string | null;
      mentions?: string[];
    }
  ): Promise<ContentComment> {
    const text = input.comment ? input.comment.trim() : "";
    if (!text) {
      throw new Error("Comment cannot be empty.");
    }

    // 1. Verify content exists & belongs to workspace
    const contentRes = await pool.query(
      `SELECT id, title FROM content WHERE id = $1 AND workspace_id = $2`,
      [contentId, workspaceId]
    );
    if (contentRes.rows.length === 0) {
      throw new Error("Content item not found in this workspace.");
    }
    const contentTitle = contentRes.rows[0].title || "Content item";

    // 2. Fetch author details
    const authorRes = await pool.query(
      `SELECT id, name, email FROM users WHERE id = $1`,
      [authorId]
    );
    const authorName = authorRes.rows[0]?.name || "Teammate";

    // 3. Verify parent comment if thread reply
    let parentAuthorId: string | null = null;
    if (input.parentId) {
      const parentRes = await pool.query(
        `SELECT id, author_id FROM content_comments WHERE id = $1 AND workspace_id = $2 AND content_id = $3 AND deleted_at IS NULL`,
        [input.parentId, workspaceId, contentId]
      );
      if (parentRes.rows.length === 0) {
        throw new Error("Parent comment not found in this content thread.");
      }
      parentAuthorId = parentRes.rows[0].author_id;
    }

    // 4. Validate mention user IDs against workspace members
    let validMentions: string[] = [];
    if (input.mentions && input.mentions.length > 0) {
      const membersRes = await pool.query(
        `SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND user_id = ANY($2)`,
        [workspaceId, input.mentions]
      );
      validMentions = membersRes.rows.map((r) => r.user_id);
    }

    // 5. Insert comment
    const commentId = randomUUID();
    const insertRes = await pool.query(
      `INSERT INTO content_comments (id, workspace_id, content_id, parent_id, author_id, comment, mentions, resolved)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false)
       RETURNING *`,
      [
        commentId,
        workspaceId,
        contentId,
        input.parentId || null,
        authorId,
        text,
        JSON.stringify(validMentions),
      ]
    );

    const row = insertRes.rows[0];

    // Audit log
    await audit(
      pool,
      workspaceId,
      authorId,
      "CREATE_COMMENT",
      "content",
      contentId,
      `Comment on "${contentTitle}"`
    );

    // 6. Send Notifications
    // Mention notifications
    for (const mentionedUserId of validMentions) {
      if (mentionedUserId !== authorId) {
        await NotificationsService.createNotification(pool, {
          workspaceId,
          userId: mentionedUserId,
          type: "comment_mention",
          title: "You were mentioned in a comment",
          message: `${authorName} mentioned you on "${contentTitle}": "${text.slice(0, 80)}"`,
          data: { content_id: contentId, comment_id: commentId },
        });
      }
    }

    // Reply notification
    if (parentAuthorId && parentAuthorId !== authorId && !validMentions.includes(parentAuthorId)) {
      await NotificationsService.createNotification(pool, {
        workspaceId,
        userId: parentAuthorId,
        type: "comment_reply",
        title: "New reply to your comment",
        message: `${authorName} replied to your comment on "${contentTitle}": "${text.slice(0, 80)}"`,
        data: { content_id: contentId, comment_id: commentId },
      });
    }

    return {
      id: row.id,
      workspace_id: row.workspace_id,
      content_id: row.content_id,
      parent_id: row.parent_id,
      author_id: row.author_id,
      author: {
        id: authorId,
        name: authorName,
        email: authorRes.rows[0]?.email || "",
      },
      comment: row.comment,
      mentions: validMentions,
      resolved: Boolean(row.resolved),
      created_at: row.created_at,
      updated_at: row.updated_at,
      edited_at: row.edited_at,
      deleted_at: row.deleted_at,
      replies: [],
    };
  }

  /**
   * Resolves or reopens a comment thread.
   */
  static async resolveComment(
    pool: Pool,
    workspaceId: string,
    contentId: string,
    commentId: string,
    actorId: string,
    resolved: boolean
  ): Promise<boolean> {
    const res = await pool.query(
      `UPDATE content_comments
       SET resolved = $1, updated_at = now()
       WHERE id = $2 AND workspace_id = $3 AND content_id = $4 AND deleted_at IS NULL`,
      [resolved, commentId, workspaceId, contentId]
    );

    if ((res.rowCount ?? 0) > 0) {
      await audit(
        pool,
        workspaceId,
        actorId,
        resolved ? "RESOLVE_COMMENT" : "REOPEN_COMMENT",
        "content",
        contentId,
        `Comment ${resolved ? "resolved" : "reopened"}`
      );
      return true;
    }
    return false;
  }

  /**
   * Assigns content to a workspace member (or unassigns if null).
   */
  static async assignContent(
    pool: Pool,
    workspaceId: string,
    contentId: string,
    actorId: string,
    assignedToUserId: string | null
  ): Promise<{ assignedTo: { id: string; name: string; email: string } | null }> {
    // 1. Verify content exists
    const contentRes = await pool.query(
      `SELECT id, title, assigned_to FROM content WHERE id = $1 AND workspace_id = $2`,
      [contentId, workspaceId]
    );
    if (contentRes.rows.length === 0) {
      throw new Error("Content item not found in workspace.");
    }
    const contentTitle = contentRes.rows[0].title || "Content item";

    let assigneeUser: { id: string; name: string; email: string } | null = null;

    if (assignedToUserId) {
      // 2. Verify assignee is a member of workspace
      const memberRes = await pool.query(
        `SELECT u.id, u.name, u.email
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id = $1 AND wm.user_id = $2`,
        [workspaceId, assignedToUserId]
      );
      if (memberRes.rows.length === 0) {
        throw new Error("Assignee must be an active member of this workspace.");
      }
      assigneeUser = memberRes.rows[0];
    }

    // 3. Update content assigned_to
    await pool.query(
      `UPDATE content SET assigned_to = $1, updated_at = now() WHERE id = $2 AND workspace_id = $3`,
      [assignedToUserId, contentId, workspaceId]
    );

    // Fetch actor details
    const actorRes = await pool.query(`SELECT name FROM users WHERE id = $1`, [actorId]);
    const actorName = actorRes.rows[0]?.name || "A workspace teammate";

    // Audit log
    await audit(
      pool,
      workspaceId,
      actorId,
      "ASSIGN_CONTENT",
      "content",
      contentId,
      assigneeUser ? `Assigned "${contentTitle}" to ${assigneeUser.name}` : `Unassigned "${contentTitle}"`
    );

    // Notification
    if (assigneeUser && assignedToUserId !== actorId) {
      await NotificationsService.createNotification(pool, {
        workspaceId,
        userId: assignedToUserId,
        type: "content_assigned",
        title: "Content Assigned to You",
        message: `${actorName} assigned content "${contentTitle}" to you.`,
        data: { content_id: contentId },
      });
    }

    return { assignedTo: assigneeUser };
  }

  /**
   * Retrieves unified per-content activity timeline (audit logs + comments + approval history).
   */
  static async getContentTimeline(
    pool: Pool,
    workspaceId: string,
    contentId: string
  ): Promise<Array<{
    id: string;
    type: "activity" | "comment";
    actor: string;
    action: string;
    details: string;
    created_at: string;
  }>> {
    // 1. Activity logs
    const logsRes = await pool.query(
      `SELECT a.id, u.name as actor_name, a.action, a.entity, a.created_at
       FROM activity_logs a
       LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.workspace_id = $1 AND a.entity_id = $2
       ORDER BY a.created_at DESC`,
      [workspaceId, contentId]
    );

    // 2. Comments
    const commentsRes = await pool.query(
      `SELECT c.id, u.name as author_name, c.comment, c.resolved, c.created_at
       FROM content_comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.workspace_id = $1 AND c.content_id = $2 AND c.deleted_at IS NULL
       ORDER BY c.created_at DESC`,
      [workspaceId, contentId]
    );

    const timeline: Array<{
      id: string;
      type: "activity" | "comment";
      actor: string;
      action: string;
      details: string;
      created_at: string;
    }> = [];

    for (const log of logsRes.rows) {
      timeline.push({
        id: log.id,
        type: "activity",
        actor: log.actor_name || "System",
        action: log.action,
        details: log.entity || "",
        created_at: log.created_at,
      });
    }

    for (const c of commentsRes.rows) {
      timeline.push({
        id: c.id,
        type: "comment",
        actor: c.author_name || "User",
        action: c.resolved ? "COMMENT_RESOLVED" : "COMMENTED",
        details: c.comment,
        created_at: c.created_at,
      });
    }

    // Sort chronologically (most recent first)
    timeline.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return timeline;
  }
}
