import assert from "node:assert/strict";
import { ContentController } from "../dist-api/content.controller.js";
import { SocialController } from "../dist-api/social.controller.js";
import { SocialProviderRegistry } from "../dist-api/social.provider.js";
import { pool } from "../dist-api/db.js";
import { encryptToken } from "../dist-api/security.js";

process.env.TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
process.env.LINKEDIN_API_VERSION = "202609";
const savedConnect = pool.connect;
const savedQuery = pool.query;
pool.query = async () => ({ rows: [] });
const savedFetch = globalThis.fetch;
const savedProvider = SocialProviderRegistry.getProvider;
const accountId = "11111111-1111-4111-8111-111111111111";
try {
  for (const Controller of [ContentController]) {
    for (const platform of ["linkedin", "telegram"]) {
      let sent;
      const destination =
        platform === "linkedin" ? "urn:li:person:test" : "-100123";
      pool.connect = async () => ({
        release() {},
        async query(sql) {
          if (sql.startsWith("SELECT * FROM content"))
            return {
              rowCount: 1,
              rows: [
                {
                  id: "post",
                  status: "DRAFT",
                  title: "Test",
                  body: "Regression test",
                  version: 1,
                },
              ],
            };
          if (sql.startsWith("SELECT a.*"))
            return {
              rowCount: 1,
              rows: [
                {
                  id: accountId,
                  platform,
                  provider_id: destination,
                  ciphertext: encryptToken("test-token", "workspace"),
                },
              ],
            };
          if (sql.startsWith("SELECT id FROM scheduled_posts"))
            return { rows: [{ id: "schedule" }] };
          return { rowCount: 1, rows: [] };
        },
      });
      globalThis.fetch = async (url, init) => {
        sent = { url, init };
        return new Response(null, {
          status: 201,
          headers: { "x-restli-id": "urn:li:share:test" },
        });
      };
      SocialProviderRegistry.getProvider = (name) =>
        name === "telegram"
          ? {
              async publishText(config) {
                assert.deepEqual(config, {
                  botToken: "test-token",
                  chatId: destination,
                });
                return {
                  success: true,
                  providerPostId: "telegram-test",
                  publishedAt: new Date(),
                };
              },
            }
          : savedProvider.call(SocialProviderRegistry, name);
      const result = await new Controller().publishContent(
        { workspace: { id: "workspace", role: "Owner" }, user: { id: "user" } },
        "post",
        { socialAccountId: accountId },
      );
      assert.equal(result.success, true);
      if (platform === "linkedin") {
        assert.equal(sent.url, "https://api.linkedin.com/rest/posts");
        assert.equal(sent.init.headers.Authorization, "Bearer test-token");
        assert.equal(sent.init.headers["LinkedIn-Version"], "202609");
        assert.equal(JSON.parse(sent.init.body).author, destination);
      }
    }
  }
  console.log(
    "Both publish controllers pass saved LinkedIn tokens and authors; Telegram credentials remain correct. No posts sent.",
  );
} finally {
  pool.connect = savedConnect;
  pool.query = savedQuery;
  globalThis.fetch = savedFetch;
  SocialProviderRegistry.getProvider = savedProvider;
  await pool.end();
}
