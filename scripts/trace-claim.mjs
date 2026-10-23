import { pool } from '../dist-api/db.js';

async function main() {
  const id = '8f1a24f2-460f-47c2-b95f-4d5b280afd3c';
  const now = new Date();

  const raw = (await pool.query("SELECT content_id,workspace_id FROM scheduled_posts WHERE id=$1", [id])).rows[0];
  console.log('raw:', raw);

  const content = (await pool.query("SELECT * FROM content WHERE id=$1 AND workspace_id=$2", [raw.content_id, raw.workspace_id])).rows[0];
  console.log('content status:', content?.status, 'version:', content?.version);

  const job = (await pool.query("SELECT * FROM scheduled_posts WHERE id=$1", [id])).rows[0];
  console.log('job state:', job?.state, 'version:', job?.content_version, 'execute_at:', job?.execute_at);

  const sub = (await pool.query("SELECT status, current_period_end FROM workspace_subscriptions WHERE workspace_id = $1", [raw.workspace_id])).rows[0];
  console.log('sub:', sub);

  console.log('content.version !== job.content_version:', content.version !== job.content_version);
  console.log('valid content status:', ["SCHEDULED", "PUBLISHING", "FAILED", "UNCERTAIN"].includes(content.status));

  const account = (await pool.query(
    "SELECT a.*,t.ciphertext,t.expires_at FROM social_accounts a LEFT JOIN social_account_tokens t ON t.account_id=a.id WHERE a.id=$1 AND a.workspace_id=$2",
    [job.account_id, job.workspace_id]
  )).rows[0];
  console.log('account:', {
    id: account?.id,
    platform: account?.platform,
    state: account?.state,
    hasCiphertext: Boolean(account?.ciphertext),
    expires_at: account?.expires_at,
    isExpired: account?.expires_at ? new Date(account.expires_at).getTime() <= now.getTime() : false
  });

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
