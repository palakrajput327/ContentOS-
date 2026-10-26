import { pool } from '../dist-api/db.js';

async function main() {
  const row = (await pool.query(
    `SELECT sp.*, c.status as content_status 
     FROM scheduled_posts sp 
     JOIN content c ON c.id = sp.content_id 
     WHERE sp.id = $1`,
    ['203d9d70-c192-4b51-a605-bd62749ae7e2']
  )).rows[0];

  console.log('Post Execution Status:', JSON.stringify(row, null, 2));
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
