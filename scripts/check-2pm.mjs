import { pool } from '../dist-api/db.js';

async function main() {
  const ids = [
    '50752476-229c-47b5-9802-34da6cf3158b',
    '8f1a24f2-460f-47c2-b95f-4d5b280afd3c',
    'e715da33-b26b-49bd-801f-9971faa190e9',
    'b3d313c0-5b3e-49c7-94b3-223a577769f3'
  ];
  const posts = (await pool.query(`
    SELECT sp.id, sp.state, sp.execute_at, sp.error_code, sp.publish_warning, sp.attempt_started_at, sp.provider_post_id, sa.platform
    FROM scheduled_posts sp
    JOIN social_accounts sa ON sa.id = sp.account_id
    WHERE sp.id = ANY($1)
  `, [ids])).rows;
  console.log('2 PM Posts status:');
  console.log(JSON.stringify(posts, null, 2));

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
