import { pool } from '../server/db.ts';

async function main() {
  const r = await pool.query(`
    SELECT dvc.id, dvc.concept_title, dvc.caption, dvc.source_page, d.original_filename, w.name as ws_name
    FROM document_visual_concepts dvc
    JOIN workspaces w ON w.id = dvc.workspace_id
    JOIN documents d ON d.id = dvc.document_id
    ORDER BY dvc.updated_at DESC
    LIMIT 10
  `);
  console.log(JSON.stringify(r.rows, null, 2));
  process.exit(0);
}
main();
