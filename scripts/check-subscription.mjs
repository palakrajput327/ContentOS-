import { pool } from '../dist-api/db.js';

async function main() {
  const wid = '4386cbf8-47bf-41fe-a925-0549bced08f2';
  const sub = (await pool.query('SELECT * FROM workspace_subscriptions WHERE workspace_id = $1', [wid])).rows[0];
  console.log('Subscription:', sub);

  const trials = (await pool.query('SELECT * FROM workspace_trials WHERE workspace_id = $1', [wid])).rows[0];
  console.log('Trial:', trials);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
