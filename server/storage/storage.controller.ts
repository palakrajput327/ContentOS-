import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, pool, transaction } from "../db.js";
import { assertPermission, WorkspaceRequired, type AuthedRequest } from "../security.js";
import { MediaAssetType } from "./storage.types.js";
import { S3StorageProvider } from "./s3-storage.provider.js";

export const presignUploadSchema = z.object({
  type: z.enum([
    "DOCUMENT",
    "IMAGE",
    "VIDEO",
    "AUDIO",
    "THUMBNAIL",
    "GENERATED_ASSET",
  ]),
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(128),
  sizeBytes: z.number().int().positive().max(500 * 1024 * 1024), // 500 MB max limit
});

export const completeUploadSchema = z.object({
  checksum: z.string().optional(),
});

function getStorageProvider(): { provider: S3StorageProvider; bucket: string } {
  const endpoint = process.env.STORAGE_ENDPOINT;
  const region = process.env.STORAGE_REGION || "us-east-1";
  const bucket = process.env.STORAGE_BUCKET;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.STORAGE_SECRET_KEY;
  const forcePathStyle = process.env.STORAGE_FORCE_PATH_STYLE !== "false";

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new ServiceUnavailableException(
      "Object Storage is not configured on the server.",
    );
  }

  return {
    provider: new S3StorageProvider({
      endpoint,
      region,
      accessKeyId,
      secretAccessKey,
      forcePathStyle,
    }),
    bucket,
  };
}

function validateMimeType(type: MediaAssetType, mime: string) {
  const allowed: Record<MediaAssetType, string[]> = {
    DOCUMENT: ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"],
    IMAGE: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"],
    VIDEO: ["video/mp4", "video/webm", "video/quicktime"],
    AUDIO: ["audio/mpeg", "audio/wav", "audio/mp4", "audio/ogg"],
    THUMBNAIL: ["image/jpeg", "image/png", "image/webp"],
    GENERATED_ASSET: ["image/png", "image/jpeg", "image/webp", "video/mp4", "application/json"],
  };

  if (!allowed[type]?.includes(mime.toLowerCase())) {
    throw new BadRequestException(
      `MIME type '${mime}' is not permitted for asset type '${type}'.`,
    );
  }
}

@Controller("storage")
export class StorageController {
  @WorkspaceRequired()
  @Post("uploads/presign")
  async presignUpload(@Req() r: AuthedRequest, @Body() input: unknown) {
    assertPermission(r.workspace.role, "edit");
    const v = presignUploadSchema.parse(input);
    validateMimeType(v.type as MediaAssetType, v.mimeType);

    const { provider, bucket } = getStorageProvider();
    const assetId = randomUUID();
    const w = r.workspace.id;

    // Workspace-isolated storage object key format
    const categoryFolder = v.type.toLowerCase();
    const ext = v.originalFilename.includes(".")
      ? v.originalFilename.substring(v.originalFilename.lastIndexOf("."))
      : "";
    const objectKey = `workspaces/${w}/${categoryFolder}/${assetId}/file${ext}`;

    return transaction(async (db) => {
      await db.query(
        `INSERT INTO media_assets(id, workspace_id, type, storage_provider, bucket, object_key, mime_type, size_bytes, original_filename, status, created_by)
         VALUES($1, $2, $3, 's3', $4, $5, $6, $7, $8, 'PENDING', $9)`,
        [
          assetId,
          w,
          v.type,
          bucket,
          objectKey,
          v.mimeType,
          v.sizeBytes,
          v.originalFilename,
          r.user.id,
        ],
      );

      const presigned = await provider.getSignedUploadUrl({
        bucket,
        objectKey,
        mimeType: v.mimeType,
        expiresInSeconds: 900, // 15 mins
      });

      await audit(
        db,
        w,
        r.user.id,
        "MEDIA_UPLOAD_CREATED",
        "media_asset",
        assetId,
        v.originalFilename,
        null,
        { type: v.type, mimeType: v.mimeType, sizeBytes: v.sizeBytes },
      );

      return {
        assetId,
        uploadUrl: presigned.uploadUrl,
        expiresAt: presigned.expiresAt,
        headers: presigned.headers,
      };
    });
  }

