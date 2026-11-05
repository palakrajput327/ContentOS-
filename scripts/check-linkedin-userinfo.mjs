import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (typeof process.loadEnvFile === "function") {
  process.loadEnvFile(path.resolve(__dirname, "../.env"));
}

const { pool } = await import("../dist-api/db.js");
const { decryptToken } = await import("../dist-api/security.js");

async function main() {
  const accRow = await pool.query(`
    SELECT a.*, t.ciphertext 
    FROM social_accounts a 
    JOIN social_account_tokens t ON t.account_id = a.id 
    WHERE a.id = '325b8bcc-183f-483a-b90d-6fec3dc09c99'
  `);
  
  const acc = accRow.rows[0];
  let token;
  try {
    token = decryptToken(acc.ciphertext, acc.workspace_id);
  } catch {
    token = decryptToken(acc.ciphertext, `${acc.workspace_id}:${acc.id}`);
  }

  console.log("Token starts with:", token.slice(0, 10));

  const userinfoRes = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log("userinfo status:", userinfoRes.status);
  const userinfo = await userinfoRes.json();
  console.log("userinfo:", JSON.stringify(userinfo, null, 2));

  await pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
