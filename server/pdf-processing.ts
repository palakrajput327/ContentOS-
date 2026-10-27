import { randomUUID } from "node:crypto";
import { pool, transaction, audit } from "./db.js";
import { getStorageProvider } from "./storage/storage.factory.js";
import { extractPDFPages, removeRepeatingWatermarks } from "./documents/extraction/pdf-extractor.js";
import { normalizeText } from "./documents/extraction/text-normalizer.js";
import { chunkDocumentPages } from "./documents/chunking/document-chunker.js";
import { detectScannedPDF, TesseractOcrProvider } from "./documents/ocr/ocr.provider.js";
import { KnowledgeService } from "./knowledge/knowledge.service.js";
import { persistDocumentImages } from "./documents/source-media.service.js";
import { queueBackend } from './queue-backend.js';
import { PostgresQueue } from './postgres-queue.js';

const knowledgeService = new KnowledgeService();

export async function processPDFDocument(
  documentId: string,
  workspaceId: string,
  options?: { force?: boolean; skipKnowledge?:boolean },
) {
  if (queueBackend()!=='postgres') return processLockedPDFDocument(documentId,workspaceId,options);
  const key=`pdf:${workspaceId}:${documentId}`,owner=randomUUID();
  const leases=new PostgresQueue(pool);
  if (!await leases.acquireLane(key,owner)) throw new Error('DOCUMENT_BUSY');
  let lost=false,busy=false;
  const heartbeat=setInterval(async()=>{
    if(busy)return;busy=true;
    try {if(!await leases.renewLane(key,owner))lost=true;}catch{lost=true;}finally{busy=false;}
  },10000);
  try {
    const result=await processLockedPDFDocument(documentId,workspaceId,{...options,ownership:{key,owner}});
    if(lost)throw new Error('DOCUMENT_LEASE_LOST');
    return result;
  } finally {
    clearInterval(heartbeat);while(busy)await new Promise(r=>setTimeout(r,10));
    if(!lost)await leases.releaseLane(key,owner);
  }
}

