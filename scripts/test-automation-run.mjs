import { pool } from '../dist-api/db.js';

async function main() {
  const users = await pool.query('SELECT id, email FROM users WHERE email = $1', ['geminipalak19@gmail.com']);
  console.log('User:', JSON.stringify(users.rows, null, 2));

  if (users.rows.length) {
    const uid = users.rows[0].id;
    const ws = await pool.query(
      `SELECT w.id, w.name, w.timezone, wm.role 
       FROM workspaces w 
       JOIN workspace_members wm ON wm.workspace_id = w.id 
       WHERE wm.user_id = $1`,
      [uid]
    );
    console.log('Workspaces:', JSON.stringify(ws.rows, null, 2));

    for (const w of ws.rows) {
      console.log(`\n--- Workspace ${w.name} (${w.id}) ---`);
      const accounts = await pool.query(
        'SELECT id, platform, name, state FROM social_accounts WHERE workspace_id = $1',
        [w.id]
      );
      console.log('Connected Accounts:', JSON.stringify(accounts.rows, null, 2));

      const docs = await pool.query(
        'SELECT id, original_filename, status, page_count, created_at FROM documents WHERE workspace_id = $1 ORDER BY created_at DESC',
        [w.id]
      );
      console.log('Documents:', JSON.stringify(docs.rows, null, 2));

      const settings = await pool.query(
        'SELECT * FROM knowledge_automation_settings WHERE workspace_id = $1',
        [w.id]
      );
      console.log('Automation Settings:', JSON.stringify(settings.rows, null, 2));

      const knowledge = await pool.query(
        'SELECT id, knowledge_key, value, status FROM document_knowledge WHERE workspace_id = $1 LIMIT 10',
        [w.id]
      );
      console.log('Knowledge sample count:', knowledge.rows.length);
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
