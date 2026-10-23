import { pool } from '../dist-api/db.js';
import { executePublishRecord } from '../dist-api/publishing.js';

async function main() {
  const id = '8f1a24f2-460f-47c2-b95f-4d5b280afd3c';
  console.log(`Executing publish for ${id}...`);
  try {
    const res = await executePublishRecord(id, { attemptsMade: 0, maxAttempts: 3 });
    console.log('Result:', res);
  } catch (err) {
    console.error('Error in executePublishRecord:', err);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
