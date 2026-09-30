import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  ObjectStorageProvider,
  UploadObjectInput,
  StoredObject,
  SignedUploadInput,
  SignedUrlResult,
  ObjectMetadata,
} from "./storage.types.js";

export class LocalStorageProvider implements ObjectStorageProvider {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || process.env.STORAGE_LOCAL_DIR || path.resolve(process.cwd(), "uploads");
  }

  private getFilePath(bucket: string, objectKey: string): string {
    const safeKey = objectKey.replace(/\.\./g, "_");
    return path.join(this.baseDir, bucket, safeKey);
  }

  async upload(input: UploadObjectInput): Promise<StoredObject> {
    const targetPath = this.getFilePath(input.bucket, input.objectKey);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, input.body);
    const stat = await fs.stat(targetPath);
    return {
      bucket: input.bucket,
      objectKey: input.objectKey,
      sizeBytes: stat.size,
      etag: `local-${stat.mtimeMs}`,
    };
  }

  async delete(bucket: string, objectKey: string): Promise<void> {
    const targetPath = this.getFilePath(bucket, objectKey);
    try {
      await fs.unlink(targetPath);
    } catch {
      // Ignore if already deleted
    }
  }

  async exists(bucket: string, objectKey: string): Promise<boolean> {
    const targetPath = this.getFilePath(bucket, objectKey);
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(bucket: string, objectKey: string): Promise<ObjectMetadata> {
    const targetPath = this.getFilePath(bucket, objectKey);
    const stat = await fs.stat(targetPath);
    const ext = path.extname(objectKey).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".pdf": "application/pdf",
      ".json": "application/json",
      ".txt": "text/plain",
    };

    return {
      sizeBytes: stat.size,
      mimeType: mimeMap[ext] || "application/octet-stream",
      lastModified: stat.mtime,
      etag: `local-${stat.mtimeMs}`,
    };
  }

  async getSignedUploadUrl(input: SignedUploadInput): Promise<SignedUrlResult> {
    const expiresIn = input.expiresInSeconds || 900;
    const uploadUrl = `/api/v1/storage/local/upload?bucket=${encodeURIComponent(
      input.bucket,
    )}&key=${encodeURIComponent(input.objectKey)}`;

    return {
      uploadUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      headers: {
        "content-type": input.mimeType,
      },
    };
  }

  async getSignedDownloadUrl(
    bucket: string,
    objectKey: string,
    _expiresInSeconds: number = 900,
  ): Promise<string> {
    return `/api/v1/storage/local/download?bucket=${encodeURIComponent(
      bucket,
    )}&key=${encodeURIComponent(objectKey)}`;
  }
}
