import { pool } from '../dist-api/db.js';

async function main() {
  const docs = await pool.query(
    "SELECT id, original_filename, status, page_count, created_at FROM documents WHERE workspace_id = '4386cbf8-47bf-41fe-a925-0549bced08f2' ORDER BY created_at DESC"
  );
  console.log('DOCUMENTS IN WORKSPACE:', docs.rows);
  process.exit(0);
}
main();
