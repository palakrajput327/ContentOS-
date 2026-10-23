import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
export class S3StorageProvider {
    client;
    constructor(config) {
        this.client = new S3Client({
            endpoint: config.endpoint,
            region: config.region || "us-east-1",
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
            forcePathStyle: config.forcePathStyle ?? true,
        });
    }
    async read(bucket, objectKey) {
        const response = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
        if (!response.Body)
            throw new Error("Media object not found");
        return response.Body;
    }
    async upload(input) {
        const command = new PutObjectCommand({
            Bucket: input.bucket,
            Key: input.objectKey,
            Body: input.body,
            ContentType: input.mimeType,
        });
        const response = await this.client.send(command);
        return {
            bucket: input.bucket,
            objectKey: input.objectKey,
            sizeBytes: input.body.byteLength,
            etag: response.ETag || undefined,
        };
    }
    async delete(bucket, objectKey) {
        const command = new DeleteObjectCommand({
            Bucket: bucket,
            Key: objectKey,
        });
        await this.client.send(command);
    }
    async exists(bucket, objectKey) {
        try {
            await this.getMetadata(bucket, objectKey);
            return true;
        }
        catch {
            return false;
        }
    }
    async getMetadata(bucket, objectKey) {
        const command = new HeadObjectCommand({
            Bucket: bucket,
            Key: objectKey,
        });
        const response = await this.client.send(command);
        return {
            sizeBytes: Number(response.ContentLength || 0),
            mimeType: response.ContentType || "application/octet-stream",
            lastModified: response.LastModified
                ? new Date(response.LastModified)
                : undefined,
            etag: response.ETag || undefined,
        };
    }
    async getSignedUploadUrl(input) {
        const expiresIn = input.expiresInSeconds || 900; // 15 mins default
        const command = new PutObjectCommand({
            Bucket: input.bucket,
            Key: input.objectKey,
            ContentType: input.mimeType,
            ContentLength: input.sizeBytes,
        });
        const uploadUrl = await getSignedUrl(this.client, command, {
            expiresIn,
        });
        return {
            uploadUrl,
            expiresAt: new Date(Date.now() + expiresIn * 1000),
            headers: {
                "content-type": input.mimeType,
            },
        };
    }
    async getSignedDownloadUrl(bucket, objectKey, expiresInSeconds = 900) {
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: objectKey,
        });
        return getSignedUrl(this.client, command, {
            expiresIn: expiresInSeconds,
        });
    }
}
