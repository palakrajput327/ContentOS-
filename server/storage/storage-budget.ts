import { BadRequestException, NotFoundException } from "@nestjs/common";
import { pool, type DB } from "../db.js";

export async function storageUsage(db: DB, workspaceId: string) {
  const result = await db.query(
    `SELECT w.storage_limit_bytes AS limit_bytes,
    COALESCE(SUM(m.size_bytes) FILTER(WHERE m.storage_purged_at IS NULL),0) AS used_bytes,
    COALESCE(SUM(m.size_bytes) FILTER(WHERE m.storage_purged_at IS NULL AND m.status='PENDING'),0) AS reserved_bytes,
    COALESCE(SUM(m.size_bytes) FILTER(WHERE m.storage_purged_at IS NULL AND m.metadata->>'origin'='PDF_SOURCE'),0) AS source_media_bytes
    FROM workspaces w LEFT JOIN media_assets m ON m.workspace_id=w.id WHERE w.id=$1 GROUP BY w.id`,
    [workspaceId],
  );
  if (!result.rowCount) throw new NotFoundException("Workspace not found.");
  const row = result.rows[0];
  return {
    limitBytes: Number(row.limit_bytes),
    usedBytes: Number(row.used_bytes),
    reservedBytes: Number(row.reserved_bytes),
    sourceMediaBytes: Number(row.source_media_bytes),
    remainingBytes: Math.max(
      0,
      Number(row.limit_bytes) - Number(row.used_bytes),
    ),
  };
}
export async function assertStorageCapacity(
  db: DB,
  workspaceId: string,
  bytes: number,
  excludeAssetId?: string,
) {
  if (!Number.isSafeInteger(bytes) || bytes < 0)
    throw new BadRequestException("Invalid storage size.");
  const workspace = await db.query(
    "SELECT storage_limit_bytes FROM workspaces WHERE id=$1 FOR UPDATE",
    [workspaceId],
  );
  if (!workspace.rowCount) throw new NotFoundException("Workspace not found.");
  const usage = await db.query(
    "SELECT COALESCE(SUM(size_bytes),0) AS used FROM media_assets WHERE workspace_id=$1 AND storage_purged_at IS NULL AND ($2::uuid IS NULL OR id<>$2)",
    [workspaceId, excludeAssetId || null],
  );
  if (
    Number(usage.rows[0].used) + bytes >
    Number(workspace.rows[0].storage_limit_bytes)
  )
    throw new BadRequestException(
      "Workspace storage quota exceeded. Free managed storage or increase the workspace storage limit.",
    );
}

export async function readSourcePDF(
  provider: ReturnType<
    typeof import("./storage.factory.js").getStorageProvider
  >["provider"],
  bucket: string,
  objectKey: string,
) {
  const stream = await provider.read(bucket, objectKey),
    chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const part = Buffer.from(chunk);
    bytes += part.length;
    if (bytes > 50 * 1024 * 1024) {
      stream.destroy();
      throw new BadRequestException("PDF exceeds the 50 MB extraction limit.");
    }
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}
