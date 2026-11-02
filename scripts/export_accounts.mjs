import { Pool } from 'pg';
import fs from 'node:fs';

const pool = new Pool({
  connectionString: 'postgresql://neondb_owner:npg_SMsYekaf6K4F@ep-odd-wind-b309rvnv-pooler.c-4.ap-southeast-1.aws.neon.tech/smm-panel?sslmode=require',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const wid = '4386cbf8-47bf-41fe-a925-0549bced08f2';
  const accs = await pool.query('SELECT * FROM social_accounts WHERE workspace_id = $1', [wid]);
  const aids = accs.rows.map(a => a.id);
  const tokens = await pool.query('SELECT * FROM social_account_tokens WHERE account_id = ANY($1)', [aids]);

  let sql = '-- ====================================================================\n';
  sql += '-- Restore Connected Social Accounts & Tokens for Palak Gemini Workspace\n';
  sql += '-- ====================================================================\n\n';

  for (const a of accs.rows) {
    const pId = a.provider_id.replace(/'/g, "''");
    const name = a.name.replace(/'/g, "''");
    const sync = a.last_sync ? `'${new Date(a.last_sync).toISOString()}'` : 'NULL';
    sql += `INSERT INTO social_accounts (id, workspace_id, platform, provider_id, name, state, last_sync)\n`;
    sql += `VALUES ('${a.id}', '${a.workspace_id}', '${a.platform}', '${pId}', '${name}', '${a.state}', ${sync})\n`;
    sql += `ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, name = EXCLUDED.name;\n\n`;
  }

  sql += '-- ====================================================================\n';
  sql += '-- Restore Encrypted Access Tokens\n';
  sql += '-- ====================================================================\n\n';

  for (const t of tokens.rows) {
    const exp = t.expires_at ? `'${new Date(t.expires_at).toISOString()}'` : 'NULL';
    const ref = t.refresh_ciphertext ? `'${t.refresh_ciphertext}'` : 'NULL';
    sql += `INSERT INTO social_account_tokens (account_id, ciphertext, expires_at, refresh_ciphertext)\n`;
    sql += `VALUES ('${t.account_id}', '${t.ciphertext}', ${exp}, ${ref})\n`;
    sql += `ON CONFLICT (account_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, expires_at = EXCLUDED.expires_at;\n\n`;
  }

  fs.writeFileSync('insert_connected_accounts.sql', sql, 'utf8');
  console.log('Successfully wrote insert_connected_accounts.sql! Length:', sql.length);
  await pool.end();
}

run().catch(console.error);

