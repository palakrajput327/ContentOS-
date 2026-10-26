import { queueBackend } from '../queue-backend.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  Res,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, pool, transaction } from "../db.js";
import { assertPermission, WorkspaceRequired, type AuthedRequest } from "../security.js";
import { createQueue } from '../queues.js';
import { getStorageProvider } from "../storage/storage.factory.js";
import {storageUsage,readSourcePDF} from '../storage/storage-budget.js';
import {extractSourceImages} from './extraction/source-images.js';
import {createHash} from 'node:crypto';
import {visionConfigured} from './visual-knowledge.service.js';

const pdfProcessingQueue = createQueue("pdf-processing", {
  defaultJobOptions: {
    attempts: Number(process.env.PDF_JOB_ATTEMPTS) || 3,
    backoff: { type: "exponential", delay: 10000 },
    removeOnComplete: { age: 7 * 86400 },
    removeOnFail: { age: 30 * 86400 },
  },
});

export const createDocumentSchema = z.object({
  mediaAssetId: z.string().uuid(),
});

@Controller("documents")
export class DocumentsController {
  @WorkspaceRequired()
  @Post()
  async createDocument(@Req() r: AuthedRequest, @Body() input: unknown) {
    assertPermission(r.workspace.role, "edit");
    const v = createDocumentSchema.parse(input);
    const w = r.workspace.id;

    // Verify media asset exists, belongs to active workspace, is COMPLETED and is PDF
    const assetRes = await pool.query(
      "SELECT * FROM media_assets WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL",
      [v.mediaAssetId, w],
    );

    if (!assetRes.rowCount) {
      throw new NotFoundException("Media asset record not found in this workspace.");
    }

    const asset = assetRes.rows[0];
    if (asset.status !== "COMPLETED") {
      throw new BadRequestException("Media asset upload is not completed.");
    }

    if (asset.mime_type !== "application/pdf") {
      throw new BadRequestException("Only PDF documents can be processed.");
    }

    const maxMB = Number(process.env.PDF_MAX_FILE_SIZE_MB) || 50;
    if (Number(asset.size_bytes) > maxMB * 1024 * 1024) {
      throw new BadRequestException(`PDF size exceeds maximum limit of ${maxMB} MB.`);
    }

    const documentId = randomUUID();

    const result = await transaction(async (db) => {
      await db.query(
        `INSERT INTO documents(id, workspace_id, media_asset_id, original_filename, mime_type, status, created_by)
         VALUES($1, $2, $3, $4, $5, 'QUEUED', $6)`,
        [
          documentId,
          w,
          asset.id,
          asset.original_filename,
          asset.mime_type,
          r.user.id,
        ],
      );

      await pdfProcessingQueue.add(
        "extract",
        {
          documentId,
          workspaceId: w,
          correlationId: r.requestId,
        },
        { jobId: documentId },
        db,
      );

      await audit(
        db,
        w,
        r.user.id,
        "DOCUMENT_CREATED",
        "document",
        documentId,
        asset.original_filename,
      );

      return {
        documentId,
        status: "QUEUED",
        filename: asset.original_filename,
      };
    });

    // Proactively start PDF extraction immediately
    if (queueBackend()==='bullmq') import("../pdf-processing.js")
      .then(({ processPDFDocument }) => processPDFDocument(documentId, w))
      .catch((err) => console.warn(`[PDF Immediate Trigger] For ${documentId}:`, err?.message || err));

    return result;
  }

  @WorkspaceRequired()
  @Get()
  async listDocuments(@Req() r: AuthedRequest) {
    const w = r.workspace.id;
    const res = await pool.query(
      `SELECT id, media_asset_id, original_filename, mime_type, status, page_count,
              failure_code, failure_message, created_at, processing_completed_at
       FROM documents WHERE workspace_id = $1 ORDER BY created_at DESC`,
      [w],
    );

    return { documents: res.rows };
  }

