import { randomUUID } from "node:crypto";
import { pool, type DB } from "../db.js";
import { BadRequestException } from "@nestjs/common";
import type { MediaAssetType, ObjectStorageProvider } from "./storage.types.js";

// Reserve bytes before a provider write, so quota rejection cannot create a new object.
export async function uploadManagedMedia(
  input: {
    assetId?: string;
    workspaceId: string;
    userId?: string | null;
    bucket: string;
    objectKey: string;
    body: Buffer;
    mimeType: string;
    filename: string;
    type: MediaAssetType;
    metadata?: Record<string, unknown>;
    provider: ObjectStorageProvider;
  },
  db: DB = pool,
) {
  const assetId = input.assetId || randomUUID();
  try {
    await db.query(
      `INSERT INTO media_assets(id,workspace_id,type,storage_provider,bucket,object_key,mime_type,size_bytes,original_filename,status,metadata,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'PENDING',$10,$11)`,
      [
        assetId,
        input.workspaceId,
        input.type,
        input.provider.constructor.name.includes("Local") ? "local" : "s3",
        input.bucket,
        input.objectKey,
        input.mimeType,
        input.body.length,
        input.filename,
        JSON.stringify(input.metadata || {}),
        input.userId || null,
      ],
    );
  } catch (error) {
    if (
      (error as { code?: string; message?: string }).code === "P0001" &&
      (error as Error).message.startsWith("Workspace storage quota exceeded")
    )
      throw new BadRequestException(
        "Workspace storage quota exceeded. Free managed storage or increase the workspace storage limit.",
      );
    throw error;
  }
  try {
    await input.provider.upload({
      bucket: input.bucket,
      objectKey: input.objectKey,
      body: input.body,
      mimeType: input.mimeType,
    });
    await db.query(
      "UPDATE media_assets SET status='COMPLETED' WHERE id=$1 AND workspace_id=$2",
      [assetId, input.workspaceId],
    );
    return assetId;
  } catch (error) {
    await db.query(
      "UPDATE media_assets SET status='FAILED' WHERE id=$1 AND workspace_id=$2",
      [assetId, input.workspaceId],
    );
    throw error;
  }
}
