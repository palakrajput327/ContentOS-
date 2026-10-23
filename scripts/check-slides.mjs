import { pool } from '../dist-api/db.js';

async function main() {
  const wid = '4386cbf8-47bf-41fe-a925-0549bced08f2';
  const plans = (await pool.query(`
    SELECT id, topic_hash, source_snapshot->'key' as slide_key, proposed_at, state
    FROM knowledge_content_plans
    WHERE workspace_id = $1
    ORDER BY created_at ASC
  `, [wid])).rows;
  console.log('Plans:', plans);

  const media = (await pool.query(`
    SELECT id, document_id, page_start, page_end, metadata
    FROM document_source_media
    WHERE workspace_id = $1
    ORDER BY page_start ASC
  `, [wid])).rows;
  console.log('Source Media Slides count:', media.length);
  for (const m of media) {
    console.log(`Slide ${m.page_start}: id=${m.id}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
