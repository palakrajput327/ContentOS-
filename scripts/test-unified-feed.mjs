import { pool } from '../dist-api/db.js';

async function main() {
  const wid = '4386cbf8-47bf-41fe-a925-0549bced08f2';
  const res = await pool.query(`
    SELECT * FROM (
      SELECT DISTINCT ON (c.id)
        p.id AS id,
        p.id AS plan_id,
        c.id AS content_id,
        c.workspace_id,
        c.title,
        c.body,
        c.variants,
        c.platforms,
        c.status AS content_status,
        c.scheduled_at,
        c.created_at,
        p.source_snapshot,
        p.proposed_at,
        s.id AS scheduled_post_id,
        s.state AS publish_state,
        s.execute_at,
        s.provider_post_id,
        s.error_code,
        sa.platform AS social_platform,
        sa.name AS social_account_name,
        d.original_filename AS document_name
      FROM knowledge_content_plans p
      JOIN content c ON c.id=p.content_id AND c.workspace_id=p.workspace_id
      LEFT JOIN scheduled_posts s ON s.content_id=c.id AND s.workspace_id=c.workspace_id
      LEFT JOIN social_accounts sa ON sa.id=s.account_id
      LEFT JOIN document_knowledge dk ON dk.id=p.knowledge_id
      LEFT JOIN documents d ON d.id=dk.document_id
      WHERE p.workspace_id=$1
        AND (s.state IN ('ENQUEUED', 'SCHEDULED') OR c.status = 'SCHEDULED')
        AND (s.state IS NULL OR s.state <> 'CANCELLED')
      ORDER BY c.id, (CASE WHEN s.state = 'ENQUEUED' THEN 1 WHEN s.state = 'SCHEDULED' THEN 2 ELSE 3 END)
    ) sub
    ORDER BY execute_at ASC, created_at DESC LIMIT 20
  `, [wid]);

  console.log(`Found ${res.rowCount} pipeline items:`);
  for (const row of res.rows.slice(0, 5)) {
    const tgMedia = row.variants?.Telegram?.mediaUrl || row.variants?.LinkedIn?.mediaUrl || row.variants?.Instagram?.mediaUrl;
    console.log({
      id: row.id,
      title: row.title,
      publish_state: row.publish_state,
      provider_post_id: row.provider_post_id,
      execute_at: row.execute_at,
      mediaUrl: tgMedia,
      created_at: row.created_at,
    });
  }

  process.exit(0);
}
main();
