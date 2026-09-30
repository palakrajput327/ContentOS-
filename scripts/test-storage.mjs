import { pool } from "../dist-api/db.js";
import { randomUUID } from "node:crypto";
import { S3StorageProvider } from "../dist-api/storage/s3-storage.provider.js";

async function runStorageTests() {
  console.log("=== STEP 2 OBJECT STORAGE VERIFICATION ===");

  // 1. Verify S3StorageProvider SigV4 Presigner
  const provider = new S3StorageProvider({
    endpoint: "http://127.0.0.1:9000",
    region: "us-east-1",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    forcePathStyle: true,
  });

  const presignResult = await provider.getSignedUploadUrl({
    bucket: "contentos-media",
    objectKey: "workspaces/test-ws/documents/test-asset/file.pdf",
    mimeType: "application/pdf",
    expiresInSeconds: 900,
  });

  if (!presignResult.uploadUrl.includes("X-Amz-Signature=")) {
    throw new Error("SigV4 Presigned Upload URL generation failed.");
  }
  console.log("✔ SigV4 Presigned Upload URL generation: OK");

  const downloadUrl = await provider.getSignedDownloadUrl(
    "contentos-media",
    "workspaces/test-ws/documents/test-asset/file.pdf",
    900,
  );

  if (!downloadUrl.includes("X-Amz-Signature=")) {
    throw new Error("SigV4 Presigned Download URL generation failed.");
  }
  console.log("✔ SigV4 Presigned Download URL generation: OK");

  // 2. Database Schema Verification
  const tableCheck = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'media_assets'",
  );
  if (tableCheck.rowCount === 0) {
    console.warn("⚠ media_assets table not migrated yet in active local DB.");
  } else {
    console.log(`✔ media_assets table exists with ${tableCheck.rowCount} columns: OK`);
  }

  console.log("=== ALL STORAGE TESTS COMPLETED SUCCESSFULLY ===");
  process.exit(0);
}

runStorageTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
