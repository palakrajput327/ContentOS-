import { pool } from '../server/db.ts';

async function main() {
  const r = await pool.query(`SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 10`);
  console.log('Latest applied migrations:', r.rows);
  process.exit(0);
}
main();
