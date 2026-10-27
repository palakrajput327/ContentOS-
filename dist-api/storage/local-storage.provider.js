import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
export class LocalStorageProvider {
    baseDir;
    constructor(baseDir) {
        this.baseDir =
            baseDir ||
                process.env.STORAGE_LOCAL_DIR ||
                path.resolve(process.cwd(), "uploads");
    }
    getFilePath(bucket, objectKey) {
        const root = path.resolve(this.baseDir);
        const target = path.resolve(root, bucket, objectKey);
        if (!target.startsWith(root + path.sep) ||
            !/^[a-zA-Z0-9_-]+$/.test(bucket) ||
            objectKey.includes("..") ||
            objectKey.includes("\\"))
            throw new Error("Invalid storage path");
        return target;
    }
    async read(bucket, objectKey) {
        return createReadStream(this.getFilePath(bucket, objectKey));
    }
    async upload(input) {
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
    async delete(bucket, objectKey) {
        const targetPath = this.getFilePath(bucket, objectKey);
        try {
            await fs.unlink(targetPath);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
    }
    async exists(bucket, objectKey) {
        const targetPath = this.getFilePath(bucket, objectKey);
        try {
            await fs.access(targetPath);
            return true;
        }
        catch {
            return false;
        }
    }
    async getMetadata(bucket, objectKey) {
        const targetPath = this.getFilePath(bucket, objectKey);
        const stat = await fs.stat(targetPath);
        const ext = path.extname(objectKey).toLowerCase();
        const mimeMap = {
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
    async getSignedUploadUrl(input) {
        const expiresIn = input.expiresInSeconds || 900;
        const defaultBase = (process.env.NODE_ENV === "development" || process.env.APP_ENV === "development")
            ? `http://localhost:${process.env.PORT || 3001}`
            : "https://api.hidustansocialnetwork.in";
        const base = (process.env.STORAGE_PUBLIC_URL || process.env.PUBLIC_URL || defaultBase).replace(/\/+$/, "");
        const uploadUrl = `${base}/api/v1/storage/local/upload?bucket=${encodeURIComponent(input.bucket)}&key=${encodeURIComponent(input.objectKey)}`;
        return {
            uploadUrl,
            expiresAt: new Date(Date.now() + expiresIn * 1000),
            headers: {
                "content-type": input.mimeType,
            },
        };
    }
    async getSignedDownloadUrl(bucket, objectKey, expiresInSeconds = 3600) {
        const { generateStorageSignature } = await import("./signed-url.js");
        const expiresAt = Date.now() + expiresInSeconds * 1000;
        const sig = generateStorageSignature(bucket, objectKey, expiresAt);
        const defaultBase = (process.env.NODE_ENV === "development" || process.env.APP_ENV === "development")
            ? `http://localhost:${process.env.PORT || 3001}`
            : "https://api.hidustansocialnetwork.in";
        const base = (process.env.STORAGE_PUBLIC_URL || process.env.PUBLIC_URL || defaultBase).replace(/\/+$/, "");
        return `${base}/api/v1/storage/local/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(objectKey)}&expires=${expiresAt}&sig=${sig}`;
    }
}
