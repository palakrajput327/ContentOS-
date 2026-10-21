import { pool } from "./dist-api/db.js";
import { decryptToken } from "./dist-api/security.js";
import { metaPages } from "./dist-api/meta.api.js";

async function main() {
  const pendingId = "42e57a20-ed19-4362-ac64-b2a6586fd30b";
  const res = await pool.query("SELECT * FROM meta_oauth_pending WHERE id = $1", [pendingId]);
  console.log("Pending row count:", res.rowCount);
  if (!res.rowCount) {
    console.log("No row found with ID:", pendingId);
    const all = await pool.query("SELECT id, workspace_id, expires_at FROM meta_oauth_pending ORDER BY expires_at DESC LIMIT 5");
    console.log("Recent pending rows:", all.rows);
    return;
  }
  const row = res.rows[0];
  console.log("Workspace ID:", row.workspace_id, "Expires at:", row.expires_at);
  try {
    const token = decryptToken(row.ciphertext, row.workspace_id);
    console.log("Token decrypted successfully, length:", token.length);
    const pages = await metaPages(token);
    console.log("Pages found:", pages.map(p => ({ id: p.id, name: p.name, instagram: p.instagram_business_account })));
  } catch (err) {
    console.error("Error in metaPages:", err);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