  @WorkspaceRequired()
  @Get(":documentId")
  async getDocument(@Req() r: AuthedRequest, @Param("documentId") documentId: string) {
    const w = r.workspace.id;
    const res = await pool.query(
      `SELECT id, media_asset_id, original_filename, mime_type, status, page_count,
              processing_version, failure_code, failure_message, created_at, media_extraction_status, media_extraction_message,
              processing_started_at, processing_completed_at
       FROM documents WHERE id = $1 AND workspace_id = $2`,
      [documentId, w],
    );

    if (!res.rowCount) {
      throw new NotFoundException("Document not found in this workspace.");
    }

    const doc = res.rows[0];

    // If document is QUEUED and not yet picked up by worker after 2s, trigger real processing
    if (doc.status === "QUEUED" && (Date.now() - new Date(doc.created_at).getTime()) > 2000) {
      if (queueBackend()==='bullmq') import("../pdf-processing.js")
        .then(({ processPDFDocument }) => processPDFDocument(documentId, w))
        .catch((err) => console.warn(`[PDF Direct Trigger] Failed for ${documentId}:`, err?.message || err));
    }

    return { document: doc };
  }

  @WorkspaceRequired()
  @Post(':documentId/source-media/extract')
  async extractSourceMedia(@Req() r: AuthedRequest, @Param('documentId') documentId: string) {
    assertPermission(r.workspace.role,'edit');
    const doc = await pool.query(`SELECT m.bucket,m.object_key FROM documents d JOIN media_assets m ON m.id=d.media_asset_id
      WHERE d.id=$1 AND d.workspace_id=$2 AND m.workspace_id=$2 AND m.deleted_at IS NULL AND m.status='COMPLETED'`,[documentId,r.workspace.id]);
    if (!doc.rowCount) throw new NotFoundException('Document not found in this workspace.');
    await audit(pool,r.workspace.id,r.user.id,'SOURCE_MEDIA_EXTRACTION_REQUESTED','document',documentId,'PDF source images');
    const {provider} = getStorageProvider();
    const pdf=await readSourcePDF(provider,doc.rows[0].bucket,doc.rows[0].object_key);
    const {persistDocumentImages}=await import('./source-media.service.js');
    await persistDocumentImages(documentId,r.workspace.id,pdf);
    return this.sourceMedia(r,documentId);
  }

  @WorkspaceRequired()
  @Get(':documentId/source-media/:sourceId/original')
  async sourceOriginal(@Req() r:AuthedRequest,@Param('documentId') documentId:string,@Param('sourceId') sourceId:string,@Res() response:any) {
    const result=await pool.query(`SELECT s.page_number,s.image_index,s.kind,m.checksum,p.bucket,p.object_key
      FROM document_source_media s JOIN documents d ON d.id=s.document_id AND d.workspace_id=s.workspace_id
      JOIN media_assets m ON m.id=s.media_asset_id AND m.workspace_id=s.workspace_id
      JOIN media_assets p ON p.id=d.media_asset_id AND p.workspace_id=d.workspace_id
      WHERE s.id=$1 AND s.document_id=$2 AND s.workspace_id=$3 AND m.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status='COMPLETED'`,[sourceId,documentId,r.workspace.id]);
    if(!result.rowCount)throw new NotFoundException('Source image not found in this workspace.');
    const source=result.rows[0],{provider}=getStorageProvider();
    const pdf=await readSourcePDF(provider,source.bucket,source.object_key);
    let original:Buffer|undefined;
    await extractSourceImages(pdf,async image=>{original=image.data;},{pageNumber:source.page_number,imageIndex:source.image_index,kind:source.kind,includeFiltered:true});
    if(!original || createHash('sha256').update(original).digest('hex')!==source.checksum)
      throw new BadRequestException('The source PDF/image changed. Re-extract images before using this source.');
    response.setHeader('Content-Type','image/png');response.setHeader('Cache-Control','private, no-store');
    response.setHeader('Content-Disposition',`attachment; filename="source-page-${source.page_number}.png"`);
    return response.send(original);
  }

