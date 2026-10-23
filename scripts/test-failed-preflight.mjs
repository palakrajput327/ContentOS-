import { pool } from '../dist-api/db.js';
import { createPublishPlan } from '../dist-api/publish-planner.js';

async function main() {
  const content = (await pool.query('SELECT * FROM content WHERE id = $1', ['83cf3e77-6787-470c-b5f2-370c8b6754f8'])).rows[0];
  console.log('--- Content ---');
  console.log(JSON.stringify(content, null, 2));

  try {
    const plan = await createPublishPlan(pool, content, 'LinkedIn', { isPublishing: true });
    console.log('Plan:', plan);
  } catch (err) {
    console.error('createPublishPlan threw error:', err);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
