import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import dns from "node:dns";

// Global resilient DNS resolver for cloud databases (Neon, AWS, etc.)
if (!(globalThis as any).__dnsFallbackPatched) {
  (globalThis as any).__dnsFallbackPatched = true;
  try {
    dns.setDefaultResultOrder("ipv4first");
  } catch (e) {}

  const originalLookup = dns.lookup;
  const fallbackResolver = new dns.promises.Resolver();
  try {
    fallbackResolver.setServers(["8.8.8.8", "1.1.1.1"]);
  } catch (e) {}

  dns.lookup = function (hostname: any, options: any, callback: any) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    originalLookup(hostname, options, (err: any, address: any, family: any) => {
      if (err && (err.code === "ENOTFOUND" || err.code === "EREFUSED")) {
        fallbackResolver
          .resolve4(hostname)
          .then((addresses) => {
            if (addresses && addresses.length > 0) {
              if (options && options.all) {
                return callback(
                  null,
                  addresses.map((a) => ({ address: a, family: 4 })),
                );
              }
              return callback(null, addresses[0], 4);
            }
            callback(err, address, family);
          })
          .catch(() => {
            callback(err, address, family);
          });
      } else {
        callback(null, address, family);
      }
    });
  } as any;
}

let rawConnectionString = process.env.DATABASE_URL;
if (rawConnectionString && rawConnectionString.includes('.neon.tech') && !rawConnectionString.includes('-pooler')) {
  rawConnectionString = rawConnectionString.replace(/(\.c-[^.]+\.[^.]+\.aws\.neon\.tech|\.neon\.tech)/, (match) => `-pooler${match}`);
}

let databaseHost = rawConnectionString
  ? (() => {
      try {
        return new URL(rawConnectionString).hostname;
      } catch (e) {
        return "localhost";
      }
    })()
  : (process.env.PGHOST || "localhost");

if (databaseHost && databaseHost.includes('.neon.tech') && !databaseHost.includes('-pooler')) {
  databaseHost = databaseHost.replace(/(\.c-[^.]+\.[^.]+\.aws\.neon\.tech|\.neon\.tech)/, (match) => `-pooler${match}`);
}

const localDatabase = ["localhost", "127.0.0.1", "[::1]"].includes(databaseHost);

const poolConfig: any = rawConnectionString
  ? { connectionString: rawConnectionString }
  : {
      host: databaseHost,
      port: Number(process.env.PGPORT) || 5432,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
    };

poolConfig.max = Math.min(Number(process.env.PG_POOL_MAX) || 4, 8);
poolConfig.connectionTimeoutMillis = 10000;
poolConfig.idleTimeoutMillis = 5000;
poolConfig.allowExitOnIdle = true;
poolConfig.keepAlive = true;
poolConfig.keepAliveInitialDelayMillis = 5000;
poolConfig.ssl = localDatabase ? false : {
  rejectUnauthorized: false,
  servername: databaseHost || undefined,
};

export const pool = new Pool(poolConfig);

// Prevent cloud Postgres (Neon) idle socket drops from crashing the Node.js process
pool.on("error", (err: any) => {
  console.warn("[PostgreSQL Pool] Handled idle client reset (prevented crash):", err?.message || err);
});
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
