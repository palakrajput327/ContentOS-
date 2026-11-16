import { pool } from '../server/db.ts';
import { VisualConceptsService } from '../dist-api/documents/visual-concepts.service.js';

async function main() {
  const conceptId = '6dff7e95-3314-4e7d-aefb-96bc2681f9b2';
  const c = (await pool.query('SELECT * FROM document_visual_concepts WHERE id = $1', [conceptId])).rows[0];
  console.log('Concept before dispatch:', {
    id: c.id,
    title: c.concept_title,
    status: c.status,
    channels: c.target_channels,
    assetId: c.asset_id,
    imageUrl: c.image_url,
  });

  const member = (await pool.query("SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND role = 'Owner' LIMIT 1", [c.workspace_id])).rows[0];
  const userId = member?.user_id;

  const vcService = new VisualConceptsService();
  console.log('Dispatching concept now...');
  const res = await vcService.dispatchConcept({
    documentId: c.document_id,
    conceptId: c.id,
    workspaceId: c.workspace_id,
    userId: userId,
    channels: c.target_channels || ['linkedin', 'instagram', 'facebook', 'telegram'],
  });

  console.log('Dispatch result:', JSON.stringify(res, null, 2));

  const after = (await pool.query('SELECT id, status, dispatched_at, post_result FROM document_visual_concepts WHERE id = $1', [conceptId])).rows[0];
  console.log('Concept after dispatch:', JSON.stringify(after, null, 2));

  process.exit(0);
}

main().catch(err => {
  console.error('Dispatch test error:', err);
  process.exit(1);
});
