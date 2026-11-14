import fs from 'node:fs';
import { pool } from '../server/db.ts';

async function main() {
  const sql = fs.readFileSync('server/migrations/033_manual_publication_policy.sql', 'utf8');
  console.log('Applying migration 033...');
  await pool.query(sql);
  await pool.query(`INSERT INTO schema_migrations(name, applied_at) VALUES('033_manual_publication_policy.sql', now()) ON CONFLICT DO NOTHING`);
  console.log('Migration 033 applied successfully!');
  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

