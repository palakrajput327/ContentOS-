import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction, audit } from "../db.js";
import { WorkspaceRequired, assertPermission, type AuthedRequest } from "../security.js";
import { Queue } from "bullmq";
import { redis } from "../queues.js";

const contentGenQueue = new Queue("content-generation", {
  connection: redis,
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

@Controller()
export class KnowledgeController {
  @WorkspaceRequired()
  @Post("api/v1/documents/:documentId/knowledge/extract")
  async triggerExtraction(@Req() r: AuthedRequest, @Param("documentId") documentId: string) {
    assertPermission(r.workspace.role, "edit");
    const w = r.workspace.id;

    // Verify document exists and is READY
    const docRes = await pool.query(
      "SELECT id, original_filename, status FROM documents WHERE id = $1 AND workspace_id = $2",
      [documentId, w],
    );

    if (!docRes.rowCount) {
      throw new NotFoundException("Document not found in this workspace.");
    }

    const doc = docRes.rows[0];
    if (doc.status !== "READY") {
      throw new BadRequestException(`Document must be in READY status before knowledge extraction (current: ${doc.status}).`);
    }

    const generationId = randomUUID();

    return transaction(async (db) => {
      await db.query(
        `INSERT INTO ai_generations(
          id, workspace_id, actor_id, provider, generation_type, status, input
        ) VALUES ($1, $2, $3, $4, 'DOCUMENT_KNOWLEDGE', 'QUEUED', $5)`,
        [
          generationId,
          w,
          r.user.id,
          process.env.LLM_PROVIDER || "openai-compatible",
          JSON.stringify({ documentId }),
        ],
      );

      await contentGenQueue.add(
        "extract-knowledge",
        {
          generationId,
          documentId,
          workspaceId: w,
          actorId: r.user.id,
          correlationId: r.requestId,
        },
        { jobId: generationId },
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
  }

  @WorkspaceRequired()
  @Get("api/v1/documents/:documentId/knowledge")
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
              page_start, page_end, source_excerpt, confidence, status, created_at, updated_at
       FROM document_knowledge
       WHERE document_id = $1 AND workspace_id = $2
       ORDER BY created_at DESC`,
      [documentId, w],
    );

    return { knowledge: res.rows };
  }

  @WorkspaceRequired()
  @Get("api/v1/documents/:documentId/knowledge/:knowledgeId")
  async getKnowledgeItem(
    @Req() r: AuthedRequest,
    @Param("documentId") documentId: string,
    @Param("knowledgeId") knowledgeId: string,
  ) {
    const w = r.workspace.id;

    const res = await pool.query(
      `SELECT id, generation_id, knowledge_type, knowledge_key, value,
              page_start, page_end, source_excerpt, confidence, status, created_at, updated_at
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
  @Get("api/v1/documents/:documentId/knowledge/:knowledgeId/sources")
  async getKnowledgeSources(
    @Req() r: AuthedRequest,
    @Param("documentId") documentId: string,
    @Param("knowledgeId") knowledgeId: string,
  ) {
    const w = r.workspace.id;

    const kRes = await pool.query(
      "SELECT generation_id, knowledge_key FROM document_knowledge WHERE id = $1 AND document_id = $2 AND workspace_id = $3",
      [knowledgeId, documentId, w],
    );

    if (!kRes.rowCount) {
      throw new NotFoundException("Knowledge item not found.");
    }

    const { generation_id, knowledge_key } = kRes.rows[0];

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
  @Get("api/v1/ai/generations/:generationId")
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
  @Patch("api/v1/documents/:documentId/knowledge/:knowledgeId")
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
      "SELECT id, knowledge_key, status FROM document_knowledge WHERE id = $1 AND document_id = $2 AND workspace_id = $3",
      [knowledgeId, documentId, w],
    );

    if (!itemRes.rowCount) {
      throw new NotFoundException("Knowledge item not found.");
    }

    const current = itemRes.rows[0];
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
}
