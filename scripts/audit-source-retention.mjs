import { loadEnvFile } from "node:process";
try {
  loadEnvFile(".env");
} catch {}
const workspaceId = process.argv[2];
if (
  !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
    workspaceId || "",
  )
)
  throw new Error(
    "Usage: node scripts/audit-source-retention.mjs WORKSPACE_UUID (read-only)",
  );
const { pool } = await import("../dist-api/db.js");
try {
  const { sourceRetentionCandidates } =
    await import("../dist-api/storage/source-retention.js");
  console.log(
    JSON.stringify(await sourceRetentionCandidates(pool, workspaceId), null, 2),
  );
} finally {
  await pool.end();
}
