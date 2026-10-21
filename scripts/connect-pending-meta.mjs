import { pool, transaction } from '../dist-api/db.js';
import { decryptToken, encryptToken } from '../dist-api/security.js';
import { metaPages } from '../dist-api/meta.api.js';
import { randomUUID } from 'crypto';

async function main() {
  const row = (await pool.query("SELECT * FROM meta_oauth_pending ORDER BY expires_at DESC LIMIT 1")).rows[0];
  if (!row) {
    console.log('No pending row found');
    process.exit(0);
  }
  console.log('Pending row ID:', row.id, 'workspace_id:', row.workspace_id);
  const token = decryptToken(row.ciphertext, row.workspace_id);
  const pages = await metaPages(token);
  console.log('Pages found:', pages.length);
  const page = pages[0];
  console.log('Page:', page.name, 'id:', page.id);
  const ig = page.instagram_business_account;
  console.log('Instagram:', ig?.username, 'id:', ig?.id);

  await transaction(async (db) => {
    for (const account of [
      { platform: 'facebook', id: page.id, name: page.name },
      {
        platform: 'instagram',
        id: ig.id,
        name: ig.username ? '@' + ig.username : 'Instagram Business',
      },
    ]) {
      const saved = await db.query(
        "INSERT INTO social_accounts(id,workspace_id,platform,provider_id,name,state,last_sync) VALUES($1,$2,$3,$4,$5,'CONNECTED',NOW()) ON CONFLICT(workspace_id,platform) DO UPDATE SET provider_id=EXCLUDED.provider_id,name=EXCLUDED.name,state='CONNECTED',last_sync=NOW() RETURNING id",
        [
          randomUUID(),
          row.workspace_id,
          account.platform,
          account.id,
          account.name,
        ],
      );
      await db.query(
        "INSERT INTO social_account_tokens(account_id,ciphertext,expires_at) VALUES($1,$2,NULL) ON CONFLICT(account_id) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,expires_at=NULL",
        [saved.rows[0].id, encryptToken(page.access_token, row.workspace_id)],
      );
      console.log('Successfully connected account:', account.platform, account.name, 'id:', saved.rows[0].id);
    }
  });

  console.log('SUCCESS! Both Facebook and Instagram are now CONNECTED in the database.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
