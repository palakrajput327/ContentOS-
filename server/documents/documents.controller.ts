import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, pool, transaction } from "../db.js";
import { assertPermission, WorkspaceRequired, type AuthedRequest } from "../security.js";
import { Queue } from "bullmq";
import { redis } from "../queues.js";

const pdfProcessingQueue = new Queue("pdf-processing", {
  connection: redis,
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

    return transaction(async (db) => {
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
              processing_version, failure_code, failure_message, created_at,
              processing_started_at, processing_completed_at
       FROM documents WHERE id = $1 AND workspace_id = $2`,
      [documentId, w],
    );

    if (!res.rowCount) {
      throw new NotFoundException("Document not found in this workspace.");
    }

    return { document: res.rows[0] };
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

    return transaction(async (db) => {
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
  }

  @WorkspaceRequired()
  @Delete(":documentId")
  async deleteDocument(@Req() r: AuthedRequest, @Param("documentId") documentId: string) {
    assertPermission(r.workspace.role, "manage");
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
