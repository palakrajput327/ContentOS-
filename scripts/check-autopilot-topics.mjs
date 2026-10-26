import { pool } from '../dist-api/db.js';
import { knowledgePool } from '../dist-api/knowledge/automation.service.js';

async function main() {
  const wid = '4386cbf8-47bf-41fe-a925-0549bced08f2';
  const topics = await knowledgePool(pool, wid);
  console.log(`Knowledge Pool for workspace ${wid}:`, topics.length, 'topics');
  for (const t of topics) {
    console.log({
      key: t.key,
      value: t.value,
      eligible: t.eligible,
      hash: t.hash,
    });
  }

  const plans = (await pool.query('SELECT id, topic_hash, state, content_id, created_at FROM knowledge_content_plans WHERE workspace_id=$1', [wid])).rows;
  console.log('Existing plans in DB:', plans);

  process.exit(0);
}
main();