  @WorkspaceRequired()
  @Get(":documentId/source-media")
  async sourceMedia(@Req() r: AuthedRequest, @Param('documentId') documentId: string) {
    const w = r.workspace.id;
    const doc = await pool.query(`SELECT d.media_extraction_status,d.media_extraction_message,d.media_extraction_summary,m.bucket,m.object_key
      FROM documents d JOIN media_assets m ON m.id=d.media_asset_id
      WHERE d.id=$1 AND d.workspace_id=$2 AND m.workspace_id=$2 AND m.deleted_at IS NULL`,[documentId,w]);
    if (!doc.rowCount) throw new NotFoundException('Document not found in this workspace.');
    const result = await pool.query(`SELECT s.id AS source_id,s.page_number,s.image_index,s.kind,m.id AS asset_id,m.original_filename,m.metadata,m.bucket,m.object_key,m.size_bytes,a.ocr_status,a.vision_status,a.error_message,a.lease_until
      FROM document_source_media s JOIN media_assets m ON m.id=s.media_asset_id
      LEFT JOIN source_media_analysis a ON a.media_asset_id=m.id AND a.workspace_id=m.workspace_id
      WHERE s.document_id=$1 AND s.workspace_id=$2 AND m.workspace_id=$2 AND m.deleted_at IS NULL AND m.status='COMPLETED'
      ORDER BY s.page_number,s.image_index LIMIT 200`,[documentId,w]);
    const {provider} = getStorageProvider();
    const assets = await Promise.all(result.rows.map(async row => {
      const meta = (typeof row.metadata === 'object' && row.metadata !== null) ? row.metadata : {};
      return {
        sourceId: row.source_id,
        assetId: row.asset_id,
        pageNumber: row.page_number,
        imageIndex: row.image_index,
        kind: row.kind,
        previewOnly: meta.originalStored === false,
        sizeBytes: Number(row.size_bytes),
        width: meta.width,
        height: meta.height,
        reuseEligibility: meta.reuseEligibility || 'UNREVIEWED',
        analysis:{ocrStatus:row.ocr_status||'PENDING',visionStatus:row.vision_status||'PENDING',error:row.error_message,processing:row.lease_until && new Date(row.lease_until).getTime()>Date.now()},
        url: await provider.getSignedDownloadUrl(row.bucket, row.object_key, 900),
      };
    }));
    return {visionAvailable:visionConfigured(),status:doc.rows[0].media_extraction_status,message:doc.rows[0].media_extraction_message,summary:doc.rows[0].media_extraction_summary,storage:await storageUsage(pool,w),
      sourceUrl:await provider.getSignedDownloadUrl(doc.rows[0].bucket,doc.rows[0].object_key,900),assets};
  }

  @WorkspaceRequired()
  @Get(":documentId/pages")
  async getDocumentPages(@Req() r: AuthedRequest, @Param("documentId") documentId: string) {
    const w = r.workspace.id;

    const docCheck = await pool.query(
      "SELECT id FROM documents WHERE id = $1 AND workspace_id = $2",
      [documentId, w],
    );
    if (!docCheck.rowCount) {
      throw new NotFoundException("Document not found in this workspace.");
    }

    const res = await pool.query(
      `SELECT id, page_number, clean_text, extraction_method, ocr_used, ocr_confidence, character_count
       FROM document_pages WHERE document_id = $1 AND workspace_id = $2 ORDER BY page_number ASC`,
      [documentId, w],
    );

    return { pages: res.rows };
  }

  @WorkspaceRequired()
  @Get(":documentId/pages/:pageNumber")
  async getDocumentPage(
    @Req() r: AuthedRequest,
    @Param("documentId") documentId: string,
    @Param("pageNumber") pageNumberStr: string,
  ) {
    const w = r.workspace.id;
    const pageNum = parseInt(pageNumberStr, 10);
    if (isNaN(pageNum) || pageNum < 1) {
      throw new BadRequestException("Invalid page number.");
    }

    const res = await pool.query(
      `SELECT id, page_number, raw_text, clean_text, extraction_method, ocr_used, ocr_confidence, character_count
       FROM document_pages WHERE document_id = $1 AND workspace_id = $2 AND page_number = $3`,
      [documentId, w, pageNum],
    );

    if (!res.rowCount) {
      throw new NotFoundException("Document page not found.");
    }

    return { page: res.rows[0] };
  }

