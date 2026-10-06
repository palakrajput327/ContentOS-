import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
process.loadEnvFile(path.join(process.cwd(), ".env"));

import { pool } from "../dist-api/db.js";
import { decryptToken } from "../dist-api/security.js";
import { SocialProviderRegistry } from "../dist-api/social.provider.js";
import { getStorageProvider } from "../dist-api/storage/storage.factory.js";
import { ClipdropService } from "../dist-api/clipdrop/clipdrop.service.js";

async function runTest() {
  console.log("=== STARTING LIVE SOCIAL PUBLISHING TEST ===");

  const wsRow = (await pool.query("SELECT id FROM workspaces LIMIT 1")).rows[0];
  const userRow = (await pool.query("SELECT id FROM users LIMIT 1")).rows[0];

  console.log(`Using Workspace ID: ${wsRow.id}, User ID: ${userRow.id}`);

  // 1. Generate visual using Clipdrop with HSS branding
  console.log("\n1. Generating visual with ClipdropService & HSS Branding...");
  const clipdrop = new ClipdropService();
  const visual = await clipdrop.generateImage({
    workspaceId: wsRow.id,
    userId: userRow.id,
    prompt: "Modern software solutions office abstract technology banner with blue and purple gradients",
    aspectRatio: "1:1",
    includeLogo: true,
    logoText: "HSS",
    websiteUrl: "https://hindustansoftwaresolution.com/",
    overlayHeadline: "Automate Social Media with ContentOS",
    ctaText: "Visit hindustansoftwaresolution.com",
    theme: "dark",
  });

  console.log(`Visual generated successfully! Storage Key: ${visual.asset.key}, URL: ${visual.asset.publicUrl}`);

  // 2. Query connected social accounts
  const accountsRes = await pool.query(
    "SELECT a.id, a.workspace_id, a.platform, a.provider_id, a.name, t.ciphertext FROM social_accounts a JOIN social_account_tokens t ON t.account_id = a.id",
  );

  console.log(`\nFound ${accountsRes.rowCount} connected social account(s):`);

  for (const acc of accountsRes.rows) {
    console.log(`- Platform: ${acc.platform}, Name: ${acc.name}, ProviderID: ${acc.provider_id}`);
  }

  const results = {};

  for (const acc of accountsRes.rows) {
    const platform = acc.platform;
    console.log(`\n--- Testing Publishing for ${platform.toUpperCase()} (${acc.name}) ---`);

    try {
      const token = decryptToken(acc.ciphertext, acc.workspace_id);
      const provider = SocialProviderRegistry.getProvider(platform);

      const config =
        platform === "telegram"
          ? { botToken: token, chatId: acc.provider_id }
          : { token, author: acc.provider_id };

      const publishReq = {
        text: `🚀 Live Test Post from ContentOS!\n\nAutomating multi-platform content publishing seamlessly.\n\n🌐 https://hindustansoftwaresolution.com/`,
        destination: acc.provider_id,
        mediaUrl: visual.asset.publicUrl,
      };

      console.log(`Publishing payload text length: ${publishReq.text.length}, mediaUrl: ${publishReq.mediaUrl}`);
      const res = await provider.publishText(config, publishReq);

      console.log(`Publish Result for ${platform}:`, JSON.stringify(res, null, 2));
      results[platform] = res;
    } catch (err) {
      console.error(`Error publishing to ${platform}:`, err);
      results[platform] = { success: false, error: err.message };
    }
  }

  console.log("\n=== LIVE PUBLISHING SUMMARY RESULTS ===");
  console.log(JSON.stringify(results, null, 2));

  await pool.end();
}

runTest().catch((e) => {
  console.error("Test failed with exception:", e);
  process.exit(1);
});
