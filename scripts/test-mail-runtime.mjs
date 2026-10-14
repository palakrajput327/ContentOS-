import assert from 'node:assert/strict';
import { test, mock } from 'node:test';

const writes = [], sent = [];
let pending = null, rejectDelivery = false, closes = 0;
mock.module('../dist-api/db.js', { namedExports: {
  pool: { query: async (sql, args) => { writes.push({ sql, args }); return { rows: [] }; } },
  transaction: async fn => fn({ query: async sql => {
    if (sql.startsWith('SELECT')) { const mail = pending; pending = null; return { rows: mail ? [mail] : [] }; }
    return { rows: [] };
  } }),
} });
mock.module('../dist-api/security.js', { namedExports: {
  encryptToken: value => value, decryptToken: value => value, hash: value => value,
} });
mock.module('nodemailer', { defaultExport: { createTransport: () => ({
  sendMail: async mail => { sent.push(mail); if (rejectDelivery) throw new Error('SMTP unavailable'); return { accepted: [mail.to] }; },
  close: () => { closes++; },
}) } });
const { deliverEmails } = await import('../dist-api/mail.js');
const fixture = { id: 'test-mail', recipient: 'recipient@example.test', subject: 'Test', encrypted_body: 'Test body', attempts: 1 };

test('email dispatcher sends and clears the encrypted outbox body', async () => {
  pending = { ...fixture };
  await deliverEmails();
  assert.equal(sent[0].text, 'Test body');
  assert.ok(writes.some(w => w.sql.includes("state='SENT'") && w.sql.includes('encrypted_body=NULL')));
  assert.equal(closes, 1);
});
test('email dispatcher retains retry backoff and terminal failure behavior', async () => {
  rejectDelivery = true;
  for (const attempts of [1, 4]) {
    pending = { ...fixture, attempts };
    const started = Date.now();
    await deliverEmails();
    const retry = writes.filter(w => w.sql.includes('available_at=$3')).at(-1);
    assert.equal(retry.args[1], attempts >= 4 ? 'FAILED' : 'PENDING');
    assert.ok(retry.args[2].getTime() >= started + 2 ** attempts * 10000);
  }
  assert.equal(closes, 3);
});
