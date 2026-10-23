import { pool } from '../dist-api/db.js';

async function main() {
  const row = (await pool.query('SELECT id, bucket, object_key, mime_type, metadata FROM media_assets WHERE id = $1', ['5f70272e-a61f-4b93-91de-d598dcc10a03'])).rows[0];
  console.log('Asset in DB:', JSON.stringify(row, null, 2));

  const allKeys = (await pool.query("SELECT id, object_key FROM media_assets WHERE workspace_id = '4386cbf8-47bf-41fe-a925-0549bced08f2' ORDER BY created_at DESC LIMIT 5")).rows;
  console.log('Recent media assets:', allKeys);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
