import { pool } from '../server/db.ts';

async function main() {
  const r = await pool.query(`
    SELECT id, concept_title, status, scheduled_at, dispatched_at, target_channels, post_result, updated_at
    FROM document_visual_concepts
    WHERE id = '6dff7e95-3314-4e7d-aefb-96bc2681f9b2'
  `);
  console.log('Concept 6dff:', JSON.stringify(r.rows, null, 2));

  const sp = await pool.query(`
    SELECT sp.id, sp.content_id, sp.state, sp.error_code, sp.provider_post_id, sa.platform, sp.created_at
    FROM scheduled_posts sp
    JOIN social_accounts sa ON sa.id = sp.account_id
    WHERE sp.workspace_id = '4386cbf8-47bf-41fe-a925-0549bced08f2'
    ORDER BY sp.created_at DESC
    LIMIT 10
  `);
  console.log('Recent scheduled posts for Palak:', JSON.stringify(sp.rows, null, 2));

  process.exit(0);
}

main();

