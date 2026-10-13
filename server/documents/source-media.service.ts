import { createHash, randomUUID } from "node:crypto";
import { pool, transaction } from "../db.js";
import { getStorageProvider } from "../storage/storage.factory.js";
import { extractSourceImages } from "./extraction/source-images.js";
import {
  sourceThumbnail,
  THUMBNAIL_PROFILE,
} from "./extraction/source-thumbnail.js";
import { assertStorageCapacity } from "../storage/storage-budget.js";

export async function persistDocumentImages(
  documentId: string,
  workspaceId: string,
  buffer: Buffer,
) {
  const locked = await pool.query(
    "UPDATE documents SET media_extraction_status='PROCESSING',media_extraction_message=NULL,media_extraction_started_at=now() WHERE id=$1 AND workspace_id=$2 AND (media_extraction_status<>'PROCESSING' OR media_extraction_started_at IS NULL OR media_extraction_started_at < now()-interval '30 minutes') RETURNING id",
    [documentId, workspaceId],
  );
  if (!locked.rowCount) return;
  try {
    const { provider, bucket } = getStorageProvider();
    const summary = {
      scanned: 0,
      filtered: 0,
      stored: 0,
      reused: 0,
      thumbnailBytes: 0,
      profile: THUMBNAIL_PROFILE,
    };
    const uniquePreviews=new Set<string>();
    await extractSourceImages(buffer, async (image) => {
      summary.scanned++;
      const checksum = createHash("sha256").update(image.data).digest("hex");
      const thumbnail = await sourceThumbnail(image);
      if (!thumbnail) {
        summary.filtered++;
        return;
      }
      if (
        (!uniquePreviews.has(checksum) && uniquePreviews.size >= 100) ||
        (!uniquePreviews.has(checksum) && summary.thumbnailBytes + thumbnail.data.length > 8 * 1024 * 1024)
      )
        throw new Error(
          "Useful-image preview limit reached (100 images / 8 MiB per document). Earlier previews were retained; all originals remain in the PDF.",
        );
      // Serialize identical image writes across documents/workers and verify the document still exists.
      await transaction(async (db) => {
        // Workspace budget and hash locks use a consistent acquisition order.
        await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
          workspaceId,
        ]);
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `${workspaceId}:${checksum}`,
        ]);
        const doc = await db.query(
          "SELECT created_by FROM documents WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
          [documentId, workspaceId],
        );
        if (!doc.rowCount) throw new Error("Source document was removed.");
        let existing = await db.query(
          "SELECT id FROM media_assets WHERE workspace_id=$1 AND checksum=$2 AND deleted_at IS NULL AND metadata->>'origin'='PDF_SOURCE'",
          [workspaceId, checksum],
        );
        let assetId = existing.rows[0]?.id;
        if (assetId) summary.reused++;
        if (!assetId) {
          await assertStorageCapacity(db, workspaceId, thumbnail.data.length);
          assetId = randomUUID();
          const objectKey = `workspaces/${workspaceId}/pdf-source/${THUMBNAIL_PROFILE}/${checksum}.webp`;
          await db.query(
            `INSERT INTO media_assets(id,workspace_id,type,storage_provider,bucket,object_key,mime_type,size_bytes,checksum,original_filename,status,metadata,created_by)
            VALUES($1,$2,'THUMBNAIL',$3,$4,$5,'image/webp',$6,$7,$8,'COMPLETED',$9,$10)`,
            [
              assetId,
              workspaceId,
              provider.constructor.name.includes("Local") ? "local" : "s3",
              bucket,
              objectKey,
              thumbnail.data.length,
              checksum,
              `PDF source preview ${checksum.slice(0, 12)}.webp`,
              JSON.stringify({
                origin: "PDF_SOURCE",
                width: image.width,
                height: image.height,
                thumbnailWidth: thumbnail.width,
                thumbnailHeight: thumbnail.height,
                storageProfile: THUMBNAIL_PROFILE,
                originalStored: false,
                reuseEligibility: "UNREVIEWED",
              }),
              doc.rows[0].created_by,
            ],
          );
          // Reserve metadata/budget before writing bytes. A deterministic key makes retries overwrite any transaction-orphaned preview.
          await provider.upload({
            bucket,
            objectKey,
            body: thumbnail.data,
            mimeType: "image/webp",
          });
          summary.stored++;
        }
        await db.query(
          `INSERT INTO document_source_media(id,workspace_id,document_id,media_asset_id,page_number,image_index,kind)
          VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(document_id,page_number,image_index,kind) DO UPDATE SET media_asset_id=EXCLUDED.media_asset_id`,
          [
            randomUUID(),
            workspaceId,
            documentId,
            assetId,
            image.pageNumber,
            image.imageIndex,
            image.kind,
          ],
        );
        if(!uniquePreviews.has(checksum)){uniquePreviews.add(checksum);summary.thumbnailBytes += thumbnail.data.length;}
      });
    });
    await transaction(async (db) => {
      // Keep existing provenance and legacy originals. Filtering must not erase previously reviewed source references.
      await db.query(
        "UPDATE documents SET media_extraction_status='READY',media_extraction_summary=$3 WHERE id=$1 AND workspace_id=$2",
        [documentId, workspaceId, JSON.stringify(summary)],
      );
    });
  } catch (error) {
    await pool.query(
      "UPDATE documents SET media_extraction_status='FAILED',media_extraction_message=$3 WHERE id=$1 AND workspace_id=$2",
      [
        documentId,
        workspaceId,
        error instanceof Error
          ? error.message.slice(0, 500)
          : "Image extraction failed.",
      ],
    );
    // Media failure is independent from text/knowledge extraction. Partial assets remain inspectable.
    console.warn(
      "[PDF source media]",
      error instanceof Error ? error.message : error,
    );
  }
}
