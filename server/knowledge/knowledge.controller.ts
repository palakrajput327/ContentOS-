import { queueBackend } from '../queue-backend.js';
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Delete,
  Req,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction, audit } from "../db.js";
import { WorkspaceRequired, assertPermission, type AuthedRequest } from "../security.js";
import { createQueue } from '../queues.js';
import { KnowledgeService } from "./knowledge.service.js";
import {sourceReference} from '../documents/source-original.js';

const knowledgeService = new KnowledgeService();

const contentGenQueue = createQueue("content-generation", {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 10000 },
    removeOnComplete: { age: 7 * 86400 },
    removeOnFail: { age: 30 * 86400 },
  },
});

export const updateKnowledgeStatusSchema = z.object({
  status: z.enum(["EXTRACTED", "CONFIRMED", "EDITED", "REJECTED", "LOCKED"]),
  value: z.any().optional(),
});

@Controller("documents")
export class KnowledgeController {
  @WorkspaceRequired()
  @Post(":documentId/knowledge/extract")
  async triggerExtraction(@Req() r: AuthedRequest, @Param("documentId") documentId: string) {
    assertPermission(r.workspace.role, "edit");
    const w = r.workspace.id;

    // Verify document exists and is READY
    const docRes = await pool.query(
      "SELECT id, original_filename, status, page_count FROM documents WHERE id = $1 AND workspace_id = $2",
      [documentId, w],
    );

    if (!docRes.rowCount) {
      throw new NotFoundException("Document not found in this workspace.");
    }

    const doc = docRes.rows[0];
    if (doc.status === "QUEUED" || doc.status === "PROCESSING" || doc.status === "EXTRACTING" || doc.status === "CHUNKING") {
      // Proactively start PDF extraction in case worker had queue delay
      if (queueBackend()==='bullmq') import("../pdf-processing.js")
        .then(({ processPDFDocument }) => processPDFDocument(documentId, w))
        .catch((err) => console.warn(`[Knowledge Trigger PDF] Warning for ${documentId}:`, err?.message || err));

      return {
        generationId: "in_progress",
        documentId,
        status: doc.status,
        message: "Document text extraction is currently in progress. Knowledge extraction will run automatically upon completion.",
      };
    }
    if (doc.status !== "READY") {
      throw new BadRequestException(`Document status is ${doc.status}. Please wait or re-process the document.`);
    }

    // Verify document has chunks; if not (or if an old run produced <= 2 chunks on a multi-page PDF), re-extract chunks
    const chunkCheck = await pool.query(
      "SELECT COUNT(*) FROM document_chunks WHERE document_id = $1 AND workspace_id = $2",
      [documentId, w],
    );
    const chunkCount = parseInt(chunkCheck.rows[0]?.count || "0", 10);
    const forcePdf=chunkCount === 0 || (doc.page_count > 5 && chunkCount <= 2);
    if (forcePdf && queueBackend()==='bullmq') {
      console.log(`[KnowledgeController] Document ${documentId} (pages: ${doc.page_count}) has ${chunkCount} chunks. Running processPDFDocument...`);
      const { processPDFDocument } = await import("../pdf-processing.js");
      await processPDFDocument(documentId, w, { force: true });
    }

    // Clean up previously extracted knowledge so new comprehensive set populates cleanly
    await pool.query("DELETE FROM document_knowledge WHERE document_id = $1 AND workspace_id=$2 AND status = 'EXTRACTED' AND COALESCE(metadata->>'origin','')<>'SOURCE_VISUAL'", [documentId,w]);

    const generationId = randomUUID();

    const result = await transaction(async (db) => {
      await db.query(
        `INSERT INTO ai_generations(
          id, workspace_id, actor_id, provider, generation_type, status, input, output
        ) VALUES ($1, $2, $3, $4, 'DOCUMENT_KNOWLEDGE', 'QUEUED', $5, '{}')`,
        [
          generationId,
          w,
          r.user.id,
          process.env.LLM_PROVIDER || "groq",
          JSON.stringify({ documentId }),
        ],
      );

      await contentGenQueue.add(
        "extract-knowledge",
        {
          generationId,
          documentId,
          forcePdf,
          workspaceId: w,
          actorId: r.user.id,
          correlationId: r.requestId,
        },
        { jobId: generationId },
        db,
      );

      await audit(
        db,
        w,
        r.user.id,
        "KNOWLEDGE_EXTRACTION_REQUESTED",
        "document",
        documentId,
        doc.original_filename,
      );

      return {
        generationId,
        documentId,
        status: "QUEUED",
      };
    });

    // Proactively start knowledge extraction immediately
    knowledgeService
      .processKnowledgeExtraction(generationId, documentId, w)
      .catch((err) => console.warn(`[Knowledge Direct Trigger] For ${documentId}:`, err?.message || err));

    return result;
  }

