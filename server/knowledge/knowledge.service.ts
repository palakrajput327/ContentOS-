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

    if (!chunksRes.rowCount) {
      console.warn(`[KnowledgeService] Document ${documentId} has no extracted chunks.`);
      await pool.query(
        "UPDATE ai_generations SET status = 'COMPLETED', completed_at = NOW(), metadata = jsonb_set(metadata, '{chunkCount}', '0') WHERE id = $1",
        [generationId],
      );
      return;
    }

    const chunksMap = new Map<string, any>(chunksRes.rows.map((c) => [c.id, c]));

    // Mark generation as PROCESSING
    await pool.query(
      "UPDATE ai_generations SET status = 'PROCESSING', started_at = NOW() WHERE id = $1",
      [generationId],
    );

    try {
      // 2. Batch Chunks (3-5 chunks per LLM prompt, ~1500 tokens max batch)
      const chunkBatches: any[][] = [];
      let currentBatch: any[] = [];
      let currentTokens = 0;

      for (const chunk of chunksRes.rows) {
        if (currentBatch.length >= 5 || currentTokens + chunk.token_count > 1500) {
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
      for (const batch of chunkBatches) {
        const batchContext = batch.map((c) => ({
          chunkId: c.id,
          pageStart: c.page_start,
          pageEnd: c.page_end,
          text: c.content,
        }));

        const result = await provider.generateStructured<KnowledgeExtractionOutput>({
          messages: [
            { role: "system", content: SYSTEM_KNOWLEDGE_EXTRACTION_PROMPT },
            { role: "user", content: `Extract factual business knowledge from these document chunks:\n${JSON.stringify(batchContext, null, 2)}` },
          ],
          schema: knowledgeExtractionOutputSchema,
          schemaName: "DocumentKnowledgeExtraction",
        });

        batchProviders.push({ provider: result.provider || "mock", model: result.model || "mock" });
        if (result.usage) {
          totalPromptTokens += result.usage.promptTokens;
          totalCompletionTokens += result.usage.completionTokens;
        }

        if (result.data?.facts) {
          allExtractedFacts.push(...result.data.facts);
        }
      }

      // 4. Deduplicate Facts (Key: type + normalized key)
      const deduplicatedMap = new Map<string, ExtractedFact>();
      for (const fact of allExtractedFacts) {
        const normKey = `${fact.type}:${fact.key.toLowerCase().trim()}`;
        if (!deduplicatedMap.has(normKey)) {
          deduplicatedMap.set(normKey, fact);
        } else {
          // Merge supporting chunk IDs
          const existing = deduplicatedMap.get(normKey)!;
          const mergedChunks = Array.from(new Set([...existing.supportingChunkIds, ...fact.supportingChunkIds]));
          deduplicatedMap.set(normKey, { ...existing, supportingChunkIds: mergedChunks });
        }
      }

      const finalFacts = Array.from(deduplicatedMap.values());

      // 5. Persist Knowledge & Citation Evidence in DB Transaction
      await transaction(async (db) => {
        for (const fact of finalFacts) {
          // Validate chunk IDs against authoritative DB chunks map
          const validChunkIds = fact.supportingChunkIds.filter((cid) => chunksMap.has(cid));
          if (validChunkIds.length === 0) {
            console.warn(`[KnowledgeService] Fact '${fact.key}' returned no valid chunk IDs. Skipping persistence.`);
            continue;
          }

          // Authoritative page bounds derived from backend DB chunks
          const primaryChunk = chunksMap.get(validChunkIds[0])!;
          const pageStart = primaryChunk.page_start;
          const pageEnd = primaryChunk.page_end;
          const sourceExcerpt = primaryChunk.content.substring(0, 500);

          const knowledgeId = randomUUID();
          await db.query(
            `INSERT INTO document_knowledge(
              id, workspace_id, document_id, generation_id, knowledge_type,
              knowledge_key, value, page_start, page_end, source_excerpt, confidence, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'EXTRACTED')`,
            [
              knowledgeId,
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

          // Save Citation Sources
          for (const chunkId of validChunkIds) {
            const chunkObj = chunksMap.get(chunkId)!;
            await db.query(
              `INSERT INTO ai_generation_sources(
                id, workspace_id, generation_id, document_id, document_chunk_id,
                page_start, page_end, source_excerpt, claim_key, confidence
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [
                randomUUID(),
                workspaceId,
                generationId,
                documentId,
                chunkId,
                chunkObj.page_start,
                chunkObj.page_end,
                chunkObj.content.substring(0, 500),
                fact.key,
                fact.confidence ?? 0.9,
              ],
            );
          }
        }

        // Mark generation as COMPLETED
        await db.query(
          `UPDATE ai_generations
           SET status = 'COMPLETED', completed_at = NOW(),
               provider = $10, model = $11,
               output = $1,
               metadata = jsonb_build_object(
                 'factCount', $2,
                 'chunkCount', $3,
                 'batchCount', $4,
                 'promptTokens', $5,
                 'completionTokens', $6,
                 'totalTokens', $7,
                 'batchProviders', $9::jsonb
               )
           WHERE id = $8`,
          [
            JSON.stringify({ factCount: finalFacts.length }),
            finalFacts.length,
            chunksRes.rowCount,
            chunkBatches.length,
            totalPromptTokens,
            totalCompletionTokens,
            totalPromptTokens + totalCompletionTokens,
            generationId,
            JSON.stringify(batchProviders),
            [...new Set(batchProviders.map(p => p.provider))].join(","),
            [...new Set(batchProviders.map(p => p.model))].join(","),
          ],
        );

        await audit(
          db,
          workspaceId,
          null,
          "KNOWLEDGE_EXTRACTION_COMPLETED",
          "ai_generation",
          generationId,
          doc.original_filename,
          null,
          { factCount: finalFacts.length },
        );
      });

      console.log(`[KnowledgeService] Successfully extracted ${finalFacts.length} facts for document ${documentId}`);
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
