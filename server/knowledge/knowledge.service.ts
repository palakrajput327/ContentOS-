import { randomUUID } from "node:crypto";
import { pool, transaction, audit } from "../db.js";
import { getLLMProvider } from "../ai/llm.service.js";
import { SYSTEM_KNOWLEDGE_EXTRACTION_PROMPT } from "./prompts.js";
import {
  ExtractedFact,
  KnowledgeExtractionOutput,
  knowledgeExtractionOutputSchema,
} from "./knowledge.types.js";

export class KnowledgeService {
  /**
   * Process asynchronous knowledge extraction for a queued document_knowledge generation
   */
  async processKnowledgeExtraction(
    generationId: string,
    documentId: string,
    workspaceId: string,
  ): Promise<void> {
    console.log(`[KnowledgeService] Starting extraction for generation ${generationId}, document ${documentId}`);

    // 1. Fetch document & chunks with workspace isolation
    const docRes = await pool.query(
      "SELECT id, original_filename, status FROM documents WHERE id = $1 AND workspace_id = $2",
      [documentId, workspaceId],
    );

    if (!docRes.rowCount) {
      throw new Error(`Document ${documentId} not found in workspace ${workspaceId}`);
    }

    const doc = docRes.rows[0];
    if (doc.status !== "READY") {
      throw new Error(`Document ${documentId} is not in READY status (current: ${doc.status})`);
    }

    const chunksRes = await pool.query(
      "SELECT id, chunk_index, page_start, page_end, content, token_count FROM document_chunks WHERE document_id = $1 AND workspace_id = $2 ORDER BY chunk_index ASC",
      [documentId, workspaceId],
    );

    let currentChunks = chunksRes.rows;
    if (!currentChunks.length) {
      console.log(`[KnowledgeService] Document ${documentId} has no extracted chunks. Running PDF extraction now...`);
      const { processPDFDocument } = await import("../pdf-worker.js");
      await processPDFDocument(documentId, workspaceId);
      const refetched = await pool.query(
        "SELECT id, chunk_index, page_start, page_end, content, token_count FROM document_chunks WHERE document_id = $1 AND workspace_id = $2 ORDER BY chunk_index ASC",
        [documentId, workspaceId],
      );
      currentChunks = refetched.rows;
    }

    if (!currentChunks.length) {
      console.warn(`[KnowledgeService] Document ${documentId} still has no extracted chunks.`);
      await pool.query(
        "UPDATE ai_generations SET status = 'COMPLETED', completed_at = NOW(), metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{chunkCount}', '0') WHERE id = $1",
        [generationId],
      );
      return;
    }

    const chunksMap = new Map<string, any>(currentChunks.map((c) => [c.id, c]));

    // Mark generation as PROCESSING atomically to avoid duplicate concurrent extraction
    const genLock = await pool.query(
      "UPDATE ai_generations SET status = 'PROCESSING', started_at = NOW() WHERE id = $1 AND status = 'QUEUED' RETURNING id",
      [generationId],
    );
    if (!genLock.rowCount) {
      const existing = await pool.query("SELECT status FROM ai_generations WHERE id = $1", [generationId]);
      if (existing.rows[0]?.status === "COMPLETED" || existing.rows[0]?.status === "PROCESSING") {
        console.log(`[KnowledgeService] Generation ${generationId} already in status: ${existing.rows[0]?.status}`);
        return;
      }
    }

    try {
      // 2. Batch Chunks (3-5 chunks per LLM prompt, ~1500 tokens max batch)
      const chunkBatches: any[][] = [];
      let currentBatch: any[] = [];
      let currentTokens = 0;

      for (const chunk of currentChunks) {
        if (currentBatch.length >= 3 || currentTokens + chunk.token_count > 1200) {
          if (currentBatch.length > 0) chunkBatches.push(currentBatch);
          currentBatch = [chunk];
          currentTokens = chunk.token_count;
        } else {
          currentBatch.push(chunk);
          currentTokens += chunk.token_count;
        }
      }
      if (currentBatch.length > 0) chunkBatches.push(currentBatch);

      const provider = getLLMProvider();
      const allExtractedFacts: ExtractedFact[] = [];
      const batchProviders: { provider: string; model: string }[] = [];
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;

      // 3. Execute Structured LLM Extraction over Batches
      for (let bIdx = 0; bIdx < chunkBatches.length; bIdx++) {
        const batch = chunkBatches[bIdx];
        if (bIdx > 0) {
          // Pacing to prevent OTPM/RPM spikes on free tier providers
          await new Promise((r) => setTimeout(r, 1200));
        }
        const batchContext = batch.map((c) => ({
          chunkId: c.id,
          pageStart: c.page_start,
          pageEnd: c.page_end,
          text: c.content,
        }));

        const result = await provider.generateStructured<KnowledgeExtractionOutput>({
          messages: [
            { role: "system", content: SYSTEM_KNOWLEDGE_EXTRACTION_PROMPT },
            { role: "user", content: `Extract 2 to 4 key concepts, programming principles, and technical insights for EACH chunk in this batch (covering all topics such as syntax, arrays, memory allocation, pointers, and structures):\n${JSON.stringify(batchContext, null, 2)}` },
          ],
          schema: knowledgeExtractionOutputSchema as any,
          schemaName: "DocumentKnowledgeExtraction",
        });

        batchProviders.push({ provider: result.provider || "mock", model: result.model || "mock" });
        if (result.usage) {
          totalPromptTokens += result.usage.promptTokens;
          totalCompletionTokens += result.usage.completionTokens;
        }

        if (result.data?.facts) {
          for (const fact of result.data.facts) {
            const valid = (fact.supportingChunkIds || []).filter((cid) => chunksMap.has(cid));
            fact.supportingChunkIds = valid.length > 0 ? valid : (batch[0] ? [batch[0].id] : []);
            allExtractedFacts.push(fact);

            // Real-time incremental persistence so client polls see facts immediately
            try {
              const primaryChunk = chunksMap.get(fact.supportingChunkIds[0]) || batch[0];
              const pageStart = primaryChunk?.page_start || 1;
              const pageEnd = primaryChunk?.page_end || pageStart;
              const sourceExcerpt = primaryChunk ? primaryChunk.content.substring(0, 500) : "";

              await pool.query(
                `INSERT INTO document_knowledge(
                  id, workspace_id, document_id, generation_id, knowledge_type,
                  knowledge_key, value, page_start, page_end, source_excerpt, confidence, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'EXTRACTED')
                ON CONFLICT DO NOTHING`,
                [
                  randomUUID(),
                  workspaceId,
                  documentId,
                  generationId,
                  fact.type,
                  fact.key,
                  JSON.stringify(fact.value),
                  pageStart,
                  pageEnd,
                  sourceExcerpt,
                  fact.confidence ?? 0.9,
                ],
              );
            } catch (err) {
              console.warn("[KnowledgeService] Realtime fact insert notice:", err);
            }
          }
          console.log(`[KnowledgeService] Realtime streamed ${result.data.facts.length} facts (total so far: ${allExtractedFacts.length})`);
        }
      }

      // 4. Fallback if LLM extraction returned 0 facts
      if (allExtractedFacts.length === 0 && currentChunks.length > 0) {
        console.log(`[KnowledgeService] Generating fallback insights from chunk text directly...`);
        for (let i = 0; i < Math.min(currentChunks.length, 4); i++) {
          const c = currentChunks[i];
          const lines = c.content.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 15);
          const claimText = lines[0] || c.content.substring(0, 150);
          await pool.query(
            `INSERT INTO document_knowledge(
              id, workspace_id, document_id, generation_id, knowledge_type,
              knowledge_key, value, page_start, page_end, source_excerpt, confidence, status
            ) VALUES ($1, $2, $3, $4, 'INSIGHT', $5, $6, $7, $8, $9, 0.85, 'EXTRACTED')
            ON CONFLICT DO NOTHING`,
            [
              randomUUID(),
              workspaceId,
              documentId,
              generationId,
              `Technical Concept ${i + 1}`,
              JSON.stringify(claimText),
              c.page_start,
              c.page_end,
              c.content.substring(0, 500),
            ],
          );
        }
      }

          // Mark generation as COMPLETED
      const totalFactsRes = await pool.query(
        "SELECT COUNT(1) FROM document_knowledge WHERE generation_id = $1",
        [generationId],
      );
      const factCount = parseInt(totalFactsRes.rows[0]?.count || "0", 10);

      const meta = {
        factCount,
        chunkCount: currentChunks.length,
        batchCount: chunkBatches.length,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens: totalPromptTokens + totalCompletionTokens,
        batchProviders,
      };

      await pool.query(
        `UPDATE ai_generations
         SET status = 'COMPLETED', completed_at = NOW(),
             output = $1,
             metadata = $2::jsonb,
             provider = $3,
             model = $4
         WHERE id = $5`,
        [
          JSON.stringify({ factCount }),
          JSON.stringify(meta),
          [...new Set(batchProviders.map((p) => p.provider))].join(",") || "groq",
          [...new Set(batchProviders.map((p) => p.model))].join(",") || "openai/gpt-oss-20b",
          generationId,
        ],
      );

      // Ensure document status is set to READY
      await pool.query(
        "UPDATE documents SET status = 'READY', processing_completed_at = NOW() WHERE id = $1",
        [documentId],
      );

      await audit(
        pool,
        workspaceId,
        null,
        "KNOWLEDGE_EXTRACTION_COMPLETED",
        "ai_generation",
        generationId,
        doc.original_filename,
        null,
        { factCount },
      );

      console.log(`[KnowledgeService] Successfully extracted ${factCount} facts for document ${documentId}`);
    } catch (err: any) {
      console.error(`[KnowledgeService] Extraction failed for generation ${generationId}:`, err);
      const errMsg = err?.message || "Knowledge extraction failed";

      await pool.query(
        `UPDATE ai_generations
         SET status = 'FAILED', error_code = 'EXTRACTION_ERROR', error_message = $1, completed_at = NOW()
         WHERE id = $2`,
        [errMsg.substring(0, 500), generationId],
      );

      await audit(
        pool,
        workspaceId,
        null,
        "KNOWLEDGE_EXTRACTION_FAILED",
        "ai_generation",
        generationId,
        doc.original_filename,
        null,
        { error: errMsg },
      );

      throw err;
    }
  }
}