  @WorkspaceRequired()
  @Get(":documentId/knowledge")
  async listDocumentKnowledge(@Req() r: AuthedRequest, @Param("documentId") documentId: string) {
    const w = r.workspace.id;

    const docCheck = await pool.query(
      "SELECT id FROM documents WHERE id = $1 AND workspace_id = $2",
      [documentId, w],
    );
    if (!docCheck.rowCount) {
      throw new NotFoundException("Document not found in this workspace.");
    }

    const res = await pool.query(
      `SELECT id, generation_id, knowledge_type, knowledge_key, value,
              page_start, page_end, source_excerpt, confidence, status, metadata, created_at, updated_at
       FROM document_knowledge
       WHERE document_id = $1 AND workspace_id = $2
       ORDER BY created_at DESC`,
      [documentId, w],
    );

    return { knowledge: res.rows };
  }

  @WorkspaceRequired()
  @Get(":documentId/knowledge/:knowledgeId")
  async getKnowledgeItem(
    @Req() r: AuthedRequest,
    @Param("documentId") documentId: string,
    @Param("knowledgeId") knowledgeId: string,
  ) {
    const w = r.workspace.id;

    const res = await pool.query(
      `SELECT id, generation_id, knowledge_type, knowledge_key, value,
              page_start, page_end, source_excerpt, confidence, status, metadata, created_at, updated_at
       FROM document_knowledge
       WHERE id = $1 AND document_id = $2 AND workspace_id = $3`,
      [knowledgeId, documentId, w],
    );

    if (!res.rowCount) {
      throw new NotFoundException("Knowledge item not found.");
    }

    return { item: res.rows[0] };
  }

  @WorkspaceRequired()
  @Get(":documentId/knowledge/:knowledgeId/sources")
  async getKnowledgeSources(
    @Req() r: AuthedRequest,
    @Param("documentId") documentId: string,
    @Param("knowledgeId") knowledgeId: string,
  ) {
    const w = r.workspace.id;

    const kRes = await pool.query(
      "SELECT generation_id, knowledge_key,metadata,page_start,page_end,source_excerpt FROM document_knowledge WHERE id = $1 AND document_id = $2 AND workspace_id = $3",
      [knowledgeId, documentId, w],
    );

    if (!kRes.rowCount) {
      throw new NotFoundException("Knowledge item not found.");
    }

    const { generation_id, knowledge_key } = kRes.rows[0];
    if(kRes.rows[0].metadata?.origin==='SOURCE_VISUAL') {
      const item=kRes.rows[0];await sourceReference(pool,w,documentId,item.metadata.sourceReferenceId);
      return {sources:[{document_id:documentId,page_start:item.page_start,page_end:item.page_end,source_excerpt:item.source_excerpt,metadata:item.metadata}]};
    }

    const sourcesRes = await pool.query(
      `SELECT s.id, s.generation_id, s.document_id, s.document_chunk_id,
              s.page_start, s.page_end, s.source_excerpt, s.claim_key, s.confidence, s.created_at
       FROM ai_generation_sources s
       WHERE s.generation_id = $1 AND s.workspace_id = $2 AND s.claim_key = $3
       ORDER BY s.page_start ASC`,
      [generation_id, w, knowledge_key],
    );

    return { sources: sourcesRes.rows };
  }

