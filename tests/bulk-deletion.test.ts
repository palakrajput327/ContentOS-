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

    // 1. Fetch an existing workspace and user from database (preferring one under daily quota)
    const wsRes = await pool.query(`
      SELECT w.id FROM workspaces w
      WHERE EXISTS (
        SELECT 1 FROM workspace_members wm
        JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = w.id
      )
      AND (
        SELECT COUNT(*) FROM scheduled_posts sp
        WHERE sp.workspace_id = w.id AND sp.execute_at::date = CURRENT_DATE
      ) < 5
      ORDER BY w.created_at ASC
      LIMIT 1
    `);
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

  it("should preview overdue posts and soft-delete locally without calling platform APIs", async () => {
    const overduePostId = randomUUID();
    const overdueContentId = randomUUID();
    let platformCalled = false;

    const originalDelete = SocialPlatformDeleteService.deleteFromPlatform;
    SocialPlatformDeleteService.deleteFromPlatform = async () => {
      platformCalled = true;
      return { deleted: true };
    };

    try {
      await pool.query(
        `INSERT INTO content (id, workspace_id, title, body, platforms, status, created_by, updated_by)
         VALUES ($1, $2, 'Overdue Test Post', 'Overdue body', '["telegram"]'::jsonb, 'SCHEDULED', $3, $3)`,
        [overdueContentId, testWorkspaceId, testUserId]
      );
      await pool.query(
        `INSERT INTO scheduled_posts (id, workspace_id, content_id, account_id, content_version, execute_at, timezone, state)
         VALUES ($1, $2, $3, $4, 1, NOW() - INTERVAL '2 days', 'Asia/Kolkata', 'ENQUEUED')`,
        [overduePostId, testWorkspaceId, overdueContentId, testAccountId1]
      );

      const preview = await PostDeletionService.getDeletionPreview({
        workspaceId: testWorkspaceId,
        scope: "overdue",
        accountId: testAccountId1,
      });

      assert.ok(preview.overdueCount >= 1, "overdueCount should include the overdue ENQUEUED post");
      assert.ok(
        preview.items.some((item) => item.id === overduePostId),
        "overdue preview items should contain the overdue post"
      );

      const result = await PostDeletionService.executeBulkDeletion({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        role: "Owner",
        scope: "overdue",
        postIds: [overduePostId],
        deleteMode: "soft_local",
        confirm: true,
      });

      assert.equal(platformCalled, false, "soft_local must NOT invoke platform deletion API");
      assert.equal(result.totalRequested, 1, "totalRequested should be 1");
      assert.equal(result.deletedFromDatabase, 1, "soft_local should report 1 soft-deleted post");
      assert.equal(result.failed, 0, "soft_local should have 0 failures");

      const checkDb = await pool.query(
        "SELECT id, state, error_code FROM scheduled_posts WHERE id = $1",
        [overduePostId]
      );
      assert.equal(checkDb.rowCount, 1, "Database record MUST be preserved in soft_local mode");
      assert.equal(checkDb.rows[0].state, "CANCELLED", "State should be CANCELLED");
      assert.equal(checkDb.rows[0].error_code, "SOFT_DELETED_BY_USER", "error_code should record SOFT_DELETED_BY_USER");

      const afterPreview = await PostDeletionService.getDeletionPreview({
        workspaceId: testWorkspaceId,
        scope: "overdue",
        accountId: testAccountId1,
      });
      assert.ok(
        !afterPreview.items.some((item) => item.id === overduePostId),
        "Soft-deleted post should no longer appear in overdue preview"
      );
    } finally {
      SocialPlatformDeleteService.deleteFromPlatform = originalDelete;
      await pool.query("DELETE FROM scheduled_posts WHERE id = $1", [overduePostId]);
      await pool.query("DELETE FROM content WHERE id = $1", [overdueContentId]);
    }
  });

  it("should execute platform_only delete from account and transition content status to DRAFT", async () => {
    const pubPostId = randomUUID();
    const pubContentId = randomUUID();
    let platformDeletedTargetId: string | null = null;

    const originalDelete = SocialPlatformDeleteService.deleteFromPlatform;
    SocialPlatformDeleteService.deleteFromPlatform = async (_platform, _acc, providerId) => {
      platformDeletedTargetId = providerId;
      return { success: true, platformDeleted: true };
    };

    try {
      await pool.query(
        `INSERT INTO content (id, workspace_id, title, body, platforms, status, created_by, updated_by)
         VALUES ($1, $2, 'Published Account Delete Post', 'Published body', '["telegram"]'::jsonb, 'PUBLISHED', $3, $3)`,
        [pubContentId, testWorkspaceId, testUserId]
      );
      await pool.query(
        `INSERT INTO scheduled_posts (id, workspace_id, content_id, account_id, content_version, execute_at, timezone, state, provider_post_id)
         VALUES ($1, $2, $3, $4, 1, NOW() - INTERVAL '1 day', 'Asia/Kolkata', 'PUBLISHED', 'fake-tg-msg-999')`,
        [pubPostId, testWorkspaceId, pubContentId, testAccountId1]
      );
      await pool.query(
        `INSERT INTO published_posts (id, workspace_id, scheduled_post_id, provider_post_id, published_at)
         VALUES ($1, $2, $3, 'fake-tg-msg-999', NOW())`,
        [randomUUID(), testWorkspaceId, pubPostId]
      );

      // Verify preview matches by content_id (as sent from Content Library selection)
      const preview = await PostDeletionService.getDeletionPreview({
        workspaceId: testWorkspaceId,
        scope: "selected_ids",
        postIds: [pubContentId],
      });

      assert.equal(preview.items.length, 1, "Preview should find matching post by contentId");
      assert.equal(preview.items[0].id, pubPostId, "Preview item id should be scheduled_post_id");

      // Execute Delete from Account ('platform_only')
      const result = await PostDeletionService.executeBulkDeletion({
        workspaceId: testWorkspaceId,
        userId: testUserId,
        role: "Owner",
        scope: "selected_ids",
        postIds: [pubContentId],
        deleteMode: "platform_only",
        confirm: true,
      });

      assert.equal(result.deletedFromPlatform, 1, "Should report 1 post deleted from platform");
      assert.equal(platformDeletedTargetId, "fake-tg-msg-999", "Should call platform API with provider_post_id");

      // Verify scheduled_post state is CANCELLED and provider_post_id is cleared
      const checkPost = await pool.query(
        "SELECT state, provider_post_id, error_code FROM scheduled_posts WHERE id = $1",
        [pubPostId]
      );
      assert.equal(checkPost.rows[0].state, "CANCELLED");
      assert.equal(checkPost.rows[0].provider_post_id, null);

      // In Content Library, content status MUST now be DRAFT so it's removed from Published
      const checkContent = await pool.query(
        "SELECT status FROM content WHERE id = $1",
        [pubContentId]
      );
      assert.equal(checkContent.rows[0].status, "DRAFT", "Content status should transition to DRAFT");
    } finally {
      SocialPlatformDeleteService.deleteFromPlatform = originalDelete;
      await pool.query("DELETE FROM published_posts WHERE scheduled_post_id = $1", [pubPostId]);
      await pool.query("DELETE FROM scheduled_posts WHERE id = $1", [pubPostId]);
      await pool.query("DELETE FROM content WHERE id = $1", [pubContentId]);
    }
  });
});
