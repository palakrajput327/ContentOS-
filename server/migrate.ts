import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(74152023)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const dir = fileURLToPath(
      new URL("../server/migrations/", import.meta.url),
    );
    for (const f of (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      if (
        (
          await client.query("SELECT 1 FROM schema_migrations WHERE name=$1", [
            f,
          ])
        ).rowCount
      )
        continue;
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
  migrate()
    .then(() => pool.end())
    .catch(() => {
      console.error(
        "Migration failed; inspect database connectivity and migration state.",
      );
      process.exit(1);
    });
}
