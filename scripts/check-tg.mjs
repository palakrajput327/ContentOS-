import { pool } from '../dist-api/db.js';

async function main() {
  const row = (await pool.query(
    "SELECT * FROM social_accounts WHERE lower(platform) = 'telegram'"
  )).rows[0];

  console.log('Telegram account in DB:', {
    id: row?.id,
    name: row?.name,
    chatId: row?.provider_id,
    tokenPrefix: row?.access_token ? row.access_token.slice(0, 15) + '...' : null,
    state: row?.state
  });

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
