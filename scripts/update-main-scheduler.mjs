import fs from 'node:fs';

let code = fs.readFileSync('server/main.ts', 'utf8').replace(/\r\n/g, '\n');

const target = `  await app.listen(Number(process.env.PORT || 3001), "0.0.0.0");
  const shutdown = async () => {
    await app.close();
    await limiter.quit();
    await pool.end();
  };`;

const replacement = `  await app.listen(Number(process.env.PORT || 3001), "0.0.0.0");

  // Built-in Auto-Scheduler Loop: Checks every 30s for due posts and publishes automatically
  const autoPublishInterval = setInterval(async () => {
    try {
      const { relayScheduledPosts } = await import("./cron-tasks.js");
      await relayScheduledPosts(pool);

      const duePosts = (await pool.query(
        \`SELECT id FROM scheduled_posts 
         WHERE state = 'ENQUEUED' AND execute_at <= NOW()
         ORDER BY execute_at ASC LIMIT 10\`
      )).rows;

      for (const sp of duePosts) {
        const { executePublishRecord } = await import("./publishing.js");
        try {
          await executePublishRecord(sp.id, { attemptsMade: 0, maxAttempts: 3 });
        } catch (postErr) {
          console.warn(\`[ContentOS] Auto-publish failed for post \${sp.id}:\`, (postErr as Error).message);
        }
      }
    } catch (schedErr) {
      console.warn("[ContentOS] Auto-scheduler poller warning:", (schedErr as Error).message);
    }
  }, 30000);

  const shutdown = async () => {
    clearInterval(autoPublishInterval);
    await app.close();
    await limiter.quit();
    await pool.end();
  };`;

if (!code.includes(target)) {
  console.error("Target not found in server/main.ts!");
  process.exit(1);
}

const updated = code.replace(target, replacement);
fs.writeFileSync('server/main.ts', updated, 'utf8');
console.log("Successfully updated server/main.ts with automatic publishing loop!");
