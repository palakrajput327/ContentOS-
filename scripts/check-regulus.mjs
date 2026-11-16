import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
async function check() {
  const concepts = await pool.query(`
    SELECT id, concept_title, status, scheduled_at, dispatched_at, target_channels, post_result, content_id
    FROM document_visual_concepts
    WHERE document_id='cca17059-1cd4-4ad1-a276-84b57b4f3db5'
    ORDER BY scheduled_at ASC NULLS LAST, source_page ASC
  `);
  console.log("Regulus concepts:", JSON.stringify(concepts.rows, null, 2));

  await pool.end();
}
check().catch(console.error);
