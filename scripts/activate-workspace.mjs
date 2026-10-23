import { pool } from '../dist-api/db.js';

async function main() {
  const wid = '4386cbf8-47bf-41fe-a925-0549bced08f2';
  const scalePlanId = '33333333-3333-4333-a333-333333333333';

  const res = await pool.query(`
    UPDATE workspace_subscriptions
    SET 
      status = 'ACTIVE',
      plan_id = $2,
      current_period_end = NOW() + INTERVAL '30 days',
      custom_daily_limit = 10,
      updated_at = NOW()
    WHERE workspace_id = $1
    RETURNING *
  `, [wid, scalePlanId]);
  console.log('Activated workspace subscription:', res.rows[0]);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
