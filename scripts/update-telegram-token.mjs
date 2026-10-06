import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
process.loadEnvFile(path.join(process.cwd(), ".env"));

import { pool } from "../dist-api/db.js";
import { encryptToken, decryptToken } from "../dist-api/security.js";

async function main() {
  const newToken = "8818622380:AAFiTkLEG3PEdLEiiSGiWHpHGJpmkDdtnHw";
  console.log("Updating Telegram Bot Token in database...");

  const res = await pool.query(
    "SELECT a.id, a.workspace_id, a.name, a.provider_id FROM social_accounts a WHERE a.platform = 'telegram'",
  );

  console.log(`Found ${res.rowCount} Telegram social account(s).`);

  for (const acc of res.rows) {
    const encrypted = encryptToken(newToken, acc.workspace_id);
    await pool.query(
      "UPDATE social_account_tokens SET ciphertext = $1 WHERE account_id = $2",
      [encrypted, acc.id],
    );
    await pool.query(
      "UPDATE social_accounts SET state = 'CONNECTED', last_sync = NOW() WHERE id = $1",
      [acc.id],
    );
    console.log(`Updated token for account ID ${acc.id} (Workspace: ${acc.workspace_id}, Chat: ${acc.provider_id})`);
  }

  await pool.end();
  console.log("Telegram token update completed successfully!");
}

main().catch((err) => {
  console.error("Error updating token:", err);
  process.exit(1);
});
