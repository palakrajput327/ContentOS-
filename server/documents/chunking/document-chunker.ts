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
  const isOcr = pages.some((p) => p.ocrUsed);
  const targetTokens = options?.targetTokens || Number(process.env.PDF_CHUNK_TARGET_TOKENS) || (isOcr ? 100 : 300);
  const overlapTokens = options?.overlapTokens || Number(process.env.PDF_CHUNK_OVERLAP_TOKENS) || (isOcr ? 20 : 50);

  const targetChars = targetTokens * 4;
  const overlapChars = overlapTokens * 4;

  const chunks: DocumentChunkResult[] = [];
  let chunkIndex = 0;

  // Filter pages that actually have content
  const contentPages = pages.filter((p) => p.cleanText && p.cleanText.trim().length > 0);

  if (isOcr) {
    // For OCR/scanned notes, preserve page boundary isolation so each sampled page creates its own targeted chunk(s)
    for (const page of contentPages) {
      const text = page.cleanText.trim();
      if (text.length < 15) continue;

      if (text.length <= targetChars * 1.5) {
        const contentHash = createHash("sha256").update(text).digest("hex");
        chunks.push({
          chunkIndex: chunkIndex++,
          pageStart: page.pageNumber,
          pageEnd: page.pageNumber,
          content: text,
          characterCount: text.length,
          tokenCount: estimateTokens(text),
          contentHash,
        });
      } else {
        const sentences = text.split(/(?<=[.!?\n])\s+/).filter(Boolean);
        let cur = "";
        for (const s of sentences) {
          cur += (cur ? " " : "") + s;
          if (cur.length >= targetChars) {
            const trimmed = cur.trim();
            chunks.push({
              chunkIndex: chunkIndex++,
              pageStart: page.pageNumber,
              pageEnd: page.pageNumber,
              content: trimmed,
              characterCount: trimmed.length,
              tokenCount: estimateTokens(trimmed),
              contentHash: createHash("sha256").update(trimmed).digest("hex"),
            });
            cur = trimmed.substring(Math.max(0, trimmed.length - overlapChars));
          }
        }
        if (cur.trim().length > 0) {
          const trimmed = cur.trim();
          chunks.push({
            chunkIndex: chunkIndex++,
            pageStart: page.pageNumber,
            pageEnd: page.pageNumber,
            content: trimmed,
            characterCount: trimmed.length,
            tokenCount: estimateTokens(trimmed),
            contentHash: createHash("sha256").update(trimmed).digest("hex"),
          });
        }
      }
    }
    return chunks;
  }

  // Standard continuous document chunking
  let currentChunkText = "";
  let currentStartPage = 0;
  let currentEndPage = 0;
  let lastSeenPage = -1;

  for (const page of contentPages) {
    if (lastSeenPage !== -1 && page.pageNumber > lastSeenPage + 1 && currentChunkText.trim().length > 0) {
      const content = currentChunkText.trim();
      chunks.push({
        chunkIndex: chunkIndex++,
        pageStart: currentStartPage,
        pageEnd: currentEndPage,
        content,
        characterCount: content.length,
        tokenCount: estimateTokens(content),
        contentHash: createHash("sha256").update(content).digest("hex"),
      });
      currentChunkText = "";
    }
    lastSeenPage = page.pageNumber;

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
          chunkIndex: chunkIndex++,
          pageStart: currentStartPage,
          pageEnd: currentEndPage,
          content,
          characterCount: content.length,
          tokenCount: estimateTokens(content),
          contentHash,
        });

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
      chunkIndex: chunkIndex++,
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
