import fs from 'node:fs';

let code = fs.readFileSync('server/knowledge/automation.service.ts', 'utf8').replace(/\r\n/g, '\n');

// 1. Pass posterStyle in reservation
code = code.replace(
  `autopilot: !!settings.autopilot_enabled,\n        };`,
  `autopilot: !!settings.autopilot_enabled,\n          posterStyle: settings.poster_style || 'DIRECT',\n        };`
);

// 2. Add composite poster rendering when posterStyle === 'BRANDED_CANVAS'
const targetPlacement = `          if (!autoVisualAssetId && reservation.autopilot) {
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

const replacementPlacement = `          if (!autoVisualAssetId && reservation.autopilot) {
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
          }

          // Composite poster creation: when user chooses BRANDED_CANVAS mode
          if (autoVisualAssetId && reservation.posterStyle === 'BRANDED_CANVAS') {
            try {
              const { renderSourcePoster } = await import("../documents/source-poster.js");
              const { uploadManagedMedia } = await import("../storage/managed-media.js");
              const { provider, bucket } = getStorageProvider();
              const assetRow = (await db.query("SELECT bucket, object_key FROM media_assets WHERE id = $1", [autoVisualAssetId])).rows[0];
              if (assetRow) {
                const stream = await provider.read(assetRow.bucket, assetRow.object_key);
                const chunks: Buffer[] = [];
                for await (const chunk of stream) chunks.push(Buffer.from(chunk));
                const originalBuffer = Buffer.concat(chunks);
                const rendered = await renderSourcePoster(
                  originalBuffer,
                  {
                    headline: result.title.slice(0, 100),
                    subtitle: (evidence[0]?.excerpt || result.title).slice(0, 180),
                    cta: reservation.brand?.cta || "",
                    format: "square",
                    primaryColor: reservation.brand?.primary_color || "#704bd6",
                  },
                  reservation.brand || {}
                );
                const compAssetId = randomUUID();
                const compKey = \`workspaces/\${workspaceId}/branded-posters/\${compAssetId}.jpg\`;
                const uploaded = await uploadManagedMedia(
                  {
                    assetId: compAssetId,
                    workspaceId,
                    userId: reservation.actorId,
                    bucket,
                    objectKey: compKey,
                    body: rendered.buffer,
                    mimeType: "image/jpeg",
                    filename: \`branded-poster-\${compAssetId.slice(0, 8)}.jpg\`,
                    type: "IMAGE",
                    provider,
                  },
                  db
                );
                autoVisualAssetId = uploaded.id;
                autoVisualUrl = await provider.getSignedDownloadUrl(bucket, compKey, 7 * 86400);
              }
            } catch (canvasErr) {
              console.warn("[ContentOS] Composite poster generation failed, using direct PDF visual:", (canvasErr as Error).message);
            }
          }`;

code = code.replace(targetPlacement, replacementPlacement);

fs.writeFileSync('server/knowledge/automation.service.ts', code, 'utf8');
console.log('Successfully updated automation.service.ts with composite poster support!');
