import { pool } from '../dist-api/db.js';
import { getStorageProvider } from '../dist-api/storage/storage.factory.js';

async function main() {
  const { provider } = getStorageProvider();

  // Find all plans for Redhash.pdf
  const plans = (await pool.query(`
    SELECT p.id AS plan_id, p.content_id, p.workspace_id, dk.knowledge_key, dk.page_start, dk.metadata
    FROM knowledge_content_plans p
    LEFT JOIN document_knowledge dk ON dk.id = p.knowledge_id
    WHERE p.workspace_id = '4386cbf8-47bf-41fe-a925-0549bced08f2'
  `)).rows;

  console.log(`Found ${plans.length} plans to check.`);

  for (const plan of plans) {
    if (!plan.content_id) continue;

    const sourceAssetId = plan.metadata?.sourceMediaAssetId;
    let assetRow;

    if (sourceAssetId) {
      assetRow = (await pool.query(
        "SELECT id, bucket, object_key FROM media_assets WHERE id = $1 AND deleted_at IS NULL",
        [sourceAssetId]
      )).rows[0];
    }

    if (!assetRow && plan.page_start) {
      assetRow = (await pool.query(`
        SELECT m.id, m.bucket, m.object_key
        FROM document_source_media dsm
        JOIN media_assets m ON m.id = dsm.media_asset_id
        WHERE dsm.document_id = 'b2fba451-4fe2-4ce4-a6dd-ce471c7a8b0b'
          AND dsm.page_number = $1
          AND m.deleted_at IS NULL
        LIMIT 1
      `, [plan.page_start])).rows[0];
    }

    if (!assetRow) {
      console.log(`No asset found for plan ${plan.plan_id} (Page ${plan.page_start})`);
      continue;
    }

    const signedUrl = await provider.getSignedDownloadUrl(assetRow.bucket, assetRow.object_key, 7 * 86400);

    const post = (await pool.query("SELECT id, variants FROM content WHERE id = $1", [plan.content_id])).rows[0];
    if (!post) continue;

    const variants = post.variants || {};
    for (const p of ["Facebook", "Instagram", "LinkedIn", "Telegram"]) {
      if (variants[p]) {
        variants[p].mediaType = "image";
        variants[p].mediaAssetId = assetRow.id;
        variants[p].mediaUrl = signedUrl;
      }
    }

    await pool.query(
      "UPDATE content SET variants = $1, image_asset_id = $2 WHERE id = $3",
      [JSON.stringify(variants), assetRow.id, plan.content_id]
    );

    console.log(`✓ Updated Post ${plan.content_id} (Slide/Page ${plan.page_start}): set image poster ${assetRow.id}`);
  }

  console.log("All existing planned posts updated with exact extracted PDF images!");
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
