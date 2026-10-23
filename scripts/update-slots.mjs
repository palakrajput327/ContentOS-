import { pool } from '../dist-api/db.js';

async function main() {
  const wid = '4386cbf8-47bf-41fe-a925-0549bced08f2';
  const res = await pool.query(`
    UPDATE knowledge_automation_settings
    SET posting_time = '15:00,16:00,17:00', updated_at = now()
    WHERE workspace_id = $1
    RETURNING workspace_id, enabled, posting_time, poster_style, updated_at
  `, [wid]);
  console.log('Updated settings:', JSON.stringify(res.rows[0], null, 2));
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
