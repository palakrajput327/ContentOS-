import { Worker } from "bullmq";
import { randomUUID } from "node:crypto";
import { pool, transaction, audit } from "./db.js";
import { redis } from "./queues.js";
import { S3StorageProvider } from "./storage/s3-storage.provider.js";
import { extractPDFPages } from "./documents/extraction/pdf-extractor.js";
import { chunkDocumentPages } from "./documents/chunking/document-chunker.js";
import { detectScannedPDF, StubOcrProvider } from "./documents/ocr/ocr.provider.js";
import { ExtractionJobPayload } from "./documents/documents.types.js";

function getStorageProvider(): { provider: S3StorageProvider; bucket: string } {
  const endpoint = process.env.STORAGE_ENDPOINT || "http://127.0.0.1:9000";
  const region = process.env.STORAGE_REGION || "us-east-1";
  const bucket = process.env.STORAGE_BUCKET || "contentos-media";
  const accessKeyId = process.env.STORAGE_ACCESS_KEY || "contentos";
  const secretAccessKey = process.env.STORAGE_SECRET_KEY || "local-minio-dev-only";
  const forcePathStyle = process.env.STORAGE_FORCE_PATH_STYLE !== "false";

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

export const pdfWorker = new Worker<ExtractionJobPayload>(
  "pdf-processing",
  async (job) => {
    const { documentId, workspaceId } = job.data;
    console.log(`[PDF Worker] Starting extraction for document ${documentId} (workspace: ${workspaceId})`);

    // 1. Fetch document and media asset details
    const docRes = await pool.query(
      `SELECT d.*, m.bucket, m.object_key, m.size_bytes
       FROM documents d
       JOIN media_assets m ON m.id = d.media_asset_id
       WHERE d.id = $1 AND d.workspace_id = $2`,
      [documentId, workspaceId],
    );

    if (!docRes.rowCount) {
      throw new Error(`Document ${documentId} not found in workspace ${workspaceId}`);
    }

    const doc = docRes.rows[0];

    // Mark as PROCESSING
    await pool.query(
      "UPDATE documents SET status = 'PROCESSING', processing_started_at = NOW() WHERE id = $1",
      [documentId],
    );

    try {
      // 2. Fetch object from Object Storage
      const { provider } = getStorageProvider();
      const signedDownloadUrl = await provider.getSignedDownloadUrl(doc.bucket, doc.object_key, 300);

      const downloadRes = await fetch(signedDownloadUrl);
      if (!downloadRes.ok) {
        throw new Error(`Failed to download PDF object from storage (${downloadRes.status})`);
      }

      const arrayBuf = await downloadRes.arrayBuffer();
      const pdfBuffer = Buffer.from(arrayBuf);

      // 3. Extract Pages
      await pool.query("UPDATE documents SET status = 'EXTRACTING' WHERE id = $1", [documentId]);
      const { pageCount, pages } = await extractPDFPages(pdfBuffer);

      // 4. OCR Detection & Handling
      const isScanned = detectScannedPDF(pages);
      let ocrUsed = false;

      if (isScanned) {
        const ocrProvider = new StubOcrProvider();
        if (!ocrProvider.isAvailable()) {
          console.warn(`[PDF Worker] Document ${documentId} appears to be scanned/OCR required, but OCR is disabled.`);
        } else {
          ocrUsed = true;
        }
      }

      // 5. Text Normalization (applied in extractPDFPages) & Chunking
      await pool.query("UPDATE documents SET status = 'CHUNKING' WHERE id = $1", [documentId]);
      const chunks = chunkDocumentPages(pages);

      // 6. Idempotent Database Transaction (replace previous pages & chunks)
      await transaction(async (db) => {
        await db.query("DELETE FROM document_pages WHERE document_id = $1", [documentId]);
        await db.query("DELETE FROM document_chunks WHERE document_id = $1", [documentId]);

        for (const p of pages) {
          await db.query(
            `INSERT INTO document_pages(id, document_id, workspace_id, page_number, raw_text, clean_text, extraction_method, ocr_used, character_count)
             VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              randomUUID(),
              documentId,
              workspaceId,
              p.pageNumber,
              p.rawText,
              p.cleanText,
              p.extractionMethod,
              ocrUsed,
              p.characterCount,
            ],
          );
        }

        for (const c of chunks) {
          await db.query(
            `INSERT INTO document_chunks(id, document_id, workspace_id, chunk_index, page_start, page_end, content, character_count, token_count, content_hash)
             VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              randomUUID(),
              documentId,
              workspaceId,
              c.chunkIndex,
              c.pageStart,
              c.pageEnd,
              c.content,
              c.characterCount,
              c.tokenCount,
              c.contentHash,
            ],
          );
        }

        await db.query(
          `UPDATE documents
           SET status = 'READY', page_count = $1, processing_completed_at = NOW(), failure_code = NULL, failure_message = NULL
           WHERE id = $2`,
          [pageCount, documentId],
        );

        await audit(
          db,
          workspaceId,
          null,
          "DOCUMENT_PROCESSING_COMPLETED",
          "document",
          documentId,
          doc.original_filename,
          null,
          { pageCount, chunkCount: chunks.length, ocrUsed },
        );
      });

      console.log(`[PDF Worker] Extraction completed successfully for ${documentId}: ${pageCount} pages, ${chunks.length} chunks.`);
    } catch (err: any) {
      console.error(`[PDF Worker] Extraction failed for document ${documentId}:`, err);
      const errMsg = err?.message || "PDF processing failed";

      await pool.query(
        `UPDATE documents
         SET status = 'FAILED', failure_code = 'PROCESSING_ERROR', failure_message = $1, processing_completed_at = NOW()
         WHERE id = $2`,
        [errMsg.substring(0, 500), documentId],
      );

      await audit(
        pool,
        workspaceId,
        null,
        "DOCUMENT_PROCESSING_FAILED",
        "document",
        documentId,
        doc.original_filename,
        null,
        { error: errMsg },
      );

      throw err;
    }
  },
  {
    connection: redis,
    concurrency: Number(process.env.PDF_WORKER_CONCURRENCY) || 2,
  },
);

pdfWorker.on("failed", (job, err) => {
  console.error(`[PDF Worker] Job ${job?.id} failed with error:`, err);
});

async function shutdown() {
  await pdfWorker.close();
  await redis.quit();
  await pool.end();
}

if (process.argv[1] && process.argv[1].endsWith("pdf-worker.js")) {
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  console.log(JSON.stringify({ event: "pdf_worker_ready", queue: "pdf-processing" }));
}
