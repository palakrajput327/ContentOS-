import { createHash } from "node:crypto";
import { DocumentChunkResult, DocumentPageResult } from "../documents.types.js";

export interface ChunkerOptions {
  targetTokens?: number; // Approximate ~300 words target
  overlapTokens?: number; // Approximate ~50 words overlap
}

// Deterministic token approximation: 1 token ≈ 4 characters (standard OpenAI/LLM heuristic)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkDocumentPages(
  pages: DocumentPageResult[],
  options?: ChunkerOptions,
): DocumentChunkResult[] {
  const targetTokens = options?.targetTokens || Number(process.env.PDF_CHUNK_TARGET_TOKENS) || 300;
  const overlapTokens = options?.overlapTokens || Number(process.env.PDF_CHUNK_OVERLAP_TOKENS) || 50;

  const targetChars = targetTokens * 4;
  const overlapChars = overlapTokens * 4;

  const chunks: DocumentChunkResult[] = [];
  let currentChunkText = "";
  let currentStartPage = 0;
  let currentEndPage = 0;
  let chunkIndex = 0;

  for (const page of pages) {
    if (!page.cleanText || page.cleanText.trim().length === 0) {
      continue;
    }

    const sentences = page.cleanText.split(/(?<=[.!?])\s+/);

    for (const sentence of sentences) {
      if (!sentence.trim()) continue;

      if (currentChunkText.length === 0) {
        currentStartPage = page.pageNumber;
      }

      currentEndPage = page.pageNumber;
      currentChunkText += (currentChunkText ? " " : "") + sentence;

      if (currentChunkText.length >= targetChars) {
        const content = currentChunkText.trim();
        const contentHash = createHash("sha256").update(content).digest("hex");

        chunks.push({
          chunkIndex,
          pageStart: currentStartPage,
          pageEnd: currentEndPage,
          content,
          characterCount: content.length,
          tokenCount: estimateTokens(content),
          contentHash,
        });

        chunkIndex++;

        // Keep trailing overlap text for continuity
        const overlapText = content.substring(Math.max(0, content.length - overlapChars));
        currentChunkText = overlapText;
        currentStartPage = currentEndPage;
      }
    }
  }

  // Handle remaining trailing chunk
  if (currentChunkText.trim().length > 0) {
    const content = currentChunkText.trim();
    const contentHash = createHash("sha256").update(content).digest("hex");

    chunks.push({
      chunkIndex,
      pageStart: currentStartPage,
      pageEnd: currentEndPage,
      content,
      characterCount: content.length,
      tokenCount: estimateTokens(content),
      contentHash,
    });
  }

  return chunks;
}
