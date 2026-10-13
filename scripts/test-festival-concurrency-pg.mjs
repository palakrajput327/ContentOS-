import "reflect-metadata";
import assert from "node:assert/strict";
import { pool } from "../dist-api/db.js";
import { randomUUID } from "node:crypto";

console.log("===============================================================");
console.log("Running PostgreSQL Database-Level Concurrency & Idempotency Test");
console.log("===============================================================\n");

async function testPgConcurrency() {
  const wsRes = await pool.query(`SELECT id FROM workspaces LIMIT 1`);
  const testWsId = wsRes.rows[0].id;
  const testFestId = "test_fest_" + Date.now();
  const testDate = "2026-11-08";

  console.log(`Using workspace: ${testWsId}`);

  try {
    console.log("1. Testing atomic lock concurrency on scheduled_festival_posts...");
    // Simulate 5 simultaneous worker threads attempting to insert the exact same festival post
    const attempts = await Promise.all(
      [1, 2, 3, 4, 5].map(async () => {
        const res = await pool.query(
          `INSERT INTO scheduled_festival_posts (id, workspace_id, festival_id, festival_date, status, publish_status)
           VALUES ($1, $2, $3, $4, 'PROCESSING', 'PENDING')
           ON CONFLICT (workspace_id, festival_id, festival_date) DO NOTHING
           RETURNING id`,
          [randomUUID(), testWsId, testFestId, testDate],
        );
        return res.rowCount;
      }),
    );

    const winnerCount = attempts.filter((cnt) => cnt === 1).length;
    const loserCount = attempts.filter((cnt) => cnt === 0).length;

    console.log(`Winners (lock acquired): ${winnerCount}, Losers (idempotently skipped): ${loserCount}`);
    assert.strictEqual(winnerCount, 1, "Exactly 1 concurrent attempt must acquire the lock");
    assert.strictEqual(loserCount, 4, "All 4 other concurrent attempts must be safely skipped");

    // Verify row count in database
    const countRes = await pool.query(
      `SELECT count(*) FROM scheduled_festival_posts WHERE workspace_id = $1 AND festival_id = $2`,
      [testWsId, testFestId],
    );
    assert.strictEqual(parseInt(countRes.rows[0].count, 10), 1, "Exactly 1 record must exist in DB");
    console.log("✅ PostgreSQL scheduled_festival_posts unique constraint verified.\n");

    console.log("2. Testing idempotency on scheduled_posts...");
    // Fetch an existing user and social account for foreign key relationships
    const userRes = await pool.query(`SELECT id FROM users LIMIT 1`);
    const dummyUserId = userRes.rows[0].id;

    const dummyContentId = randomUUID();
    await pool.query(
      `INSERT INTO content (id, workspace_id, title, body, platforms, status, created_by, updated_by)
       VALUES ($1, $2, 'Concurrency Test Post', 'Post Body', '["LinkedIn"]', 'SCHEDULED', $3, $3)`,
      [dummyContentId, testWsId, dummyUserId],
    );

    // Check if an existing social account exists for this workspace or create one
    let accRes = await pool.query(`SELECT id FROM social_accounts WHERE workspace_id = $1 LIMIT 1`, [testWsId]);
    let dummyAccountId;
    if (accRes.rows.length > 0) {
      dummyAccountId = accRes.rows[0].id;
    } else {
      dummyAccountId = randomUUID();
      await pool.query(
        `INSERT INTO social_accounts (id, workspace_id, platform, provider_id, name, state)
         VALUES ($1, $2, 'LinkedIn', 'urn:li:test', 'Test Acc', 'Connected')`,
        [dummyAccountId, testWsId],
      );
    }

    // Run 5 simultaneous inserts into scheduled_posts
    const spAttempts = await Promise.all(
      [1, 2, 3, 4, 5].map(async () => {
        const res = await pool.query(
          `INSERT INTO scheduled_posts (id, workspace_id, content_id, account_id, content_version, execute_at, timezone, state)
           VALUES ($1, $2, $3, $4, 1, NOW() + interval '1 day', 'Asia/Kolkata', 'PENDING')
           ON CONFLICT (content_id, account_id, content_version) DO NOTHING
           RETURNING id`,
          [randomUUID(), testWsId, dummyContentId, dummyAccountId],
        );
        return res.rowCount;
      }),
    );

    const spWinners = spAttempts.filter((c) => c === 1).length;
    const spLosers = spAttempts.filter((c) => c === 0).length;
    console.log(`scheduled_posts Winners: ${spWinners}, Losers: ${spLosers}`);
    assert.strictEqual(spWinners, 1, "Exactly 1 scheduled_posts row must be inserted");
    assert.strictEqual(spLosers, 4, "Remaining 4 must conflict and do nothing");

    const spCount = await pool.query(
      `SELECT count(*) FROM scheduled_posts WHERE content_id = $1`,
      [dummyContentId],
    );
    assert.strictEqual(parseInt(spCount.rows[0].count, 10), 1, "Exactly 1 scheduled_posts entry exists");
    console.log("✅ PostgreSQL scheduled_posts unique constraint verified.\n");

    console.log("===============================================================");
    console.log("🎉 POSTGRESQL CONCURRENCY & UNIQUE CONSTRAINTS VERIFIED 100%!");
    console.log("===============================================================");
  } finally {
    // Clean up temporary test data
    await pool.query(`DELETE FROM scheduled_festival_posts WHERE festival_id = $1`, [testFestId]);
    await pool.end();
  }
}

testPgConcurrency().catch((err) => {
  console.error("❌ Concurrency test failed:", err);
  process.exit(1);
});
