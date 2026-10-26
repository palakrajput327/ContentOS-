import { pool } from '../dist-api/db.js';

async function main() {
  const docId = 'b2fba451-4fe2-4ce4-a6dd-ce471c7a8b0b';
  const wid = '4386cbf8-47bf-41fe-a925-0549bced08f2';

  const k = await pool.query(
    'SELECT id, knowledge_key, value, status, page_start, source_excerpt FROM document_knowledge WHERE document_id = $1 AND workspace_id = $2',
    [docId, wid]
  );
  console.log('Knowledge items for Redhash.pdf:', k.rows.length);
  if (k.rows.length) {
    console.log('Sample knowledge item:', JSON.stringify(k.rows[0], null, 2));
  }

  const m = await pool.query(
    `SELECT dsm.id, dsm.page_number, dsm.image_index, dsm.kind, ma.id as asset_id, ma.bucket, ma.object_key 
     FROM document_source_media dsm 
     JOIN media_assets ma ON ma.id = dsm.media_asset_id 
     WHERE dsm.document_id = $1 AND dsm.workspace_id = $2`,
    [docId, wid]
  );
  console.log('Extracted images from Redhash.pdf:', m.rows.length);
  if (m.rows.length) {
    console.log('Sample extracted image:', JSON.stringify(m.rows[0], null, 2));
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
