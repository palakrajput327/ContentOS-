import { pool } from '../server/db.ts';

async function main() {
  const r = await pool.query(`
    SELECT proname, proargnames, prosrc 
    FROM pg_proc 
    WHERE proname = 'publication_requires_approval'
  `);
  console.log('Function in DB:', r.rows);
  process.exit(0);
}

main();

