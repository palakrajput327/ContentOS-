import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
async function check() {
  const posts = await pool.query(`
    SELECT sp.*
    FROM scheduled_posts sp
    ORDER BY sp.execute_at DESC
    LIMIT 10
  `);
  console.log("Recent scheduled posts:", JSON.stringify(posts.rows, null, 2));

  const concepts = await pool.query(`
    SELECT id, document_id, headline, dispatch_status, dispatch_error, target_channels, scheduled_time, content_id
    FROM document_visual_concepts
    WHERE dispatch_status IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT 10
  `);
  console.log("Recent concepts:", JSON.stringify(concepts.rows, null, 2));

  const sa = await pool.query(`SELECT id, platform, workspace_id, state FROM social_accounts WHERE workspace_id='4386cbf8-47bf-41fe-a925-0549bced08f2'`);
  console.log("Social accounts:", JSON.stringify(sa.rows, null, 2));

  await pool.end();
}
check().catch(console.error);
