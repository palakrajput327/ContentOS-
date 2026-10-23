import { pool } from '../dist-api/db.js';

async function main() {
  const emails = (await pool.query(`
    SELECT id, recipient, subject, state, created_at, sent_at
    FROM email_outbox
    ORDER BY created_at DESC
    LIMIT 10
  `)).rows;
  console.log('Recent Emails in Outbox:');
  console.log(JSON.stringify(emails, null, 2));

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
