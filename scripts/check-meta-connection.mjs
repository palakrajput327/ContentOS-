import { pool } from "../dist-api/db.js";
try {
  const result = await pool.query(
    "SELECT a.platform,a.name,a.state,a.provider_id,t.account_id IS NOT NULL AS has_token FROM social_accounts a LEFT JOIN social_account_tokens t ON t.account_id=a.id WHERE LOWER(a.platform) IN ('facebook','instagram')",
  );
  console.log(JSON.stringify(result.rows));
} catch (e) {
  console.log("Connection check failed: " + (e.code || e.name));
  process.exitCode = 1;
} finally {
  await pool.end();
}
