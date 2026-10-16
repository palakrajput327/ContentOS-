import { createReadStream } from "node:fs";
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
    this.baseDir =
      baseDir ||
      process.env.STORAGE_LOCAL_DIR ||
      path.resolve(process.cwd(), "uploads");
  }

  private getFilePath(bucket: string, objectKey: string): string {
    const root = path.resolve(this.baseDir);
    const target = path.resolve(root, bucket, objectKey);
    if (
      !target.startsWith(root + path.sep) ||
      !/^[a-zA-Z0-9_-]+$/.test(bucket) ||
      objectKey.includes("..") ||
      objectKey.includes("\\")
    )
      throw new Error("Invalid storage path");
    return target;
  }

  async read(bucket: string, objectKey: string) {
    return createReadStream(this.getFilePath(bucket, objectKey));
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
    } catch (error) {
      if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
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

  async getMetadata(
    bucket: string,
    objectKey: string,
  ): Promise<ObjectMetadata> {
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
    const base = process.env.PUBLIC_URL || process.env.VITE_API_BASE || process.env.APP_ORIGIN || "";
    const uploadUrl = `${base}/api/v1/storage/local/upload?bucket=${encodeURIComponent(
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
    const base = process.env.PUBLIC_URL || process.env.VITE_API_BASE || process.env.APP_ORIGIN || "";
    return `${base}/api/v1/storage/local/download?bucket=${encodeURIComponent(
      bucket,
    )}&key=${encodeURIComponent(objectKey)}`;
  }
}
