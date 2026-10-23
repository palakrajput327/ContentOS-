import { pool } from '../dist-api/db.js';
import { createPublishPlan } from '../dist-api/publish-planner.js';

async function main() {
  const content = (await pool.query('SELECT * FROM content WHERE id = $1', ['83cf3e77-6787-470c-b5f2-370c8b6754f8'])).rows[0];
  const instaPlan = await createPublishPlan(pool, content, 'Instagram', { isPublishing: true });
  console.log('Instagram Plan:', instaPlan);

  const fbPlan = await createPublishPlan(pool, content, 'Facebook', { isPublishing: true });
  console.log('Facebook Plan:', fbPlan);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
