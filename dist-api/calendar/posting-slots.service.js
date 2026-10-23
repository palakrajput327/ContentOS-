import { randomUUID } from "node:crypto";
export const DEFAULT_POSTING_SLOTS = [
    // Mon-Fri at 09:00, 14:00, 18:00
    ...[1, 2, 3, 4, 5].flatMap((day) => [
        { day_of_week: day, time_of_day: "09:00", platform: null, enabled: true },
        { day_of_week: day, time_of_day: "14:00", platform: null, enabled: true },
        { day_of_week: day, time_of_day: "18:00", platform: null, enabled: true },
    ]),
    // Sat-Sun at 11:00
    ...[0, 6].map((day) => ({
        day_of_week: day,
        time_of_day: "11:00",
        platform: null,
        enabled: true,
    })),
];
export class PostingSlotsService {
    /**
     * Retrieves configured posting slots for a workspace.
     * If none exist, initializes default slots.
     */
    static async getWorkspaceSlots(db, workspaceId) {
        const res = await db.query(`SELECT * FROM posting_slots WHERE workspace_id = $1 ORDER BY day_of_week ASC, time_of_day ASC`, [workspaceId]);
        if (res.rows.length === 0) {
            // Initialize defaults for workspace
            return await this.initializeDefaultSlots(db, workspaceId);
        }
        return res.rows.map((row) => ({
            id: row.id,
            workspace_id: row.workspace_id,
            day_of_week: Number(row.day_of_week),
            time_of_day: row.time_of_day,
            platform: row.platform || null,
            enabled: Boolean(row.enabled),
            created_at: row.created_at,
            updated_at: row.updated_at,
        }));
    }
    /**
     * Bulk updates posting slots for a workspace.
     */
    static async saveWorkspaceSlots(db, workspaceId, slots) {
        // Delete existing slots
        await db.query(`DELETE FROM posting_slots WHERE workspace_id = $1`, [workspaceId]);
        const createdSlots = [];
        for (const slot of slots) {
            const id = randomUUID();
            const enabled = slot.enabled !== undefined ? slot.enabled : true;
            const platform = slot.platform || null;
            const inserted = await db.query(`INSERT INTO posting_slots (id, workspace_id, day_of_week, time_of_day, platform, enabled)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`, [id, workspaceId, slot.day_of_week, slot.time_of_day, platform, enabled]);
            const row = inserted.rows[0];
            createdSlots.push({
                id: row.id,
                workspace_id: row.workspace_id,
                day_of_week: Number(row.day_of_week),
                time_of_day: row.time_of_day,
                platform: row.platform || null,
                enabled: Boolean(row.enabled),
                created_at: row.created_at,
                updated_at: row.updated_at,
            });
        }
        return createdSlots;
    }
    /**
     * Initializes default recurring posting slots for a workspace.
     */
    static async initializeDefaultSlots(db, workspaceId) {
        return await this.saveWorkspaceSlots(db, workspaceId, DEFAULT_POSTING_SLOTS);
    }
}
