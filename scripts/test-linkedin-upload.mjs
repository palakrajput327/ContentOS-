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

  console.log("Testing initializeUpload...");
  const initRes = await fetch(
    "https://api.linkedin.com/rest/images?action=initializeUpload",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "LinkedIn-Version": apiVersion,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: author,
        },
      }),
    },
  );

  console.log("initRes status:", initRes.status);
  const initData = await initRes.json();
  console.log("initData:", JSON.stringify(initData, null, 2));

  const uploadUrl = initData.value?.uploadUrl;
  console.log("uploadUrl:", uploadUrl);

  // Let's test uploading a 1x1 dummy jpeg buffer
  const dummyBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60, 0x00, 0x60, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xbf, 0x00, 0xff, 0xd9]);

  // Test WITH Authorization header (as in current code)
  const upWithAuth = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "image/jpeg",
    },
    body: dummyBuffer,
  });
  console.log("upWithAuth status:", upWithAuth.status, upWithAuth.statusText);
  const upWithAuthText = await upWithAuth.text();
  console.log("upWithAuth body:", upWithAuthText);

  await pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
