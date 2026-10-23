import { randomUUID } from "node:crypto";
export class NotificationsService {
    /**
     * Creates a workspace notification.
     */
    static async createNotification(db, input) {
        const id = randomUUID();
        const res = await db.query(`INSERT INTO notifications (id, workspace_id, user_id, type, title, message, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`, [
            id,
            input.workspaceId,
            input.userId || null,
            input.type,
            input.title,
            input.message,
            JSON.stringify(input.data || {}),
        ]);
        return res.rows[0];
    }
    /**
     * Lists notifications for a workspace and target user.
     */
    static async listNotifications(db, workspaceId, userId, limit = 50) {
        const res = await db.query(`SELECT * FROM notifications
       WHERE workspace_id = $1 AND (user_id IS NULL OR user_id = $2)
       ORDER BY created_at DESC
       LIMIT $3`, [workspaceId, userId, limit]);
        return res.rows.map((row) => ({
            id: row.id,
            workspace_id: row.workspace_id,
            user_id: row.user_id,
            type: row.type,
            title: row.title,
            message: row.message,
            data: row.data || {},
            read: Boolean(row.read),
            created_at: row.created_at,
        }));
    }
    /**
     * Gets total unread notification count.
     */
    static async getUnreadCount(db, workspaceId, userId) {
        const res = await db.query(`SELECT COUNT(*)::int AS count FROM notifications
       WHERE workspace_id = $1 AND (user_id IS NULL OR user_id = $2) AND read = false`, [workspaceId, userId]);
        return res.rows[0]?.count || 0;
    }
    /**
     * Marks a single notification as read.
     */
    static async markRead(db, workspaceId, userId, notificationId) {
        const res = await db.query(`UPDATE notifications SET read = true
       WHERE id = $1 AND workspace_id = $2 AND (user_id IS NULL OR user_id = $3)`, [notificationId, workspaceId, userId]);
        return (res.rowCount ?? 0) > 0;
    }
    /**
     * Marks all workspace notifications for user as read.
     */
    static async markAllRead(db, workspaceId, userId) {
        const res = await db.query(`UPDATE notifications SET read = true
       WHERE workspace_id = $1 AND (user_id IS NULL OR user_id = $2) AND read = false`, [workspaceId, userId]);
        return res.rowCount ?? 0;
    }
}