async function processLockedPDFDocument(
  documentId:string,workspaceId:string,
  options?:{force?:boolean;skipKnowledge?:boolean;ownership?:{key:string;owner:string}},
) {
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

  // Atomic check-and-lock: Only one worker/runner can process this document at a time
  const lock = options?.force
    ? await pool.query(
        `UPDATE documents
         SET status = 'PROCESSING', processing_started_at = NOW()
         WHERE id = $1 AND workspace_id = $2
         RETURNING id`,
        [documentId, workspaceId],
      )
    : await pool.query(
        `UPDATE documents
         SET status = 'PROCESSING', processing_started_at = NOW()
         WHERE id = $1 AND workspace_id = $2
           AND (status IN ('QUEUED', 'FAILED') OR (status IN ('PROCESSING', 'CHUNKING', 'EXTRACTING') AND (processing_started_at IS NULL OR processing_started_at < NOW() - INTERVAL '25 seconds')))
         RETURNING id`,
        [documentId, workspaceId],
      );
  if (!lock.rowCount) {
    console.log(`[PDF Worker] Document ${documentId} is already being processed or finished. Skipping duplicate run.`);
    return { pageCount: doc.page_count || 0, chunkCount: 0 };
  }

  try {
    // 2. Fetch object from Object Storage (Direct stream if local, presigned fetch if S3)
    const { provider, bucket } = getStorageProvider();
    let pdfBuffer: Buffer;

    if (typeof (provider as any).read === "function") {
      const stream = await (provider as any).read(doc.bucket || bucket, doc.object_key);
      const bufChunks: Buffer[] = [];
      for await (const chunk of stream) {
        bufChunks.push(Buffer.from(chunk));
      }
      pdfBuffer = Buffer.concat(bufChunks);
    } else {
      const signedDownloadUrl = await provider.getSignedDownloadUrl(
        doc.bucket || bucket,
        doc.object_key,
        300,
      );
      const downloadRes = await fetch(signedDownloadUrl);
      if (!downloadRes.ok) {
        throw new Error(`Failed to download PDF object from storage (${downloadRes.status})`);
      }
      const arrayBuf = await downloadRes.arrayBuffer();
      pdfBuffer = Buffer.from(arrayBuf);
    }

    // 3. Extract Pages
    await pool.query("UPDATE documents SET status = 'EXTRACTING' WHERE id = $1", [documentId]);
    const { pageCount, pages } = await extractPDFPages(pdfBuffer);
    await persistDocumentImages(documentId, workspaceId, pdfBuffer);

      // 4. OCR Detection & Handling
      const isScanned = detectScannedPDF(pages);
      let ocrUsed = false;

      if (isScanned) {
        console.log(`[PDF Worker] Document ${documentId} is scanned/image-based. Running OCR extraction...`);
        try {
          const ocrProvider = new TesseractOcrProvider();
          const maxOcrPages = Math.min(pageCount, Number(process.env.OCR_MAX_PAGES) || 10);
          const ocrResults = await ocrProvider.extractFromPDF(pdfBuffer, maxOcrPages, pageCount);
          if (ocrResults.size > 0) {
            ocrUsed = true;
            for (const p of pages) {
              if (ocrResults.has(p.pageNumber)) {
                const text = ocrResults.get(p.pageNumber)!;
                p.rawText = text;
                p.cleanText = normalizeText(text);
                p.characterCount = p.cleanText.length;
                p.ocrUsed = true;
                p.extractionMethod = "tesseract-ocr";
              }
            }
            removeRepeatingWatermarks(pages);
            console.log(`[PDF Worker] OCR populated text for ${ocrResults.size} pages.`);
          }
        } catch (ocrErr: any) {
          console.warn(`[PDF Worker] OCR extraction warning:`, ocrErr?.message || ocrErr);
        }
      }

      // 5. Text Normalization (applied in extractPDFPages) & Chunking
      await pool.query("UPDATE documents SET status = 'CHUNKING' WHERE id = $1", [documentId]);
      const chunks = chunkDocumentPages(pages);

      // 6. Idempotent Database Transaction (replace previous pages & chunks)
      const sanitize = (text: string | null | undefined) => (text ? text.replace(/\0/g, "") : "");

      await transaction(async (db) => {
        if(options?.ownership) {
          const held=await db.query(`SELECT 1 FROM queue_worker_leases WHERE lane=$1 AND owner=$2 AND lease_until>now() FOR SHARE`,[options.ownership.key,options.ownership.owner]);
          if(!held.rowCount)throw new Error('DOCUMENT_LEASE_LOST');
        }
        const docStillPresent = await db.query("SELECT id FROM documents WHERE id = $1", [documentId]);
        if (!docStillPresent.rowCount) {
          console.log(`[PDF Worker] Document ${documentId} was removed. Cancelling insertion.`);
          return;
        }

        await db.query("DELETE FROM document_pages WHERE document_id = $1", [documentId]);
        await db.query("DELETE FROM document_chunks WHERE document_id = $1", [documentId]);

        for (const p of pages) {
          await db.query(
            `INSERT INTO document_pages(id, document_id, workspace_id, page_number, raw_text, clean_text, extraction_method, ocr_used, character_count)
             VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (document_id, page_number) DO UPDATE SET
               raw_text = EXCLUDED.raw_text,
               clean_text = EXCLUDED.clean_text,
               extraction_method = EXCLUDED.extraction_method,
               ocr_used = EXCLUDED.ocr_used,
               character_count = EXCLUDED.character_count`,
            [
              randomUUID(),
              documentId,
              workspaceId,
              p.pageNumber,
              sanitize(p.rawText),
              sanitize(p.cleanText),
              p.extractionMethod,
              ocrUsed,
              p.characterCount,
            ],
          );
        }

        for (const c of chunks) {
          await db.query(
            `INSERT INTO document_chunks(id, document_id, workspace_id, chunk_index, page_start, page_end, content, character_count, token_count, content_hash)
             VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (document_id, chunk_index) DO UPDATE SET
               page_start = EXCLUDED.page_start,
               page_end = EXCLUDED.page_end,
               content = EXCLUDED.content,
               character_count = EXCLUDED.character_count,
               token_count = EXCLUDED.token_count,
               content_hash = EXCLUDED.content_hash`,
            [
              randomUUID(),
              documentId,
              workspaceId,
              c.chunkIndex,
              c.pageStart,
              c.pageEnd,
              sanitize(c.content),
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

        if(queueBackend()==='postgres'&&!options?.skipKnowledge) {
          const generationId=randomUUID();
          await db.query(`INSERT INTO ai_generations(id,workspace_id,actor_id,provider,generation_type,status,input,output)
            VALUES($1,$2,$3,$4,'DOCUMENT_KNOWLEDGE','QUEUED',$5,'{}')`,
            [generationId,workspaceId,doc.created_by,process.env.LLM_PROVIDER || 'groq',JSON.stringify({documentId,autoTriggered:true})]);
          await new PostgresQueue(pool).enqueue('content-generation','extract-knowledge',
            {generationId,documentId,workspaceId},
            {workspaceId,key:generationId,attempts:3,backoff:10000},db);
        }

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

      // 7. Auto-Extract Knowledge & Facts immediately
      try {
        const generationId = randomUUID();
        await pool.query(
          `INSERT INTO ai_generations(
            id, workspace_id, actor_id, provider, generation_type, status, input, output
          ) VALUES ($1, $2, $3, $4, 'DOCUMENT_KNOWLEDGE', 'QUEUED', $5, '{}')`,
          [
            generationId,
            workspaceId,
            doc.created_by,
            process.env.LLM_PROVIDER || "groq",
            JSON.stringify({ documentId, autoTriggered: true }),
          ],
        );

        console.log(`[PDF Worker] Auto-triggering knowledge extraction for document ${documentId}...`);
        await knowledgeService.processKnowledgeExtraction(generationId, documentId, workspaceId);
        console.log(`[PDF Worker] Knowledge extraction completed for document ${documentId}`);
      } catch (kErr: any) {
        console.warn(`[PDF Worker] Auto knowledge extraction deferred:`, kErr?.message || kErr);
      }

      return { pageCount, chunkCount: chunks.length };
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
}

