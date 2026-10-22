import { BadRequestException } from "@nestjs/common";
import type { DB } from "../db.js";
export async function assertSourceMediaPublication(
  db: DB,
  workspaceId: string,
  assetId: string,
  content: { status?: string; approved_by?: string | null },
) {
  const asset = (
    await db.query(
      "SELECT metadata FROM media_assets WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL AND status='COMPLETED'",
      [assetId, workspaceId],
    )
  ).rows[0];
  // Allow PDF_SOURCE slides when extracted for posting
  if (asset?.metadata?.origin === "PDF_SOURCE") {
    return;
  }
  if (asset?.metadata?.origin !== "SOURCE_POSTER") return;
  const isAutomation = (content as any)?.variants?.metadata?.content_source === "KNOWLEDGE_AUTOMATION";
  if (
    !isAutomation &&
    !content.approved_by &&
    !["APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED"].includes(
      content.status || "",
    )
  )
    throw new BadRequestException(
      "Source-image posters require approval of the final content before scheduling or publishing.",
    );
  const lineage = asset.metadata;
  const source = (
    await db.query(
      `SELECT m.metadata,m.checksum FROM document_source_media s
 JOIN documents d ON d.id=s.document_id AND d.workspace_id=s.workspace_id
 JOIN media_assets m ON m.id=s.media_asset_id AND m.workspace_id=s.workspace_id
 JOIN media_assets p ON p.id=d.media_asset_id AND p.workspace_id=d.workspace_id
 WHERE s.id=$1 AND s.workspace_id=$2 AND s.media_asset_id=$3 AND s.document_id=$4 AND m.deleted_at IS NULL AND m.storage_purged_at IS NULL AND p.deleted_at IS NULL AND p.storage_purged_at IS NULL`,
      [
        lineage.sourceReferenceId,
        workspaceId,
        lineage.sourceMediaAssetId,
        lineage.documentId,
      ],
    )
  ).rows[0];
  if (
    !source ||
    source.metadata.reuseEligibility !== "APPROVED" ||
    source.metadata.reuseVersion !== lineage.reuseVersion ||
    source.checksum !== lineage.sourceChecksum
  )
    throw new BadRequestException(
      "Source image reuse approval or evidence changed. Review the source and regenerate the poster.",
    );
}
