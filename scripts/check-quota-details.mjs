import { pool } from '../server/db.ts';

async function main() {
  const wsId = '4386cbf8-47bf-41fe-a925-0549bced08f2';
  
  const sub = await pool.query(`
    SELECT ws.*, p.daily_post_limit as plan_limit
    FROM workspace_subscriptions ws
    LEFT JOIN subscription_plans p ON p.id = ws.plan_id
    WHERE ws.workspace_id = $1
  `, [wsId]);
  console.log('Subscription:', sub.rows);

  const quota = await pool.query(`
    SELECT business_date, state, count(*) 
    FROM publication_quota 
    WHERE workspace_id = $1 
    GROUP BY business_date, state
  `, [wsId]);
  console.log('Publication quota rows:', quota.rows);

  const reserved = await pool.query(`
    SELECT id, scheduled_post_id, business_date, state, created_at
    FROM publication_quota
    WHERE workspace_id = $1
    ORDER BY created_at DESC
    LIMIT 20
  `, [wsId]);
  console.log('Recent quota reservations:', reserved.rows);

  process.exit(0);
}

main();

