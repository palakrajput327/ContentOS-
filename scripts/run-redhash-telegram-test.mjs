import { randomUUID } from "node:crypto";
import { pool } from "../dist-api/db.js";
import { ClipdropService } from "../dist-api/clipdrop/clipdrop.service.js";
import { generateCaptions } from "../dist-api/ai.controller.js";
import { getStorageProvider } from "../dist-api/storage/storage.factory.js";

async function main() {
  console.log("=== Running Redhash.pdf Automation -> Telegram Post Test ===");

  const email = "geminipalak19@gmail.com";
  const userRow = (await pool.query("SELECT id, email FROM users WHERE email = $1", [email])).rows[0];
  if (!userRow) throw new Error(`User ${email} not found`);
  const userId = userRow.id;

  const wsRow = (
    await pool.query(
      `SELECT w.id, w.name, w.timezone 
       FROM workspaces w 
       JOIN workspace_members wm ON wm.workspace_id = w.id 
       WHERE wm.user_id = $1`,
      [userId]
    )
  ).rows[0];
  if (!wsRow) throw new Error("Workspace not found for user");
  const workspaceId = wsRow.id;
  console.log(`Workspace: ${wsRow.name} (${workspaceId})`);

  // Verify connected Telegram account
  const tgAccount = (
    await pool.query(
      "SELECT id, platform, name, state FROM social_accounts WHERE workspace_id = $1 AND lower(platform) = 'telegram' AND lower(state) = 'connected'",
      [workspaceId]
    )
  ).rows[0];
  if (!tgAccount) throw new Error("No connected Telegram account found in workspace");
  console.log(`Connected Telegram Account: ${tgAccount.name} (${tgAccount.id})`);

  // Fetch Redhash.pdf document & knowledge
  const doc = (
    await pool.query(
      "SELECT id, original_filename, page_count FROM documents WHERE workspace_id = $1 AND original_filename ILIKE '%redhash%' ORDER BY created_at DESC LIMIT 1",
      [workspaceId]
    )
  ).rows[0];
  if (!doc) throw new Error("Redhash.pdf document not found");
  console.log(`Found Document: ${doc.original_filename} (${doc.id}, ${doc.page_count} pages)`);

  const knowledge = (
    await pool.query(
      "SELECT id, knowledge_key, value, source_excerpt, page_start FROM document_knowledge WHERE document_id = $1 AND workspace_id = $2 AND status = 'CONFIRMED' ORDER BY id ASC LIMIT 1",
      [doc.id, workspaceId]
    )
  ).rows[0] || (
    await pool.query(
      "SELECT id, knowledge_key, value, source_excerpt, page_start FROM document_knowledge WHERE document_id = $1 AND workspace_id = $2 ORDER BY id ASC LIMIT 1",
      [doc.id, workspaceId]
    )
  ).rows[0];

  const knowledgeConcept = String(knowledge?.value || "Redhash Brand Scaling & Viral Engagement Framework");
  const sourceExcerpt = String(knowledge?.source_excerpt || "Strategic framework for digital brand scaling and social reach.");
  const sourceVisualContext = `Extracted diagram & figure from Redhash.pdf (Page ${knowledge?.page_start || 1})`;
  console.log(`\n[Step 1: Knowledge Extracted from PDF]\nConcept: ${knowledgeConcept}\nExcerpt: ${sourceExcerpt}\nVisual Context: ${sourceVisualContext}`);

  // Fetch brand kit
  const brand = (await pool.query("SELECT data FROM brand_kits WHERE workspace_id = $1", [workspaceId])).rows[0]?.data || {
    primary_color: "#704bd6",
    tone: "Professional, Inspiring",
  };

  // Step 2: AI Poster Prompt Generation
  console.log("\n[Step 2: Generating Creative Visual Poster Prompt using AI...]");
  const clipdrop = new ClipdropService();
  const promptResult = await clipdrop.suggestPosterPrompt({
    knowledgeConcept,
    excerpt: sourceExcerpt,
    sourceVisualContext,
    title: "Redhash Social Scaling Framework",
    brand,
    platform: "Telegram",
  });
  console.log("Creative Poster Prompt Generated:\n", promptResult.prompt);
  console.log("Poster Headline Generated:\n", promptResult.headline);

  // Step 3: AI Captions & Hashtags Generation
  console.log("\n[Step 3: Generating Telegram Captions & Viral Hashtags...]");
  const captionsResult = await generateCaptions(
    JSON.stringify({
      instruction: "Create high-converting social update for Telegram with clear value bullets and call to action.",
      knowledge: knowledgeConcept,
      evidence: [{ excerpt: sourceExcerpt }],
    }),
    "Professional",
    "Engagement",
    ["Telegram"],
    brand
  );
  const captionText = captionsResult.variants["Telegram"] || captionsResult.title;
  console.log("Generated Telegram Caption:\n", captionText);

  // Step 4: AI Poster Image Generation via Clipdrop / FLUX
  console.log("\n[Step 4: Generating Social Media Poster Image via AI Image Engine...]");
  const genVisual = await clipdrop.generateImage({
    workspaceId,
    userId,
    prompt: promptResult.prompt,
    aspectRatio: "1:1",
    headline: promptResult.headline || "Redhash Growth",
    stylePreset: "3d-render",
    enableOverlay: true,
    platform: "Telegram",
    idempotencyKey: `redhash-test:${workspaceId}:${Date.now()}`,
  });
  console.log("Generated Poster Asset ID:", genVisual.assetId);
  console.log("Generated Poster URL:", genVisual.url);

  // Step 5: Schedule for 1:15 PM today (Asia/Kolkata)
  // Current time: 2026-10-26T13:xx:xx+05:30 -> 1:15 PM is 2026-10-26T13:15:00+05:30 = 2026-10-26T07:45:00Z
  const scheduledTimeIST = "2026-10-26T13:15:00+05:30";
  const scheduledTimeUTC = new Date(scheduledTimeIST).toISOString();
  console.log(`\n[Step 5: Scheduling for ${scheduledTimeIST} (UTC: ${scheduledTimeUTC})]`);

  const contentId = randomUUID();
  const scheduleId = randomUUID();

  const variants = {
    Telegram: {
      caption: captionText,
      mediaUrl: genVisual.url,
      mediaAssetId: genVisual.assetId,
      mediaType: "image",
    },
    metadata: {
      content_source: "KNOWLEDGE_AUTOMATION_TEST",
      pdfDocument: doc.original_filename,
    },
  };

  // Insert content
  await pool.query(
    `INSERT INTO content(id, workspace_id, title, body, platforms, variants, status, scheduled_at, created_by, updated_by, timezone)
     VALUES($1, $2, $3, $4, $5, $6, 'SCHEDULED', $7, $8, $8, $9)`,
    [
      contentId,
      workspaceId,
      captionsResult.title || promptResult.headline,
      captionText,
      JSON.stringify(["Telegram"]),
      JSON.stringify(variants),
      scheduledTimeUTC,
      userId,
      wsRow.timezone || "Asia/Kolkata",
    ]
  );

  // Insert scheduled_post
  await pool.query(
    `INSERT INTO scheduled_posts(id, workspace_id, content_id, account_id, content_version, execute_at, timezone, state)
     VALUES($1, $2, $3, $4, 1, $5, $6, 'ENQUEUED')`,
    [
      scheduleId,
      workspaceId,
      contentId,
      tgAccount.id,
      scheduledTimeUTC,
      wsRow.timezone || "Asia/Kolkata",
    ]
  );

  console.log("\n[SUCCESS] Post successfully created and scheduled!");
  console.log(`Content ID: ${contentId}`);
  console.log(`Scheduled Post ID: ${scheduleId}`);
  console.log(`Scheduled Time: 1:15 PM IST (${scheduledTimeUTC})`);
  console.log(`Account: Telegram (@hindustan_smm_bot)`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
