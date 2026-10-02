import { ObjectStorageProvider } from "./storage.types.js";
import { S3StorageProvider } from "./s3-storage.provider.js";
import { LocalStorageProvider } from "./local-storage.provider.js";
export function getStorageProvider(): {
  provider: ObjectStorageProvider;
  bucket: string;
} {
  const endpoint = process.env.STORAGE_ENDPOINT;
  const region = process.env.STORAGE_REGION || "us-east-1";
  const bucket = process.env.STORAGE_BUCKET;
  const accessKeyId = process.env.STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.STORAGE_SECRET_KEY;
  const forcePathStyle = process.env.STORAGE_FORCE_PATH_STYLE !== "false";

  if (endpoint && bucket && accessKeyId && secretAccessKey) {
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

  // Seamless fallback to local disk storage
  return {
    provider: new LocalStorageProvider(),
    bucket: process.env.STORAGE_BUCKET || "contentos-media",
  };
}