  @WorkspaceRequired()
  @Get(":documentId/chunks")
  async getDocumentChunks(@Req() r: AuthedRequest, @Param("documentId") documentId: string) {
    const w = r.workspace.id;

    const docCheck = await pool.query(
      "SELECT id FROM documents WHERE id = $1 AND workspace_id = $2",
      [documentId, w],
    );
    if (!docCheck.rowCount) {
      throw new NotFoundException("Document not found in this workspace.");
    }

    const res = await pool.query(
      `SELECT id, chunk_index, page_start, page_end, content, character_count, token_count, content_hash
       FROM document_chunks WHERE document_id = $1 AND workspace_id = $2 ORDER BY chunk_index ASC`,
      [documentId, w],
    );

    return { chunks: res.rows };
  }

  @WorkspaceRequired()
  @Post(":documentId/reprocess")
  async reprocessDocument(@Req() r: AuthedRequest, @Param("documentId") documentId: string) {
    assertPermission(r.workspace.role, "edit");
    const w = r.workspace.id;

    const docRes = await pool.query(
      "SELECT id, original_filename FROM documents WHERE id = $1 AND workspace_id = $2",
      [documentId, w],
    );

    if (!docRes.rowCount) {
      throw new NotFoundException("Document not found in this workspace.");
    }

    const result = await transaction(async (db) => {
      await db.query(
        "UPDATE documents SET status = 'QUEUED', failure_code = NULL, failure_message = NULL, processing_version = processing_version + 1 WHERE id = $1 AND workspace_id = $2",
        [documentId, w],
      );

      await pdfProcessingQueue.add(
        "extract",
        {
          documentId,
          workspaceId: w,
          correlationId: r.requestId,
        },
        { jobId: `${documentId}-reprocess-${Date.now()}` },
        db,
      );

      await audit(
        db,
        w,
        r.user.id,
        "DOCUMENT_REPROCESS_REQUESTED",
        "document",
        documentId,
        docRes.rows[0].original_filename,
      );

      return { documentId, status: "QUEUED" };
    });

    // Proactively start reprocess immediately
    if (queueBackend()==='bullmq') import("../pdf-processing.js")
      .then(({ processPDFDocument }) => processPDFDocument(documentId, w))
      .catch((err) => console.warn(`[PDF Reprocess Trigger] For ${documentId}:`, err?.message || err));

    return result;
  }

  @WorkspaceRequired()
  @Post(":documentId/fast-track")
  async fastTrackDocument(@Req() r: AuthedRequest, @Param("documentId") documentId: string) {
    assertPermission(r.workspace.role, "edit");
    const w = r.workspace.id;

    const docRes = await pool.query(
      "SELECT id, original_filename, status FROM documents WHERE id = $1 AND workspace_id = $2",
      [documentId, w],
    );

    if (!docRes.rowCount) {
      throw new NotFoundException("Document not found in this workspace.");
    }

    try {
      const { processPDFDocument } = await import("../pdf-processing.js");
      const result = await processPDFDocument(documentId, w);
      return {
        documentId,
        status: "READY",
        pageCount: result.pageCount,
        chunkCount: result.chunkCount,
      };
    } catch (fastErr) {
      if (queueBackend() === 'postgres') {
        await pdfProcessingQueue.add('extract', { documentId, workspaceId: w }, { jobId: `${documentId}-fast-${Date.now()}` });
        return { documentId, status: 'QUEUED' };
      }
      throw fastErr;
    }
  }

  @WorkspaceRequired()
  @Delete(":documentId")
  async deleteDocument(@Req() r: AuthedRequest, @Param("documentId") documentId: string) {
    assertPermission(r.workspace.role, "edit");
    const w = r.workspace.id;

    const docRes = await pool.query(
      "SELECT id, original_filename FROM documents WHERE id = $1 AND workspace_id = $2",
      [documentId, w],
    );

    if (!docRes.rowCount) {
      throw new NotFoundException("Document not found in this workspace.");
    }

    return transaction(async (db) => {
      await db.query("DELETE FROM documents WHERE id = $1 AND workspace_id = $2", [
        documentId,
        w,
      ]);

      await audit(
        db,
        w,
        r.user.id,
        "DOCUMENT_DELETED",
        "document",
        documentId,
        docRes.rows[0].original_filename,
      );

      return { success: true, documentId };
    });
  }
}
