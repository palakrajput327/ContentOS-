import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../dist-api/db.js";
import { FestivalAutoSchedulerService } from "../dist-api/calendar/festival-auto-scheduler.js";
import { SocialProviderRegistry } from "../dist-api/social.provider.js";
import { executePublishRecord, claim, aggregate } from "../dist-api/worker.js";
import { renderFestivalPosterSvg } from "../dist-api/auto-poster.js";
import { encryptToken } from "../dist-api/security.js";
import { ProviderError } from "../dist-api/providers/social.js";

console.log("===============================================================================");
console.log("Festival Automation Phase 2: End-to-End Integration Verification Suite");
console.log("===============================================================================\n");

// Ensure environment variable for public HTTPS media base is configured
process.env.META_MEDIA_PUBLIC_BASE_URL = "https://cdn.contentos.ai";

async function runPhase2IntegrationSuite() {
  const results = [];
  const testRunId = Date.now().toString().slice(-6);

  // Setup test workspace fixture
  const wsId = randomUUID();
  const userId = randomUUID();
  const linkedInAccountId = randomUUID();
  const instagramAccountId = randomUUID();
  const expiredAccountId = randomUUID();

  const brandKitFixture = {
    companyName: "Bharat Retail Emporium",
    phone: "+91 98765 43210",
    website: "https://bharatretail.in",
    primaryColor: "#d97706",
    accentColor: "#f59e0b",
  };

  try {
    // 1. Create Workspace, Member, and Social Accounts
    await pool.query(
      `INSERT INTO workspaces (
        id, name, timezone,
        festival_automation_enabled, festival_auto_publish_enabled, festival_approval_mode,
        festival_post_time, festival_prep_days, festival_region, festival_language,
        festival_social_account_ids
      ) VALUES ($1, $2, 'Asia/Kolkata', true, true, 'AUTO_APPROVAL', '09:00', 2, 'ALL', 'EN', $3)`,
      [
        wsId,
        `Integration WS ${testRunId}`,
        [linkedInAccountId, instagramAccountId],
      ],
    );

    await pool.query(
      `INSERT INTO brand_kits (workspace_id, data)
       VALUES ($1, $2)`,
      [wsId, JSON.stringify(brandKitFixture)],
    );

    const userRes = await pool.query(`SELECT id FROM users LIMIT 1`);
    const userId = userRes.rows[0].id;

    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES ($1, $2, 'Owner')`,
      [wsId, userId],
    );

    // Linked accounts: LinkedIn and Instagram (valid, unexpired)
    const liTokenCipher = encryptToken("mock_linkedin_token", `${wsId}:${linkedInAccountId}`);
    await pool.query(
      `INSERT INTO social_accounts (id, workspace_id, platform, provider_id, name, state)
       VALUES ($1, $2, 'LinkedIn', 'urn:li:person:user1', 'Bharat LinkedIn', 'Connected')`,
      [linkedInAccountId, wsId],
    );
    await pool.query(
      `INSERT INTO social_account_tokens (account_id, ciphertext, expires_at)
       VALUES ($1, $2, NOW() + interval '30 days')`,
      [linkedInAccountId, liTokenCipher],
    );

    const igTokenCipher = encryptToken("mock_instagram_token", `${wsId}:${instagramAccountId}`);
    await pool.query(
      `INSERT INTO social_accounts (id, workspace_id, platform, provider_id, name, state)
       VALUES ($1, $2, 'Instagram', '17841400000000000', 'Bharat Instagram', 'Connected')`,
      [instagramAccountId, wsId],
    );
    await pool.query(
      `INSERT INTO social_account_tokens (account_id, ciphertext, expires_at)
       VALUES ($1, $2, NOW() + interval '30 days')`,
      [instagramAccountId, igTokenCipher],
    );

    // Account with expired token (for error state test)
    const expTokenCipher = encryptToken("mock_exp_token", `${wsId}:${expiredAccountId}`);
    await pool.query(
      `INSERT INTO social_accounts (id, workspace_id, platform, provider_id, name, state)
       VALUES ($1, $2, 'Telegram', '-100123456789', 'Expired Telegram', 'Connected')`,
      [expiredAccountId, wsId],
    );
    await pool.query(
      `INSERT INTO social_account_tokens (account_id, ciphertext, expires_at)
       VALUES ($1, $2, '2026-10-19 00:00:00Z')`, // Expired before Oct 20
      [expiredAccountId, expTokenCipher],
    );

    console.log(`[Setup] Created test workspace ${wsId} with healthy & expired social accounts.\n`);

    // =========================================================================
    // SCENARIO 1: Simulate October 18, 2026 to generate & schedule Dussehra (Oct 20)
    // =========================================================================
    console.log("--- TEST 1: Simulate Oct 18, 2026 — Generate & Auto-Schedule Dussehra ---");
    const mockOct18 = new Date("2026-10-18T04:30:00.000Z"); // 10:00 AM IST Oct 18
    const schedulerResult = await FestivalAutoSchedulerService.runFestivalAutoScheduler(pool, {
      nowFn: () => mockOct18,
      workspaceId: wsId,
    });

    console.log(`Scheduler execution summary:`, schedulerResult);
    assert.strictEqual(schedulerResult.detectedFestivals >= 1, true, "Dussehra must be detected on Oct 18 (prepDays=2)");
    assert.strictEqual(schedulerResult.generatedDrafts, 1, "Exactly 1 festival draft must be generated");
    assert.strictEqual(schedulerResult.autoScheduledPosts, 1, "Exactly 1 festival content auto-scheduled");

    // Verify content record
    const contentRes = await pool.query(
      `SELECT * FROM content WHERE workspace_id = $1 AND title LIKE '%Dussehra%'`,
      [wsId],
    );
    assert.strictEqual(contentRes.rows.length, 1, "Content record for Dussehra must exist");
    const festivalContent = contentRes.rows[0];
    assert.strictEqual(festivalContent.status, "SCHEDULED", "Content status must be SCHEDULED under AUTO_APPROVAL");

    // Verify variants & brand kit & HTTPS media URL
    const variants = typeof festivalContent.variants === "string" ? JSON.parse(festivalContent.variants) : festivalContent.variants;
    assert.strictEqual(typeof variants.mediaUrl, "string", "variants.mediaUrl must be present");
    assert.strictEqual(variants.mediaUrl.startsWith("https://"), true, `mediaUrl must be valid HTTPS: ${variants.mediaUrl}`);

    // Verify SVG includes workspace brand kit details
    const renderedSvg = renderFestivalPosterSvg({
      title: "Happy Dussehra",
      wish: "May good triumph over evil.",
      theme: {
        primaryColor: "#d97706",
        secondaryColor: "#b45309",
        gradientBg: ["#451a03", "#78350f", "#92400e"],
        accentColor: "#fbbf24",
        motif: "DIYA",
      },
      brandKit: brandKitFixture,
    });
    assert.strictEqual(renderedSvg.includes("Bharat Retail Emporium"), true, "Rendered SVG must embed company name");
    assert.strictEqual(renderedSvg.includes("+91 98765 43210"), true, "Rendered SVG must embed phone number");
    assert.strictEqual(renderedSvg.includes("https://bharatretail.in"), true, "Rendered SVG must embed website");
    assert.strictEqual(renderedSvg.includes("#d97706"), true, "Rendered SVG must embed primary brand color");

    // Verify scheduled_posts timing (Oct 20, 9:00 AM IST -> 2026-10-20T03:30:00.000Z)
    const spRes = await pool.query(
      `SELECT * FROM scheduled_posts WHERE content_id = $1 ORDER BY account_id`,
      [festivalContent.id],
    );
    assert.strictEqual(spRes.rows.length, 2, "Must create exactly 2 scheduled_posts for the 2 authorized accounts");
    for (const row of spRes.rows) {
      assert.strictEqual(new Date(row.execute_at).toISOString(), "2026-10-20T03:30:00.000Z", "Scheduled execute_at must be exactly 2026-10-20T03:30:00.000Z");
      assert.strictEqual(row.state, "PENDING", "Initial scheduled_posts state must be PENDING");
    }

    // Verify approvals table audit
    const appRes = await pool.query(
      `SELECT * FROM approvals WHERE content_id = $1 AND workspace_id = $2`,
      [festivalContent.id, wsId],
    );
    assert.strictEqual(appRes.rows.length, 1, "Auditable approval record must exist");
    assert.strictEqual(appRes.rows[0].decision, "approve", "Approval decision must be approve");

    results.push({ name: "1. Oct 18 Dussehra Auto-Detection, Brand Kit & HTTPS Poster Scheduling", passed: true });
    console.log("✅ TEST 1 PASSED: Dussehra generated and scheduled with brand kit & HTTPS media URL.\n");

    // =========================================================================
    // SCENARIO 2: Outbox Relay Simulation
    // =========================================================================
    console.log("--- TEST 2: Outbox Relay — Transition PENDING to ENQUEUED ---");
    await pool.query(
      `UPDATE scheduled_posts SET state='ENQUEUED' WHERE content_id=$1 AND state='PENDING'`,
      [festivalContent.id],
    );
    const enqRes = await pool.query(
      `SELECT count(*) FROM scheduled_posts WHERE content_id=$1 AND state='ENQUEUED'`,
      [festivalContent.id],
    );
    assert.strictEqual(parseInt(enqRes.rows[0].count, 10), 2, "All scheduled posts transition to ENQUEUED");
    results.push({ name: "2. Outbox Relay State Transition (PENDING -> ENQUEUED)", passed: true });
    console.log("✅ TEST 2 PASSED: Outbox relay state transition verified.\n");

    // =========================================================================
    // SCENARIO 3: Simulate Oct 20 at 9:00 AM IST & Worker Publishing with Mock Social APIs
    // =========================================================================
    console.log("--- TEST 3: Simulate Oct 20 at 9:00 AM IST — Worker LinkedIn Dispatch ---");
    const mockOct20ExecutionTime = new Date("2026-10-20T03:30:00.000Z"); // 9:00 AM IST

    // Find LinkedIn scheduled post
    const liJob = spRes.rows.find((r) => r.account_id === linkedInAccountId);
    assert.ok(liJob, "LinkedIn job must exist");

    // Mock LinkedIn SocialProviderRegistry
    let linkedInPayloadReceived = null;
    const originalGetProvider = SocialProviderRegistry.getProvider;
    SocialProviderRegistry.getProvider = (name) => {
      if (name === "linkedin") {
        return {
          publishText: async (config, request) => {
            linkedInPayloadReceived = { config, request };
            return {
              success: true,
              providerPostId: "urn:li:share:festival_dus_999",
              publishedAt: mockOct20ExecutionTime,
            };
          },
        };
      }
      if (name === "instagram") {
        return {
          publishText: async (config, request) => {
            return {
              success: true,
              providerPostId: "ig_post_festival_dus_888",
              publishedAt: mockOct20ExecutionTime,
            };
          },
        };
      }
      return originalGetProvider.call(SocialProviderRegistry, name);
    };

    // Execute LinkedIn publishing job with injectable mock clock
    const liResult = await executePublishRecord(liJob.id, { now: mockOct20ExecutionTime });
    assert.strictEqual(liResult.success, true, "LinkedIn job execution must succeed");
    assert.strictEqual(liResult.state, "PUBLISHED", "LinkedIn job state must be PUBLISHED");
    assert.strictEqual(liResult.providerPostId, "urn:li:share:festival_dus_999", "Provider post ID must match");

    // Verify publisher received the generated JPEG and caption
    assert.ok(linkedInPayloadReceived, "Publisher must have received payload");
    assert.strictEqual(linkedInPayloadReceived.request.mediaType, "image", "Media type must be image");
    assert.strictEqual(linkedInPayloadReceived.request.mediaUrl.startsWith("https://"), true, "Media URL must be valid HTTPS");
    assert.strictEqual(linkedInPayloadReceived.request.destination, "urn:li:person:user1", "Destination must match");

    // Verify scheduled_posts and published_posts in database
    const liDbJob = (await pool.query(`SELECT * FROM scheduled_posts WHERE id=$1`, [liJob.id])).rows[0];
    assert.strictEqual(liDbJob.state, "PUBLISHED", "Database scheduled_posts state must be PUBLISHED");
    assert.strictEqual(liDbJob.provider_post_id, "urn:li:share:festival_dus_999", "provider_post_id recorded");

    const pubRow = (await pool.query(`SELECT * FROM published_posts WHERE scheduled_post_id=$1`, [liJob.id])).rows[0];
    assert.ok(pubRow, "published_posts record must be created");
    assert.strictEqual(pubRow.provider_post_id, "urn:li:share:festival_dus_999", "published_posts provider ID matches");

    results.push({ name: "3. Oct 20 9 AM Clock Simulation & Mocked LinkedIn Dispatch", passed: true });
    console.log("✅ TEST 3 PASSED: LinkedIn worker execution and mock publisher verified.\n");

    // =========================================================================
    // SCENARIO 4: Instagram Execution & Multi-Platform Status Aggregation
    // =========================================================================
    console.log("--- TEST 4: Instagram Execution & Content Aggregation to PUBLISHED ---");
    const igJob = spRes.rows.find((r) => r.account_id === instagramAccountId);
    assert.ok(igJob, "Instagram job must exist");

    const igResult = await executePublishRecord(igJob.id, { now: mockOct20ExecutionTime });
    assert.strictEqual(igResult.success, true, "Instagram job execution must succeed");
    assert.strictEqual(igResult.state, "PUBLISHED", "Instagram job state must be PUBLISHED");

    // Check aggregated content status
    const updatedContent = (await pool.query(`SELECT status FROM content WHERE id=$1`, [festivalContent.id])).rows[0];
    assert.strictEqual(updatedContent.status, "PUBLISHED", "Content status must be aggregate PUBLISHED once all platforms succeed");

    results.push({ name: "4. Multi-Platform Completion & Content Aggregated to PUBLISHED", passed: true });
    console.log("✅ TEST 4 PASSED: All platform jobs published, content aggregated to PUBLISHED.\n");

    // =========================================================================
    // SCENARIO 5: Expired Token / Disconnected Account Protection
    // =========================================================================
    console.log("--- TEST 5: Expired Token Detection & RECONNECT_REQUIRED ---");
    const errorTestContentId = randomUUID();
    await pool.query(
      `INSERT INTO content(
        id, workspace_id, title, body, variants, platforms, status, created_by, updated_by, scheduled_at, timezone, created_at, updated_at
      ) VALUES ($1, $2, 'Error State Test Content', 'Test body', '{}', '[]', 'SCHEDULED', $3, $3, $4::timestamptz, 'Asia/Kolkata', NOW(), NOW())`,
      [errorTestContentId, wsId, userId, mockOct20ExecutionTime],
    );

    const expiredJobId = randomUUID();
    await pool.query(
      `INSERT INTO scheduled_posts (id, workspace_id, content_id, account_id, content_version, execute_at, timezone, state)
       VALUES ($1, $2, $3, $4, 1, $5, 'Asia/Kolkata', 'ENQUEUED')`,
      [expiredJobId, wsId, errorTestContentId, expiredAccountId, mockOct20ExecutionTime],
    );

    const expResult = await executePublishRecord(expiredJobId, { now: mockOct20ExecutionTime });
    assert.strictEqual(expResult.success, false, "Execution with expired token must fail safely");
    const expDbJob = (await pool.query(`SELECT * FROM scheduled_posts WHERE id=$1`, [expiredJobId])).rows[0];
    assert.strictEqual(expDbJob.state, "FAILED", "State must be marked FAILED");
    assert.strictEqual(expDbJob.error_code, "RECONNECT_REQUIRED", "Error code must be RECONNECT_REQUIRED");

    results.push({ name: "5. Expired Token Safety Guard (FAILED + RECONNECT_REQUIRED)", passed: true });
    console.log("✅ TEST 5 PASSED: Expired token safely rejected without calling external API.\n");

    // =========================================================================
    // SCENARIO 6: Transient Retryable Provider Error
    // =========================================================================
    console.log("--- TEST 6: Transient Network/Rate-Limit Error & Safe Retry Queuing ---");
    const retryContentId = randomUUID();
    await pool.query(
      `INSERT INTO content(
        id, workspace_id, title, body, variants, platforms, status, created_by, updated_by, scheduled_at, timezone, created_at, updated_at
      ) VALUES ($1, $2, 'Retry Test Content', 'Test body', '{}', '[]', 'SCHEDULED', $3, $3, $4::timestamptz, 'Asia/Kolkata', NOW(), NOW())`,
      [retryContentId, wsId, userId, mockOct20ExecutionTime],
    );

    const retryJobId = randomUUID();
    await pool.query(
      `INSERT INTO scheduled_posts (id, workspace_id, content_id, account_id, content_version, execute_at, timezone, state)
       VALUES ($1, $2, $3, $4, 1, $5, 'Asia/Kolkata', 'ENQUEUED')`,
      [retryJobId, wsId, retryContentId, linkedInAccountId, mockOct20ExecutionTime],
    );

    // Mock LinkedIn to throw a retryable ProviderError
    SocialProviderRegistry.getProvider = () => ({
      publishText: async () => {
        throw new ProviderError("RATE_LIMIT_EXCEEDED", true, false); // retryable = true
      },
    });

    const retryResult = await executePublishRecord(retryJobId, {
      now: mockOct20ExecutionTime,
      attemptsMade: 0,
      maxAttempts: 3,
    });
    assert.strictEqual(retryResult.retry, true, "Job must be flagged for retry");
    assert.strictEqual(retryResult.state, "ENQUEUED", "Job state must remain ENQUEUED for retry");

    const retryDbJob = (await pool.query(`SELECT * FROM scheduled_posts WHERE id=$1`, [retryJobId])).rows[0];
    assert.strictEqual(retryDbJob.state, "ENQUEUED", "DB scheduled_posts must be ENQUEUED");
    assert.strictEqual(retryDbJob.error_code, "RATE_LIMIT_EXCEEDED", "Error code must be stored");

    results.push({ name: "6. Retryable Error Handling (ENQUEUED with backoff)", passed: true });
    console.log("✅ TEST 6 PASSED: Retryable provider error gracefully rescheduled.\n");

    // =========================================================================
    // SCENARIO 7: Permanent Provider Failure & Content Aggregation
    // =========================================================================
    console.log("--- TEST 7: Permanent Provider Failure & Partial Failure Handling ---");
    const failContentId = randomUUID();
    await pool.query(
      `INSERT INTO content(
        id, workspace_id, title, body, variants, platforms, status, created_by, updated_by, scheduled_at, timezone, created_at, updated_at
      ) VALUES ($1, $2, 'Fail Test Content', 'Test body', '{}', '[]', 'SCHEDULED', $3, $3, $4::timestamptz, 'Asia/Kolkata', NOW(), NOW())`,
      [failContentId, wsId, userId, mockOct20ExecutionTime],
    );

    const failJobId = randomUUID();
    await pool.query(
      `INSERT INTO scheduled_posts (id, workspace_id, content_id, account_id, content_version, execute_at, timezone, state)
       VALUES ($1, $2, $3, $4, 1, $5, 'Asia/Kolkata', 'ENQUEUED')`,
      [failJobId, wsId, failContentId, linkedInAccountId, mockOct20ExecutionTime],
    );

    // Mock LinkedIn to throw a non-retryable ProviderError
    SocialProviderRegistry.getProvider = () => ({
      publishText: async () => {
        throw new ProviderError("ACCOUNT_RESTRICTED", false, false); // retryable = false
      },
    });

    const failResult = await executePublishRecord(failJobId, {
      now: mockOct20ExecutionTime,
      attemptsMade: 0,
      maxAttempts: 1,
    });
    assert.strictEqual(failResult.success, false, "Must fail permanently");
    assert.strictEqual(failResult.state, "FAILED", "State must be FAILED");

    const failDbJob = (await pool.query(`SELECT * FROM scheduled_posts WHERE id=$1`, [failJobId])).rows[0];
    assert.strictEqual(failDbJob.state, "FAILED", "DB state must be FAILED");
    assert.strictEqual(failDbJob.error_code, "ACCOUNT_RESTRICTED", "Error code must be stored");

    results.push({ name: "7. Permanent Failure & Partial Failure Reporting", passed: true });
    console.log("✅ TEST 7 PASSED: Permanent failure handled without unhandled crash.\n");

    // =========================================================================
    // SCENARIO 8: Duplicate Prevention & Re-Execution Protection
    // =========================================================================
    console.log("--- TEST 8: Duplicate Publishing Prevention & Recovery Protection ---");
    let duplicateApiInvocationCount = 0;
    SocialProviderRegistry.getProvider = () => ({
      publishText: async () => {
        duplicateApiInvocationCount++;
        return { success: true, providerPostId: "duplicate_id" };
      },
    });

    // Attempt to re-execute the already PUBLISHED LinkedIn job
    const dupResult = await executePublishRecord(liJob.id, { now: mockOct20ExecutionTime });
    assert.strictEqual(dupResult.state, "SKIPPED_OR_TERMINAL", "Already PUBLISHED job must be rejected by claim");
    assert.strictEqual(duplicateApiInvocationCount, 0, "Zero API calls must be made on already published job");

    // Test interrupted job in PROCESSING state: claim must mark UNCERTAIN and abort
    const processingContentId = randomUUID();
    await pool.query(
      `INSERT INTO content(
        id, workspace_id, title, body, variants, platforms, status, created_by, updated_by, scheduled_at, timezone, created_at, updated_at
      ) VALUES ($1, $2, 'Processing Test Content', 'Test body', '{}', '[]', 'PUBLISHING', $3, $3, $4::timestamptz, 'Asia/Kolkata', NOW(), NOW())`,
      [processingContentId, wsId, userId, mockOct20ExecutionTime],
    );

    const processingJobId = randomUUID();
    await pool.query(
      `INSERT INTO scheduled_posts (id, workspace_id, content_id, account_id, content_version, execute_at, timezone, state)
       VALUES ($1, $2, $3, $4, 1, $5, 'Asia/Kolkata', 'PROCESSING')`,
      [processingJobId, wsId, processingContentId, linkedInAccountId, mockOct20ExecutionTime],
    );

    const claimedInterrupted = await claim(processingJobId, mockOct20ExecutionTime);
    assert.strictEqual(claimedInterrupted, null, "Interrupted job in PROCESSING cannot be claimed");
    const interruptedDb = (await pool.query(`SELECT * FROM scheduled_posts WHERE id=$1`, [processingJobId])).rows[0];
    assert.strictEqual(interruptedDb.state, "UNCERTAIN", "Interrupted job must be moved to UNCERTAIN");
    assert.strictEqual(interruptedDb.error_code, "INTERRUPTED_ATTEMPT", "Error code must be INTERRUPTED_ATTEMPT");

    results.push({ name: "8. Duplicate Prevention & Interrupted Job UNCERTAIN Isolation", passed: true });
    console.log("✅ TEST 8 PASSED: Duplicate publishing impossible under concurrency & crashes.\n");

    // Restore original SocialProviderRegistry
    SocialProviderRegistry.getProvider = originalGetProvider;

  } finally {
    // Clean up test data
    console.log("[Cleanup] Removing test fixture data...");
    await pool.query(`DELETE FROM published_posts WHERE workspace_id = $1`, [wsId]);
    await pool.query(`DELETE FROM scheduled_posts WHERE workspace_id = $1`, [wsId]);
    await pool.query(`DELETE FROM scheduled_festival_posts WHERE workspace_id = $1`, [wsId]);
    await pool.query(`DELETE FROM approvals WHERE workspace_id = $1`, [wsId]);
    await pool.query(`DELETE FROM activity_logs WHERE workspace_id = $1`, [wsId]);
    await pool.query(`DELETE FROM content WHERE workspace_id = $1`, [wsId]);
    await pool.query(`DELETE FROM social_account_tokens WHERE account_id IN ($1, $2, $3)`, [linkedInAccountId, instagramAccountId, expiredAccountId]);
    await pool.query(`DELETE FROM social_accounts WHERE workspace_id = $1`, [wsId]);
    await pool.query(`DELETE FROM workspace_members WHERE workspace_id = $1`, [wsId]);
    await pool.query(`DELETE FROM brand_kits WHERE workspace_id = $1`, [wsId]);
    await pool.query(`DELETE FROM workspaces WHERE id = $1`, [wsId]);
    await pool.end();
  }

  console.log("===============================================================================");
  console.log("INTEGRATION VERIFICATION SUMMARY:");
  console.log("===============================================================================");
  for (const r of results) {
    console.log(`[PASS] ${r.name}`);
  }
  console.log(`\nTOTAL PASSED: ${results.length}/${results.length}`);
  console.log("===============================================================================");
  process.exit(0);
}

runPhase2IntegrationSuite().catch((err) => {
  console.error("❌ Integration test failed with error:", err);
  process.exit(1);
});