  @WorkspaceRequired()
  @Get("generations/:generationId")
  async getAIGeneration(@Req() r: AuthedRequest, @Param("generationId") generationId: string) {
    const w = r.workspace.id;

    const res = await pool.query(
      `SELECT id, generation_type, provider, model, status,
              started_at, completed_at, error_code, error_message, metadata, created_at
       FROM ai_generations
       WHERE id = $1 AND workspace_id = $2`,
      [generationId, w],
    );

    if (!res.rowCount) {
      throw new NotFoundException("AI Generation record not found.");
    }

    return { generation: res.rows[0] };
  }

  @WorkspaceRequired()
  @Patch(":documentId/knowledge/:knowledgeId")
  async updateKnowledgeItem(
    @Req() r: AuthedRequest,
    @Param("documentId") documentId: string,
    @Param("knowledgeId") knowledgeId: string,
    @Body() input: unknown,
  ) {
    assertPermission(r.workspace.role, "edit");
    const v = updateKnowledgeStatusSchema.parse(input);
    const w = r.workspace.id;

    const itemRes = await pool.query(
      "SELECT id, knowledge_key, status,metadata FROM document_knowledge WHERE id = $1 AND document_id = $2 AND workspace_id = $3",
      [knowledgeId, documentId, w],
    );

    if (!itemRes.rowCount) {
      throw new NotFoundException("Knowledge item not found.");
    }

    const current = itemRes.rows[0];
    if(current.metadata?.origin==='SOURCE_VISUAL' && ['CONFIRMED','LOCKED'].includes(v.status)) {
      const source=await sourceReference(pool,w,documentId,current.metadata.sourceReferenceId);
      if(source.media_asset_id!==current.metadata.sourceMediaAssetId || source.checksum!==current.metadata.originalChecksum)throw new BadRequestException('The visual source changed. Re-analyze and review its latest evidence.');
    }
    if (current.status === "LOCKED" && r.workspace.role !== "Owner" && r.workspace.role !== "Admin") {
      throw new BadRequestException("Only Workspace Owner or Admin can modify a LOCKED knowledge item.");
    }

    return transaction(async (db) => {
      const updateRes = await db.query(
        `UPDATE document_knowledge
         SET status = $1,
             value = COALESCE($2, value),
             updated_at = NOW()
         WHERE id = $3 AND workspace_id = $4
         RETURNING id, knowledge_type, knowledge_key, value, status, updated_at`,
        [v.status, v.value !== undefined ? JSON.stringify(v.value) : null, knowledgeId, w],
      );

      await audit(
        db,
        w,
        r.user.id,
        `KNOWLEDGE_${v.status}`,
        "document_knowledge",
        knowledgeId,
        current.knowledge_key,
      );

      return { item: updateRes.rows[0] };
    });
  }

  @WorkspaceRequired()
  @Delete(":documentId/knowledge/:knowledgeId")
  async deleteKnowledgeItem(
    @Req() r: AuthedRequest,
    @Param("documentId") documentId: string,
    @Param("knowledgeId") knowledgeId: string,
  ) {
    const w = r.workspace.id;
    assertPermission(r.workspace.role, "edit");
    await pool.query(
      "DELETE FROM document_knowledge WHERE id = $1 AND document_id = $2 AND workspace_id = $3",
      [knowledgeId, documentId, w],
    );
    return { ok: true, deletedId: knowledgeId };
  }

  @WorkspaceRequired()
  @Delete(":documentId/knowledge")
  async clearAllKnowledge(
    @Req() r: AuthedRequest,
    @Param("documentId") documentId: string,
  ) {
    const w = r.workspace.id;
    assertPermission(r.workspace.role, "edit");
    await pool.query(
      "DELETE FROM document_knowledge WHERE document_id = $1 AND workspace_id = $2",
      [documentId, w],
    );
    return { ok: true };
  }
}
