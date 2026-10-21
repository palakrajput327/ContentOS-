import { pool } from '../dist-api/db.js';
import { decryptToken } from '../dist-api/security.js';

async function main() {
  const acc = (await pool.query("SELECT a.id, a.provider_id, a.workspace_id, t.ciphertext FROM social_accounts a JOIN social_account_tokens t ON a.id = t.account_id WHERE a.platform = 'facebook'")).rows[0];
  const token = decryptToken(acc.ciphertext, acc.workspace_id);
  console.log('Page ID:', acc.provider_id);

  const imageUrl = 'https://api.hidustansocialnetwork.in/api/v1/storage/local/download?bucket=contentos-media&key=workspaces%2F4386cbf8-47bf-41fe-a925-0549bced08f2%2Fimage%2Fd246789a-8408-4c31-ba90-a8a799e4f226%2Ffile.png&expires=1792572666615&sig=8a97b35ef6f4498acda77320ab920f002a3af2ef770fc53de46eabd560e6afaa';
  
  // Test 1: with URL parameter
  console.log('--- Testing with url parameter ---');
  const urlRes = await fetch(`https://graph.facebook.com/v25.0/${acc.provider_id}/photos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      url: imageUrl,
      caption: 'Test with url param',
      published: 'false'
    })
  });
  console.log('URL param response:', urlRes.status, await urlRes.json());

  // Test 2: with FormData and source blob
  console.log('--- Testing with FormData (source blob) ---');
  const imgRes = await fetch(imageUrl);
  const blob = await imgRes.blob();
  console.log('Fetched image size:', blob.size, 'type:', blob.type);

  const formData = new FormData();
  formData.append('source', blob, 'image.png');
  formData.append('caption', 'Test with FormData source');
  formData.append('published', 'false');

  const formRes = await fetch(`https://graph.facebook.com/v25.0/${acc.provider_id}/photos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });
  console.log('FormData response:', formRes.status, await formRes.json());

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
