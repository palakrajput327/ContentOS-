import {
  ConflictException,
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
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, pool, transaction } from "../db.js";
import {
  assertPermission,
  WorkspaceRequired,
  type AuthedRequest,
} from "../security.js";
import { Put, Query, Res } from "@nestjs/common";
import * as path from "node:path";
import * as fs from "node:fs";
import { MediaAssetType, ObjectStorageProvider } from "./storage.types.js";
import { S3StorageProvider } from "./s3-storage.provider.js";
import { LocalStorageProvider } from "./local-storage.provider.js";
import { getStorageProvider } from "./storage.factory.js";

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
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(500 * 1024 * 1024), // 500 MB max limit
});

export const completeUploadSchema = z.object({
  checksum: z.string().optional(),
});

function validateMimeType(type: MediaAssetType, mime: string) {
  const allowed: Record<MediaAssetType, string[]> = {
    DOCUMENT: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ],
    IMAGE: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/svg+xml",
    ],
    VIDEO: ["video/mp4", "video/webm", "video/quicktime"],
    AUDIO: ["audio/mpeg", "audio/wav", "audio/mp4", "audio/ogg"],
    THUMBNAIL: ["image/jpeg", "image/png", "image/webp"],
    GENERATED_ASSET: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "video/mp4",
      "application/json",
    ],
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
        headers: {
          ...presigned.headers,
          ...(provider instanceof LocalStorageProvider
            ? { "X-Workspace-Id": w }
            : {}),
        },
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
      throw new NotFoundException(
        "Media asset record not found in this workspace.",
      );
    }

    const asset = assetRes.rows[0];
    const { provider } = getStorageProvider();

    // Verify object exists in storage
    const exists = await provider.exists(asset.bucket, asset.object_key);
    if (!exists) {
      throw new BadRequestException(
        "Uploaded file was not found in object storage.",
      );
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
  async getMediaMetadata(
    @Req() r: AuthedRequest,
    @Param("assetId") assetId: string,
  ) {
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
  async getDownloadUrl(
    @Req() r: AuthedRequest,
    @Param("assetId") assetId: string,
  ) {
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
  async deleteMedia(
    @Req() r: AuthedRequest,
    @Param("assetId") assetId: string,
  ) {
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

  @WorkspaceRequired()
  @Get("media")
  async listMedia(@Req() r: AuthedRequest, @Query("type") type?: string) {
    const w = r.workspace.id;
    const query = type
      ? "SELECT id, type, mime_type, size_bytes, original_filename, status, created_at FROM media_assets WHERE workspace_id = $1 AND type = $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100"
      : "SELECT id, type, mime_type, size_bytes, original_filename, status, created_at FROM media_assets WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100";
    const params = type ? [w, type] : [w];
    const res = await pool.query(query, params);
    return { media: res.rows };
  }

  @WorkspaceRequired()
  @Put("local/upload")
  async localUpload(
    @Query("bucket") bucket: string,
    @Query("key") objectKey: string,
    @Req() req: AuthedRequest,
    @Res() res: any,
  ) {
    assertPermission(req.workspace.role, "edit");
    const asset = (
      await pool.query(
        "SELECT * FROM media_assets WHERE bucket=$1 AND object_key=$2 AND workspace_id=$3 AND deleted_at IS NULL",
        [bucket, objectKey, req.workspace.id],
      )
    ).rows[0];
    if (!asset || asset.status !== "PENDING")
      throw new NotFoundException(
        "Pending upload not found in this workspace.",
      );
    const base = path.resolve(process.env.STORAGE_LOCAL_DIR || "uploads");
    const file = path.resolve(base, bucket, objectKey);
    if (
      !file.startsWith(base + path.sep) ||
      objectKey.includes("..") ||
      objectKey.includes("\\")
    )
      throw new BadRequestException("Invalid media path");
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    let destination: fs.promises.FileHandle;
    try {
      destination = await fs.promises.open(file, "wx");
    } catch {
      throw new ConflictException(
        "This file was already uploaded. Complete it or start a new upload.",
      );
    }
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        callback(
          bytes > Number(asset.size_bytes) || bytes > 500 * 1024 * 1024
            ? new Error("Upload exceeds declared size")
            : null,
          chunk,
        );
      },
    });
    try {
      await pipeline(req, limiter, destination.createWriteStream());
    } catch (e) {
      await fs.promises.unlink(file).catch(() => {});
      throw new BadRequestException(
        "Media upload failed or exceeds declared size.",
      );
    }
    if (bytes !== Number(asset.size_bytes)) {
      await fs.promises.unlink(file);
      throw new BadRequestException(
        "Uploaded size does not match the selected file.",
      );
    }
    return res.status(200).json({ ok: true, sizeBytes: bytes });
  }

  @Get("local/download")
  async localDownload(
    @Query("bucket") bucket: string,
    @Query("key") objectKey: string,
    @Req() req: AuthedRequest,
    @Res() res: any,
  ) {
    const asset = (
      await pool.query(
        "SELECT m.* FROM media_assets m JOIN workspace_members w ON w.workspace_id=m.workspace_id WHERE m.bucket=$1 AND m.object_key=$2 AND w.user_id=$3 AND m.deleted_at IS NULL AND m.status='COMPLETED'",
        [bucket, objectKey, req.user.id],
      )
    ).rows[0];
    if (!asset)
      throw new NotFoundException("Media not found in your workspaces.");
    const base = path.resolve(process.env.STORAGE_LOCAL_DIR || "uploads"),
      file = path.resolve(base, bucket, objectKey);
    if (
      !file.startsWith(base + path.sep) ||
      objectKey.includes("..") ||
      objectKey.includes("\\")
    )
      throw new BadRequestException("Invalid media path");
    return res.sendFile(file);
  }
}
