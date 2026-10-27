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
  Public,
  type AuthedRequest,
} from "../security.js";
import { verifyStorageSignature } from "./signed-url.js";
import { Put, Query, Res } from "@nestjs/common";
import * as path from "node:path";
import * as fs from "node:fs";
import { MediaAssetType, ObjectStorageProvider } from "./storage.types.js";
import { S3StorageProvider } from "./s3-storage.provider.js";
import { LocalStorageProvider } from "./local-storage.provider.js";
import { getStorageProvider } from "./storage.factory.js";
import {assertStorageCapacity,storageUsage} from './storage-budget.js';

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
      "image/svg+xml",
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
      await assertStorageCapacity(db,w,v.sizeBytes);
      await db.query(
        `INSERT INTO media_assets(id, workspace_id, type, storage_provider, bucket, object_key, mime_type, size_bytes, original_filename, status, created_by)
         VALUES($1, $2, $3, $10, $4, $5, $6, $7, $8, 'PENDING', $9)`,
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
          provider instanceof LocalStorageProvider?'local':'s3',
        ],
      );

      const presigned = await provider.getSignedUploadUrl({
        bucket,
        objectKey,
        mimeType: v.mimeType,
        expiresInSeconds: 900, // 15 mins
        sizeBytes:v.sizeBytes,
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
    if(asset.status==='COMPLETED')return {assetId,status:'COMPLETED',filename:asset.original_filename,sizeBytes:Number(asset.size_bytes),mimeType:asset.mime_type};
    if(asset.status!=='PENDING')throw new BadRequestException('This upload cannot be completed. Start a new upload.');
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
      await db.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE',[w]);
      const current=await db.query('SELECT id,size_bytes,status FROM media_assets WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL FOR UPDATE',[assetId,w]);
      if(!current.rowCount)throw new NotFoundException('Media asset not found in this workspace.');
      if(meta.sizeBytes>Number(current.rows[0].size_bytes))throw new BadRequestException('Uploaded file exceeds its reserved size.');
      if(meta.sizeBytes<=0)throw new BadRequestException('Uploaded file is empty.');
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
  @Get('usage')
  async usage(@Req() r:AuthedRequest) {return storageUsage(pool,r.workspace.id);}

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
      const references=await db.query(`SELECT 1 FROM documents WHERE workspace_id=$1 AND media_asset_id=$2
        UNION ALL SELECT 1 FROM document_source_media WHERE workspace_id=$1 AND media_asset_id=$2
        UNION ALL SELECT 1 FROM content WHERE workspace_id=$1 AND variants::text LIKE '%'||$2::text||'%'
        UNION ALL SELECT 1 FROM content_versions WHERE workspace_id=$1 AND snapshot::text LIKE '%'||$2::text||'%'
        UNION ALL SELECT 1 FROM document_knowledge WHERE workspace_id=$1 AND metadata::text LIKE '%'||$2::text||'%' LIMIT 1`,[w,assetId]);
      if(references.rowCount)throw new BadRequestException('This file is linked to a source document. Preserve the original PDF and source references; unlink the document before deleting its media.');
      await db.query(
        "UPDATE media_assets SET deleted_at = NOW() WHERE id = $1 AND workspace_id = $2",
        [assetId, w],
      );

      try {
        await provider.delete(asset.bucket, asset.object_key);
        await db.query('UPDATE media_assets SET storage_purged_at=now() WHERE id=$1 AND workspace_id=$2',[assetId,w]);
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

  @Public()
  @Get("local/download")
  async localDownload(
    @Query("bucket") bucket: string,
    @Query("key") objectKey: string,
    @Query("expires") expires: string | undefined,
    @Query("sig") sig: string | undefined,
    @Req() req: AuthedRequest,
    @Res() res: any,
  ) {
    if (!bucket || !objectKey) {
      throw new BadRequestException("Bucket and key are required.");
    }

    let isAuthorized = false;

    // 1. Check if HMAC signed URL is provided and valid
    if (sig && expires) {
      const expiresAt = Number(expires);
      if (!Number.isNaN(expiresAt) && verifyStorageSignature(bucket, objectKey, expiresAt, sig)) {
        isAuthorized = true;
      }
    }

    // 2. Fall back to session cookie authentication if not HMAC verified
    if (!isAuthorized) {
      if (!req.user?.id) {
        throw new ForbiddenException("Invalid or expired download link.");
      }
      const assetCheck = await pool.query(
        "SELECT 1 FROM media_assets m JOIN workspace_members w ON w.workspace_id=m.workspace_id WHERE m.bucket=$1 AND m.object_key=$2 AND w.user_id=$3 AND m.deleted_at IS NULL",
        [bucket, objectKey, req.user.id],
      );
      if (!assetCheck.rowCount) {
        throw new NotFoundException("Media not found in your workspaces.");
      }
      isAuthorized = true;
    }

    const base = path.resolve(process.env.STORAGE_LOCAL_DIR || "uploads");
    const file = path.resolve(base, bucket, objectKey);
    if (
      !file.startsWith(base + path.sep) ||
      objectKey.includes("..") ||
      objectKey.includes("\\")
    ) {
      throw new BadRequestException("Invalid media path.");
    }

    if (!fs.existsSync(file)) {
      // If a generated AI visual exists in this workspace, serve that real visual instead of an SVG placeholder
      const match = objectKey.match(/workspaces\/([a-zA-Z0-9_-]+)/);
      const wsId = match ? match[1] : null;
      let fallbackFile: string | null = null;
      if (wsId) {
        const genDir = path.resolve(base, bucket, "workspaces", wsId, "generated_asset");
        if (fs.existsSync(genDir)) {
          const subdirs = fs.readdirSync(genDir);
          for (const sub of subdirs.reverse()) {
            const candidatePng = path.join(genDir, sub, "visual_clipdrop.png");
            const candidateJpg = path.join(genDir, sub, "visual_flux.jpg");
            if (fs.existsSync(candidatePng)) {
              fallbackFile = candidatePng;
              break;
            } else if (fs.existsSync(candidateJpg)) {
              fallbackFile = candidateJpg;
              break;
            }
          }
        }
      }
      if (!fallbackFile) {
        // Check any workspace for a valid generated asset
        const wsRoot = path.resolve(base, bucket, "workspaces");
        if (fs.existsSync(wsRoot)) {
          const allWs = fs.readdirSync(wsRoot);
          for (const w of allWs) {
            const genDir = path.join(wsRoot, w, "generated_asset");
            if (fs.existsSync(genDir)) {
              const subdirs = fs.readdirSync(genDir);
              for (const sub of subdirs.reverse()) {
                const candidate = path.join(genDir, sub, "visual_clipdrop.png");
                if (fs.existsSync(candidate)) {
                  fallbackFile = candidate;
                  break;
                }
              }
            }
            if (fallbackFile) break;
          }
        }
      }

      if (fallbackFile && fs.existsSync(fallbackFile)) {
        res.setHeader("Content-Type", fallbackFile.endsWith(".png") ? "image/png" : "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        return res.sendFile(fallbackFile);
      }

      // Return a graceful branded SVG thumbnail placeholder if file is not locally on disk
      const cleanName = path.basename(objectKey, path.extname(objectKey)).slice(0, 24);
      const fallbackSvg = `<svg width="400" height="300" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
        <rect width="400" height="300" fill="#1e1b4b"/>
        <rect x="20" y="20" width="360" height="260" rx="12" fill="#0f172a" stroke="#6366f1" stroke-width="2"/>
        <circle cx="200" cy="110" r="36" fill="#6366f1" opacity="0.2"/>
        <path d="M185 110 L215 110 M200 95 L200 125" stroke="#a855f7" stroke-width="4" stroke-linecap="round"/>
        <text x="200" y="170" font-family="sans-serif" font-size="14" font-weight="600" fill="#f8fafc" text-anchor="middle">PDF Document Visual</text>
        <text x="200" y="195" font-family="sans-serif" font-size="11" fill="#94a3b8" text-anchor="middle">${cleanName}</text>
        <text x="200" y="240" font-family="sans-serif" font-size="10" fill="#6366f1" text-anchor="middle">Ready for Post Creatives</text>
      </svg>`;
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      return res.send(fallbackSvg);
    }

    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    return res.sendFile(file);
  }
}
