import { pool } from '../dist-api/db.js';

async function main() {
  const wid = '4386cbf8-47bf-41fe-a925-0549bced08f2';
  const row = (await pool.query("SELECT id, title, body, variants, platforms, status, poster_spec FROM content WHERE id = '48a7692e-3703-43c4-b730-9684369da935'")).rows[0];
  console.log('CONTENT ROW 48a7692e:', JSON.stringify(row, null, 2));

  const scheduled = (await pool.query("SELECT * FROM scheduled_posts WHERE content_id = '48a7692e-3703-43c4-b730-9684369da935'")).rows;
  console.log('SCHEDULED POSTS:', scheduled);

  process.exit(0);
}
main();
