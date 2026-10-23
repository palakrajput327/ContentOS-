import { pool } from '../dist-api/db.js';

async function main() {
  const failed = (await pool.query(`
    SELECT sp.id, sp.execute_at, sp.error_code, sp.publish_warning, sa.platform, sp.created_at
    FROM scheduled_posts sp
    JOIN social_accounts sa ON sa.id = sp.account_id
    WHERE sp.state = 'FAILED'
    ORDER BY sp.execute_at DESC
    LIMIT 10
  `)).rows;
  console.log('--- Failed Posts ---');
  console.log(JSON.stringify(failed, null, 2));

  const outbox = (await pool.query(`
    SELECT id, recipient, subject, status, created_at, sent_at, error, body_html
    FROM email_outbox
    ORDER BY created_at DESC
    LIMIT 6
  `)).rows;
  console.log('--- Recent Email Outbox ---');
  for (const o of outbox) {
    console.log({
      id: o.id,
      recipient: o.recipient,
      subject: o.subject,
      status: o.status,
      created_at: o.created_at,
      error: o.error,
      bodyExcerpt: o.body_html?.slice(0, 300)
    });
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
