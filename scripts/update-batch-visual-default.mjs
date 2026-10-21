import fs from 'node:fs';

let code = fs.readFileSync('server/batch/batch-processing.ts', 'utf8').replace(/\r\n/g, '\n');

if (!code.includes("import { getStorageProvider }")) {
  code = `import { getStorageProvider } from '../storage/storage.factory.js';\n` + code;
}

const target = `      const result = await generateCaptions(topic, tone, goal, platforms,brand);
      const variants=Object.fromEntries(Object.entries(result.variants).map(([platform,caption])=>[platform,{caption,metadata:{sourceEvidence:payload.sourceEvidence || []}}]));`;

const replacement = `      const result = await generateCaptions(topic, tone, goal, platforms,brand);

      // By default: Always use images extracted from PDF if available in source evidence
      let autoVisualUrl: string | undefined;
      let autoVisualAssetId: string | undefined;
      const evidence = payload.sourceEvidence || [];
      const preferredAssetId = evidence.find((e: any) => e.sourceMediaAssetId)?.sourceMediaAssetId;
      const docId = evidence[0]?.documentId;
      const pageNum = evidence[0]?.pageStart;

      if (preferredAssetId) {
        const imgRow = (await db.query('SELECT bucket, object_key, id FROM media_assets WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL', [preferredAssetId, workspaceId])).rows[0];
        if (imgRow) {
          const { provider } = getStorageProvider();
          autoVisualUrl = await provider.getSignedDownloadUrl(imgRow.bucket, imgRow.object_key, 7 * 86400);
          autoVisualAssetId = imgRow.id;
        }
      }
      if (!autoVisualAssetId && docId) {
        let imgRow;
        if (pageNum) {
          imgRow = (await db.query('SELECT m.bucket, m.object_key, m.id FROM document_source_media dsm JOIN media_assets m ON m.id = dsm.media_asset_id WHERE dsm.document_id = $1 AND dsm.workspace_id = $2 AND dsm.page_number = $3 AND m.deleted_at IS NULL LIMIT 1', [docId, workspaceId, pageNum])).rows[0];
        }
        if (!imgRow) {
          imgRow = (await db.query('SELECT m.bucket, m.object_key, m.id FROM document_source_media dsm JOIN media_assets m ON m.id = dsm.media_asset_id WHERE dsm.document_id = $1 AND dsm.workspace_id = $2 AND m.deleted_at IS NULL ORDER BY dsm.page_number ASC LIMIT 1', [docId, workspaceId])).rows[0];
        }
        if (imgRow) {
          const { provider } = getStorageProvider();
          autoVisualUrl = await provider.getSignedDownloadUrl(imgRow.bucket, imgRow.object_key, 7 * 86400);
          autoVisualAssetId = imgRow.id;
        }
      }

      const variants = Object.fromEntries(
        Object.entries(result.variants).map(([platform, caption]) => [
          platform,
          {
            caption,
            metadata: { sourceEvidence: payload.sourceEvidence || [] },
            ...(autoVisualUrl && ["Instagram", "LinkedIn", "Facebook", "Telegram"].includes(platform)
              ? { mediaUrl: autoVisualUrl, mediaType: "image", mediaAssetId: autoVisualAssetId }
              : {}),
          },
        ])
      );`;

if (!code.includes(target)) {
  console.error('Target not found in batch-processing.ts!');
  process.exit(1);
}

const updated = code.replace(target, replacement);
fs.writeFileSync('server/batch/batch-processing.ts', updated, 'utf8');
console.log('Successfully updated batch-processing.ts!');
