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

  const author = "urn:li:person:YXZvLjFrMi";
  const apiVersion = process.env.LINKEDIN_API_VERSION || "202609";

  const postBody = {
    author,
    commentary: "Test automated post from ContentOS API verification",
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  const res = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": apiVersion,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(postBody),
  });

  console.log("POST /rest/posts status:", res.status);
  console.log("Headers:");
  for (const [k, v] of res.headers.entries()) {
    console.log(`  ${k}: ${v}`);
  }
  const text = await res.text();
  console.log("Body:", text);

  await pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
