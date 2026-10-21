import { createHmac, timingSafeEqual } from "node:crypto";

function getStorageSecret(): string {
  return (
    process.env.TOKEN_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    "contentos-local-storage-secret-key"
  );
}

export function generateStorageSignature(
  bucket: string,
  objectKey: string,
  expiresAtMs: number,
): string {
  const secret = getStorageSecret();
  const payload = `${bucket}:${objectKey}:${expiresAtMs}`;
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyStorageSignature(
  bucket: string,
  objectKey: string,
  expiresAtMs: number,
  providedSignature: string,
): boolean {
  if (!providedSignature || typeof providedSignature !== "string") return false;
  if (Date.now() > expiresAtMs) return false;

  const expected = generateStorageSignature(bucket, objectKey, expiresAtMs);
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(providedSignature, "hex");

  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
