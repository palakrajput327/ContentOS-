import { pool } from '../dist-api/db.js';
import { executePublishRecord } from '../dist-api/publishing.js';

async function main() {
  const id = 'e715da33-b26b-49bd-801f-9971faa190e9';
  await pool.query("UPDATE scheduled_posts SET state='ENQUEUED', error_code=null, attempt_started_at=null WHERE id=$1", [id]);
  console.log(`Re-executing publish for Telegram post ${id}...`);
  const res = await executePublishRecord(id, { attemptsMade: 0, maxAttempts: 3 });
  console.log('Telegram Result:', res);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
