import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (typeof process.loadEnvFile === "function") {
  process.loadEnvFile(path.resolve(__dirname, "../.env"));
}

const { pool } = await import("../dist-api/db.js");

async function main() {
  const logs = await pool.query("SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 10");
  console.log("activity_logs:", JSON.stringify(logs.rows, null, 2));

  const pub = await pool.query("SELECT * FROM published_posts WHERE provider_post_id = 'urn:li:share:7524008476780511232'");
  console.log("pub exists?:", pub.rows);

  const sp = await pool.query("SELECT * FROM scheduled_posts WHERE id = '12fc34eb-d5cb-4e5c-8b1b-cb4698b028e0'");
  console.log("scheduled_post:", JSON.stringify(sp.rows, null, 2));

  await pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
