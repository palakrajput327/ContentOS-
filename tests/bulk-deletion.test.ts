import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { PostDeletionService } from "../dist-api/posts/post-deletion.service.js";
import { SocialPlatformDeleteService } from "../dist-api/posts/social-platform-delete.service.js";

describe("ContentOS Bulk Post Deletion Integration & Regression Tests", () => {
  let pool: pg.Pool;
  let testWorkspaceId: string;
  let testUserId: string;
  let testAccountId1: string;
  let testAccountId2: string;
  let testContentId: string;
  let testPostId1: string;
  let testPostId2: string;
  let createdSocialAccounts = false;

  before(async () => {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
    });

    // 1. Fetch an existing workspace and user from database
    const wsRes = await pool.query("SELECT id FROM workspaces LIMIT 1");
    if (!wsRes.rowCount) {
      throw new Error("No workspace found in database for testing.");
    }
    testWorkspaceId = wsRes.rows[0].id;

    const userRes = await pool.query(
      "SELECT user_id FROM workspace_members WHERE workspace_id = $1 LIMIT 1",
      [testWorkspaceId]
    );
    testUserId = userRes.rowCount ? userRes.rows[0].user_id : randomUUID();

    // 2. Fetch or create social accounts for testing
    const accs = await pool.query(
      "SELECT id, platform FROM social_accounts WHERE workspace_id = $1",
      [testWorkspaceId]
    );

    const tgAcc = accs.rows.find((a) => a.platform.toLowerCase() === "telegram");
    const liAcc = accs.rows.find((a) => a.platform.toLowerCase() === "linkedin");

    if (tgAcc && liAcc) {
      testAccountId1 = tgAcc.id;
      testAccountId2 = liAcc.id;
    } else {
      createdSocialAccounts = true;
      testAccountId1 = randomUUID();
      testAccountId2 = randomUUID();
      await pool.query(
        `INSERT INTO social_accounts (id, workspace_id, platform, provider_id, name, state)
         VALUES 
           ($1, $2, 'telegram', 'test-tg-bot', 'Test Telegram Channel', 'Connected'),
           ($3, $2, 'linkedin', 'test-li-urn', 'Test LinkedIn Profile', 'Connected')
         ON CONFLICT (workspace_id, platform) DO UPDATE SET last_sync = NOW()`,
        [testAccountId1, testWorkspaceId, testAccountId2]
      );
      // Re-fetch in case conflict resolved to existing
      const reAccs = await pool.query("SELECT id, platform FROM social_accounts WHERE workspace_id = $1", [testWorkspaceId]);
      testAccountId1 = reAccs.rows.find((a) => a.platform.toLowerCase() === "telegram")?.id || testAccountId1;
      testAccountId2 = reAccs.rows.find((a) => a.platform.toLowerCase() === "linkedin")?.id || testAccountId2;
    }

    // 3. Insert test content item with valid schema
    testContentId = randomUUID();
    await pool.query(
      `INSERT INTO content (id, workspace_id, title, body, platforms, status, version, created_by, updated_by)
       VALUES ($1, $2, 'Automated Test Content - Bulk Delete', 'Test Body', '["telegram", "linkedin"]'::jsonb, 'DRAFT', 1, $3, $3)`,
      [testContentId, testWorkspaceId, testUserId]
    );

    // 4. Insert test scheduled posts
    testPostId1 = randomUUID();
    testPostId2 = randomUUID();

    await pool.query(
      `INSERT INTO scheduled_posts (id, workspace_id, content_id, account_id, content_version, execute_at, timezone, state)
       VALUES ($1, $2, $3, $4, 1, NOW() + interval '2 hours', 'Asia/Kolkata', 'PENDING')`,
      [testPostId1, testWorkspaceId, testContentId, testAccountId1]
    );

    await pool.query(
      `INSERT INTO scheduled_posts (id, workspace_id, content_id, account_id, content_version, execute_at, timezone, state)
       VALUES ($1, $2, $3, $4, 1, NOW() + interval '4 hours', 'Asia/Kolkata', 'ENQUEUED')`,
      [testPostId2, testWorkspaceId, testContentId, testAccountId2]
    );
  });

  after(async () => {
    // Clean up test data
    try {
      await pool.query("DELETE FROM scheduled_posts WHERE id IN ($1, $2)", [testPostId1, testPostId2]);
      await pool.query("DELETE FROM content WHERE id = $1", [testContentId]);
      if (createdSocialAccounts) {
        await pool.query("DELETE FROM social_accounts WHERE id IN ($1, $2)", [testAccountId1, testAccountId2]);
      }
    } catch {}
    await pool.end();
  });

  it("1. Generates deletion preview for 'all' scope", async () => {
    const preview = await PostDeletionService.getDeletionPreview({
      workspaceId: testWorkspaceId,
      scope: "all",
    });

    assert.ok(preview, "Preview object should be returned");
    assert.equal(typeof preview.totalMatching, "number", "totalMatching should be a number");
    assert.ok(Array.isArray(preview.items), "preview.items should be an array");
    assert.ok(preview.totalMatching >= 2, "Should match at least our 2 newly created test posts");

    const matchedIds = preview.items.map((i) => i.id);
    assert.ok(matchedIds.includes(testPostId1), "Should include testPostId1 in preview");
    assert.ok(matchedIds.includes(testPostId2), "Should include testPostId2 in preview");
  });

  it("2. Filters preview by specific channel (telegram)", async () => {
    const preview = await PostDeletionService.getDeletionPreview({
      workspaceId: testWorkspaceId,
      scope: "all",
      channel: "telegram",
    });

    assert.ok(preview.items.length >= 1, "Should match telegram posts");
    const matchedIds = preview.items.map((i) => i.id);
    assert.ok(matchedIds.includes(testPostId1), "Should include testPostId1");
    assert.ok(!matchedIds.includes(testPostId2), "Should NOT include testPostId2 (linkedin)");
  });

  it("3. Filters preview by explicit postIds ('selected_ids' scope)", async () => {
    const preview = await PostDeletionService.getDeletionPreview({
      workspaceId: testWorkspaceId,
      scope: "selected_ids",
      postIds: [testPostId1],
    });

    assert.equal(preview.items.length, 1, "Should match exactly 1 selected post");
    assert.equal(preview.items[0].id, testPostId1, "Should match testPostId1");
  });

  it("4. Rejects execution when confirm is false or missing", async () => {
    await assert.rejects(
      async () => {
        await PostDeletionService.executeBulkDeletion({
          workspaceId: testWorkspaceId,
          userId: testUserId,
          role: "Owner",
          scope: "selected_ids",
          postIds: [testPostId1],
          confirm: false,
        });
      },
      {
        message: /Explicit confirmation is required/i,
      },
      "Should reject deletion without confirm=true"
    );
  });

  it("5. Successfully executes deletion for selected test post", async () => {
    const result = await PostDeletionService.executeBulkDeletion({
      workspaceId: testWorkspaceId,
      userId: testUserId,
      role: "Owner",
      scope: "selected_ids",
      postIds: [testPostId1],
      confirm: true,
      deleteFromPlatform: false,
    });

    assert.equal(result.totalRequested, 1, "totalRequested should be 1");
    assert.equal(result.deletedFromDatabase, 1, "deletedFromDatabase should be 1");
    assert.equal(result.logs[0].status, "DELETED", "Item status in logs should be DELETED");

    // Verify it is truly gone from database
    const checkDb = await pool.query("SELECT id FROM scheduled_posts WHERE id = $1", [testPostId1]);
    assert.equal(checkDb.rowCount, 0, "Post record must be deleted from database");
  });

  it("6. Preserves local database record if external platform deletion fails", async () => {
    // Insert a separate content item and published post with a fake provider_post_id
    const failContentId = randomUUID();
    const failPostId = randomUUID();

    await pool.query(
      `INSERT INTO content (id, workspace_id, title, body, platforms, status, version, created_by, updated_by)
       VALUES ($1, $2, 'Fail Safety Content', 'Test Body', '["telegram"]'::jsonb, 'PUBLISHED', 1, $3, $3)`,
      [failContentId, testWorkspaceId, testUserId]
    );

    await pool.query(
      `INSERT INTO scheduled_posts (id, workspace_id, content_id, account_id, content_version, execute_at, timezone, state, provider_post_id)
       VALUES ($1, $2, $3, $4, 1, NOW(), 'Asia/Kolkata', 'PUBLISHED', 'invalid_provider_id_999999')`,
      [failPostId, testWorkspaceId, failContentId, testAccountId1]
    );

    // Mock platform deletion to simulate API error
    const originalDelete = SocialPlatformDeleteService.deleteFromPlatform;
    SocialPlatformDeleteService.deleteFromPlatform = async () => ({
      success: false,
      error: "Telegram API 400: Bad Request: message to delete not found or token revoked",
    });

    try {
      const result = await PostDeletionService.executeBulkDeletion({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        role: "Owner",
        scope: "selected_ids",
        postIds: [failPostId],
        confirm: true,
        deleteFromPlatform: true,
      });

      assert.equal(result.failed, 1, "failed count should be 1");
      assert.equal(result.logs[0].status, "FAILED", "Item status in logs should be marked FAILED");

      // Verify safety invariant: database record MUST still exist!
      const checkDb = await pool.query("SELECT id, state, error_code FROM scheduled_posts WHERE id = $1", [failPostId]);
      assert.equal(checkDb.rowCount, 1, "Database record MUST be preserved when platform deletion fails");
      assert.ok(checkDb.rows[0].error_code?.includes("Telegram API 400"), "Error code should record the platform failure");

      // Clean up manually
      await pool.query("DELETE FROM scheduled_posts WHERE id = $1", [failPostId]);
      await pool.query("DELETE FROM content WHERE id = $1", [failContentId]);
    } finally {
      SocialPlatformDeleteService.deleteFromPlatform = originalDelete;
    }
  });
});
