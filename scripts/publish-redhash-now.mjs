import { pool } from '../dist-api/db.js';
import { executePublishRecord } from '../dist-api/publishing.js';

const postId = '203d9d70-c192-4b51-a605-bd62749ae7e2';

async function main() {
  console.log(`--- Re-dispatching post ${postId} to Telegram ---`);
  
  await pool.query(
    "UPDATE scheduled_posts SET state='ENQUEUED', error_code=null, attempt_started_at=null WHERE id=$1",
    [postId]
  );

  const res = await executePublishRecord(postId, { attemptsMade: 0, maxAttempts: 3 });
  console.log('Publish result:', JSON.stringify(res, null, 2));

  const postState = (await pool.query("SELECT id, state, provider_post_id, error_code FROM scheduled_posts WHERE id=$1", [postId])).rows[0];
  console.log('Final DB State:', postState);

  process.exit(0);
}

main().catch(err => {
  console.error('Error in main:', err);
  process.exit(1);
});
