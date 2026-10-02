export type MediaAssetType =
  "DOCUMENT" | "IMAGE" | "VIDEO" | "AUDIO" | "THUMBNAIL" | "GENERATED_ASSET";

export interface UploadObjectInput {
  bucket: string;
  objectKey: string;
  body: Buffer | Uint8Array;
  mimeType: string;
}

export interface StoredObject {
  bucket: string;
  objectKey: string;
  sizeBytes: number;
  etag?: string;
}

export interface SignedUploadInput {
  bucket: string;
  objectKey: string;
  mimeType: string;
  expiresInSeconds?: number;
}

export interface SignedUrlResult {
  uploadUrl: string;
  expiresAt: Date;
  headers?: Record<string, string>;
}

export interface ObjectMetadata {
  sizeBytes: number;
  mimeType: string;
  lastModified?: Date;
  etag?: string;
}

export interface ObjectStorageProvider {
  read(
    bucket: string,
    objectKey: string,
  ): Promise<import("node:stream").Readable>;
  upload(input: UploadObjectInput): Promise<StoredObject>;
  delete(bucket: string, objectKey: string): Promise<void>;
  exists(bucket: string, objectKey: string): Promise<boolean>;
  getSignedUploadUrl(input: SignedUploadInput): Promise<SignedUrlResult>;
  getSignedDownloadUrl(
    bucket: string,
    objectKey: string,
    expiresInSeconds?: number,
  ): Promise<string>;
  getMetadata(bucket: string, objectKey: string): Promise<ObjectMetadata>;
}
