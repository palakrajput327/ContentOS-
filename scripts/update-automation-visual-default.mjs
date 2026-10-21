import fs from 'node:fs';

let code = fs.readFileSync('server/knowledge/automation.service.ts', 'utf8').replace(/\r\n/g, '\n');

const target = `          // Auto-pair extracted PDF image if available
          const docId = evidence[0]?.documentId || reservation.topic.sources[0]?.documentId;
          let autoVisualUrl: string | undefined = generatedVisual?.url;
          let autoVisualAssetId: string | undefined = generatedVisual?.assetId;
          if (!generatedVisual && docId) {
            const imgRow = (
              await db.query(
                \`SELECT m.bucket, m.object_key, m.id FROM document_source_media dsm
                 JOIN media_assets m ON m.id = dsm.media_asset_id
                 WHERE dsm.document_id = $1 AND dsm.workspace_id = $2 AND m.deleted_at IS NULL
                 ORDER BY dsm.page_number ASC LIMIT 1\`,
                [docId, workspaceId],
              )
            ).rows[0];
            if (imgRow) {
              const { provider } = getStorageProvider();
              autoVisualUrl = await provider.getSignedDownloadUrl(imgRow.bucket, imgRow.object_key, 7 * 86400);
              autoVisualAssetId = imgRow.id;
            }
          }`;

const replacement = `          // Auto-pair extracted PDF image by default
          let autoVisualUrl: string | undefined;
          let autoVisualAssetId: string | undefined;

          const preferredSourceAssetId =
            evidence.find((e: any) => e.sourceMediaAssetId)?.sourceMediaAssetId ||
            reservation.topic.sources?.find((s: any) => s.sourceMediaAssetId)?.sourceMediaAssetId;

          const docId = evidence[0]?.documentId || reservation.topic.sources[0]?.documentId;
          const pageNum = evidence[0]?.pageStart || reservation.topic.sources[0]?.pageStart;

          if (preferredSourceAssetId) {
            const imgRow = (
              await db.query(
                \`SELECT m.bucket, m.object_key, m.id FROM media_assets m
                 WHERE m.id = $1 AND m.workspace_id = $2 AND m.deleted_at IS NULL\`,
                [preferredSourceAssetId, workspaceId],
              )
            ).rows[0];
            if (imgRow) {
              const { provider } = getStorageProvider();
              autoVisualUrl = await provider.getSignedDownloadUrl(imgRow.bucket, imgRow.object_key, 7 * 86400);
              autoVisualAssetId = imgRow.id;
            }
          }

          if (!autoVisualAssetId && docId) {
            let imgRow;
            if (pageNum) {
              imgRow = (
                await db.query(
                  \`SELECT m.bucket, m.object_key, m.id FROM document_source_media dsm
                   JOIN media_assets m ON m.id = dsm.media_asset_id
                   WHERE dsm.document_id = $1 AND dsm.workspace_id = $2 AND dsm.page_number = $3 AND m.deleted_at IS NULL
                   LIMIT 1\`,
                  [docId, workspaceId, pageNum],
                )
              ).rows[0];
            }
            if (!imgRow) {
              imgRow = (
                await db.query(
                  \`SELECT m.bucket, m.object_key, m.id FROM document_source_media dsm
                   JOIN media_assets m ON m.id = dsm.media_asset_id
                   WHERE dsm.document_id = $1 AND dsm.workspace_id = $2 AND m.deleted_at IS NULL
                   ORDER BY dsm.page_number ASC LIMIT 1\`,
                  [docId, workspaceId],
                )
              ).rows[0];
            }
            if (imgRow) {
              const { provider } = getStorageProvider();
              autoVisualUrl = await provider.getSignedDownloadUrl(imgRow.bucket, imgRow.object_key, 7 * 86400);
              autoVisualAssetId = imgRow.id;
            }
          }

          if (!autoVisualAssetId && reservation.autopilot) {
            const gen = await this.generateVisual({
              workspaceId,
              actorId: reservation.actorId,
              topicHash: reservation.topic.hash,
              title: result.title,
              caption: result.variants[reservation.platforms[0]],
            });
            if (gen) {
              autoVisualUrl = gen.url;
              autoVisualAssetId = gen.assetId;
            }
          }`;

if (!code.includes(target)) {
  console.error('Target not found in code!');
  process.exit(1);
}

const updated = code.replace(target, replacement);
fs.writeFileSync('server/knowledge/automation.service.ts', updated, 'utf8');
console.log('Successfully updated automation.service.ts!');
