import { pool } from '../dist-api/db.js';

async function main() {
  const u = await pool.query("SELECT * FROM users WHERE email = $1", ['geminipalak19@gmail.com']);
  console.log('User:', JSON.stringify(u.rows[0], null, 2));

  if (u.rows[0]) {
    const userId = u.rows[0].id;
    const m = await pool.query("SELECT * FROM workspace_members WHERE user_id = $1", [userId]);
    console.log('Members:', JSON.stringify(m.rows, null, 2));

    const wids = m.rows.map(r => r.workspace_id);
    const w = await pool.query("SELECT * FROM workspaces WHERE id = ANY($1)", [wids]);
    console.log('Workspaces:', JSON.stringify(w.rows, null, 2));

    const s = await pool.query("SELECT * FROM workspace_subscriptions WHERE workspace_id = ANY($1)", [wids]);
    console.log('Subscriptions:', JSON.stringify(s.rows, null, 2));

    const t = await pool.query("SELECT * FROM workspace_trials WHERE workspace_id = ANY($1)", [wids]);
    console.log('Trials:', JSON.stringify(t.rows, null, 2));
  }

  await pool.end();
}

main().catch(console.error);
