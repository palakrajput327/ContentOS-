import type { DB } from "../db.js";
// Legacy text knowledge is unchanged; visual facts must still point to their original active source.
export async function validVisualKnowledgeRows(
  db: DB,
  workspaceId: string,
  rows: any[],
) {
  const visual = rows.filter((row) => row.metadata?.origin === "SOURCE_VISUAL");
  if (!visual.length) return rows;
  const refs = (
    await db.query(
      `SELECT s.id,s.document_id,s.media_asset_id,s.page_number,m.checksum FROM document_source_media s
 JOIN documents d ON d.id=s.document_id AND d.workspace_id=s.workspace_id
 JOIN media_assets m ON m.id=s.media_asset_id AND m.workspace_id=s.workspace_id
 JOIN media_assets p ON p.id=d.media_asset_id AND p.workspace_id=d.workspace_id
 WHERE s.workspace_id=$1 AND s.id=ANY($2::uuid[]) AND d.status='READY' AND m.deleted_at IS NULL AND m.storage_purged_at IS NULL AND p.deleted_at IS NULL AND p.storage_purged_at IS NULL`,
      [workspaceId, visual.map((row) => row.metadata.sourceReferenceId)],
    )
  ).rows;
  return rows.filter(
    (row) =>
      row.metadata?.origin !== "SOURCE_VISUAL" ||
      refs.some(
        (ref) =>
          ref.id === row.metadata.sourceReferenceId &&
          ref.document_id === row.document_id &&
          ref.media_asset_id === row.metadata.sourceMediaAssetId &&
          ref.checksum === row.metadata.originalChecksum &&
          ref.page_number === row.page_start,
      ),
  );
}