  @WorkspaceRequired()
  @Post("uploads/:assetId/complete")
  async completeUpload(
    @Req() r: AuthedRequest,
    @Param("assetId") assetId: string,
    @Body() input: unknown,
  ) {
    assertPermission(r.workspace.role, "edit");
    const v = completeUploadSchema.parse(input);
    const w = r.workspace.id;

    const assetRes = await pool.query(
      "SELECT * FROM media_assets WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL",
      [assetId, w],
    );

    if (!assetRes.rowCount) {
      throw new NotFoundException("Media asset record not found in this workspace.");
    }

    const asset = assetRes.rows[0];
    const { provider } = getStorageProvider();

    // Verify object exists in storage
    const exists = await provider.exists(asset.bucket, asset.object_key);
    if (!exists) {
      throw new BadRequestException("Uploaded file was not found in object storage.");
    }

    const meta = await provider.getMetadata(asset.bucket, asset.object_key);

    return transaction(async (db) => {
      await db.query(
        "UPDATE media_assets SET status = 'COMPLETED', size_bytes = $1, checksum = COALESCE($2, checksum) WHERE id = $3 AND workspace_id = $4",
        [meta.sizeBytes || asset.size_bytes, v.checksum || null, assetId, w],
      );

      await audit(
        db,
        w,
        r.user.id,
        "MEDIA_UPLOAD_COMPLETED",
        "media_asset",
        assetId,
        asset.original_filename,
        null,
        { sizeBytes: meta.sizeBytes },
      );

      return {
        assetId,
        status: "COMPLETED",
        filename: asset.original_filename,
        sizeBytes: meta.sizeBytes || asset.size_bytes,
        mimeType: asset.mime_type,
      };
    });
  }

  @WorkspaceRequired()
  @Get("media/:assetId")
  async getMediaMetadata(@Req() r: AuthedRequest, @Param("assetId") assetId: string) {
    const w = r.workspace.id;
    const res = await pool.query(
      "SELECT id, type, mime_type, size_bytes, original_filename, status, created_at FROM media_assets WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL",
      [assetId, w],
    );

    if (!res.rowCount) {
      throw new NotFoundException("Media asset not found in this workspace.");
    }

    return { asset: res.rows[0] };
  }

  @WorkspaceRequired()
  @Get("media/:assetId/download")
  async getDownloadUrl(@Req() r: AuthedRequest, @Param("assetId") assetId: string) {
    const w = r.workspace.id;
    const res = await pool.query(
      "SELECT bucket, object_key, original_filename, status FROM media_assets WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL",
      [assetId, w],
    );

    if (!res.rowCount) {
      throw new NotFoundException("Media asset not found in this workspace.");
    }

    const asset = res.rows[0];
    if (asset.status !== "COMPLETED") {
      throw new BadRequestException("Media upload is incomplete.");
    }

    const { provider } = getStorageProvider();
    const downloadUrl = await provider.getSignedDownloadUrl(
      asset.bucket,
      asset.object_key,
      900, // 15 mins
    );

    await audit(
      pool,
      w,
      r.user.id,
      "MEDIA_DOWNLOADED",
      "media_asset",
      assetId,
      asset.original_filename,
    );

    return {
      assetId,
      downloadUrl,
      filename: asset.original_filename,
    };
  }

  @WorkspaceRequired()
  @Delete("media/:assetId")
  async deleteMedia(@Req() r: AuthedRequest, @Param("assetId") assetId: string) {
    assertPermission(r.workspace.role, "manage");
    const w = r.workspace.id;

    const res = await pool.query(
      "SELECT bucket, object_key, original_filename FROM media_assets WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL",
      [assetId, w],
    );

    if (!res.rowCount) {
      throw new NotFoundException("Media asset not found in this workspace.");
    }

    const asset = res.rows[0];
    const { provider } = getStorageProvider();

    return transaction(async (db) => {
      await db.query(
        "UPDATE media_assets SET deleted_at = NOW() WHERE id = $1 AND workspace_id = $2",
        [assetId, w],
      );

      try {
        await provider.delete(asset.bucket, asset.object_key);
      } catch (err) {
        console.warn("Storage delete warn:", err);
      }

      await audit(
        db,
        w,
        r.user.id,
        "MEDIA_DELETED",
        "media_asset",
        assetId,
        asset.original_filename,
      );

      return { success: true, assetId };
    });
  }
}
