import assert from "node:assert/strict";
import { SocialController } from "../dist-api/social.controller.js";
import { SocialProviderRegistry } from "../dist-api/social.provider.js";
import { pool } from "../dist-api/db.js";
import { encryptToken } from "../dist-api/security.js";

process.env.TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
const originalQuery = pool.query;
const originalProvider = SocialProviderRegistry.getProvider;
try {
  for (const platform of ["linkedin", "x", "instagram", "youtube", "telegram"]) {
    let received;
    pool.query = async sql => sql.startsWith("SELECT")
      ? { rowCount: 1, rows: [{ id: "account", platform, provider_id: "destination", ciphertext: encryptToken("test-token", "workspace") }] }
      : { rowCount: 1, rows: [] };
    SocialProviderRegistry.getProvider = () => ({ validateConnection: async config => {
      received = config;
      return { valid: true, status: "CONNECTED", name: "Test account" };
    } });
    const result = await new SocialController().validateAccount({ workspace: { id: "workspace", role: "Owner" }, user: { id: "user" } }, "account");
    assert.deepEqual(received, platform === "telegram" ? { botToken: "test-token", chatId: "destination" } : { token: "test-token" });
    assert.equal(result.state, "CONNECTED");
  }
  console.log("Saved credential validation passed for all five platforms.");
} finally {
  pool.query = originalQuery;
  SocialProviderRegistry.getProvider = originalProvider;
  await pool.end();
}
