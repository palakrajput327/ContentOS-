import { pool } from '../dist-api/db.js';

async function main() {
  const docId = 'b2fba451-4fe2-4ce4-a6dd-ce471c7a8b0b';
  const media = await pool.query(
    'SELECT dsm.id, dsm.page_number, dsm.kind, m.bucket, m.object_key, m.id as asset_id FROM document_source_media dsm JOIN media_assets m ON m.id = dsm.media_asset_id WHERE dsm.document_id = $1',
    [docId]
  );
  console.log('Media count:', media.rowCount);
  const know = await pool.query(
    'SELECT id, knowledge_key, knowledge_type, value, page_start, source_excerpt FROM document_knowledge WHERE document_id = $1',
    [docId]
  );
  console.log('Knowledge count:', know.rowCount);
  for (const k of know.rows) {
    console.log({
      key: k.knowledge_key,
      page: k.page_start,
      val: k.value,
    });
  }
  process.exit(0);
}
main();
