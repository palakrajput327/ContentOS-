import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
export async function migrate(options: {only?:string;list?:boolean} = {}) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(74152023)");
    if(!options.list)await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const dir = fileURLToPath(
      new URL("../server/migrations/", import.meta.url),
    );
    const files=(await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    if(options.only&&!files.includes(options.only))throw new Error('Migration file not found');
    const historyExists=(await client.query("SELECT to_regclass('schema_migrations') AS table_name")).rows[0].table_name;
    for (const f of files) {
      if(options.only && f!==options.only)continue;
      if (historyExists &&
        (
          await client.query("SELECT 1 FROM schema_migrations WHERE name=$1", [
            f,
          ])
        ).rowCount
      )
        continue;
      if(options.list) {console.log(JSON.stringify({event:'migration_pending',name:f}));continue;}
      await client.query("BEGIN");
      try {
        await client.query(await readFile(`${dir}/${f}`, "utf8"));
        await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [
          f,
        ]);
        await client.query("COMMIT");
        console.log(JSON.stringify({ event: "migration_applied", name: f }));
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(74152023)");
    client.release();
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const only=process.argv.find(a=>a.startsWith('--only='))?.slice(7);
  if(only && !/^\d{3}_[a-z0-9_]+\.sql$/.test(only))throw new Error('Invalid migration filename');
  migrate({only,list:process.argv.includes('--list')})
    .then(() => pool.end())
    .catch(() => {
      console.error(
        "Migration failed; inspect database connectivity and migration state.",
      );
      process.exit(1);
    });
}
