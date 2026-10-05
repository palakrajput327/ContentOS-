import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 60000,
  ssl: {
    rejectUnauthorized: false,
    servername: "ep-odd-wind-b309rvnv.c-4.ap-southeast-1.aws.neon.tech",
  },
} as any);
export type DB = Pick<PoolClient, "query">;
export async function transaction<T>(fn: (db: DB) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const v = await fn(client);
    await client.query("COMMIT");
    return v;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function audit(
  db: DB,
  workspaceId: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  entity: string,
  previous: unknown = null,
  next: unknown = null,
) {
  await db.query(
    "INSERT INTO activity_logs(id,workspace_id,actor_id,action,entity_type,entity_id,entity,previous_value,new_value) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      randomUUID(),
      workspaceId,
      actorId,
      action,
      entityType,
      entityId,
      entity,
      JSON.stringify(previous),
      JSON.stringify(next),
    ],
  );
}
