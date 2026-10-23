import { createHash } from "node:crypto";
import { z } from "zod";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { getStorageProvider } from "../storage/storage.factory.js";
import { readSourcePDF } from "../storage/storage-budget.js";
import { extractSourceImages } from "./extraction/source-images.js";
export async function sourceReference(db, workspaceId, documentId, sourceId) {
    z.object({
        workspaceId: z.string().uuid(),
        documentId: z.string().uuid(),
        sourceId: z.string().uuid(),
    }).parse({ workspaceId, documentId, sourceId });
    const result = await db.query(`SELECT s.*,m.checksum,m.metadata,m.status AS asset_status,d.original_filename,d.status AS document_status,p.bucket,p.object_key
 FROM document_source_media s JOIN documents d ON d.id=s.document_id AND d.workspace_id=s.workspace_id
 JOIN media_assets m ON m.id=s.media_asset_id AND m.workspace_id=s.workspace_id
 JOIN media_assets p ON p.id=d.media_asset_id AND p.workspace_id=d.workspace_id
 WHERE s.id=$1 AND s.document_id=$2 AND s.workspace_id=$3 AND m.deleted_at IS NULL AND m.storage_purged_at IS NULL AND m.status='COMPLETED' AND p.deleted_at IS NULL AND p.storage_purged_at IS NULL AND p.status='COMPLETED'`, [sourceId, documentId, workspaceId]);
    if (!result.rowCount)
        throw new NotFoundException("Source image not found in this workspace.");
    return result.rows[0];
}
export async function sourceOriginalBuffer(source) {
    const { provider } = getStorageProvider();
    const pdf = await readSourcePDF(provider, source.bucket, source.object_key);
    let original;
    await extractSourceImages(pdf, async (image) => {
        original = image.data;
    }, {
        pageNumber: source.page_number,
        imageIndex: source.image_index,
        kind: source.kind,
        includeFiltered: true,
    });
    if (!original ||
        createHash("sha256").update(original).digest("hex") !== source.checksum)
        throw new BadRequestException("The source PDF/image changed. Re-extract images before using it.");
    return original;
}
