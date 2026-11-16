import { pool } from '../server/db.ts';

async function main() {
  const wsId = '4386cbf8-47bf-41fe-a925-0549bced08f2';
  await pool.query(`
    UPDATE workspace_subscriptions
    SET custom_daily_limit = 500,
        admin_override_note = 'Tester quota (500 slots)',
        updated_at = NOW()
    WHERE workspace_id = $1
  `, [wsId]);
  console.log('Successfully set custom_daily_limit = 500 for Palak workspace');
  process.exit(0);
}

main();

