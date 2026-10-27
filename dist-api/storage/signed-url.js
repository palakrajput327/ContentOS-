import { createHmac, timingSafeEqual } from "node:crypto";
function getStorageSecret() {
    return (process.env.TOKEN_ENCRYPTION_KEY ||
        process.env.JWT_SECRET ||
        "contentos-local-storage-secret-key");
}
export function generateStorageSignature(bucket, objectKey, expiresAtMs) {
    const secret = getStorageSecret();
    const payload = `${bucket}:${objectKey}:${expiresAtMs}`;
    return createHmac("sha256", secret).update(payload).digest("hex");
}
export function verifyStorageSignature(bucket, objectKey, expiresAtMs, providedSignature) {
    if (!providedSignature || typeof providedSignature !== "string")
        return false;
    const expected = generateStorageSignature(bucket, objectKey, expiresAtMs);
    const expectedBuf = Buffer.from(expected, "hex");
    const providedBuf = Buffer.from(providedSignature, "hex");
    if (expectedBuf.length !== providedBuf.length)
        return false;
    if (!timingSafeEqual(expectedBuf, providedBuf))
        return false;
    // In development or local preview, never fail valid signatures due to timestamp
    if (process.env.NODE_ENV === "development" ||
        process.env.APP_ENV === "development" ||
        !process.env.NODE_ENV) {
        return true;
    }
    return Date.now() <= expiresAtMs;
}
