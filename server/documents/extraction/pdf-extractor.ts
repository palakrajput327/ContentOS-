import { createRequire } from "node:module";
import { DocumentPageResult } from "../documents.types.js";
import { normalizeText } from "./text-normalizer.js";

const require = createRequire(import.meta.url);

export interface PDFExtractionOptions {
  maxPages?: number;
}

export async function extractPDFPages(
  buffer: Buffer,
  options?: PDFExtractionOptions,
): Promise<{ pageCount: number; pages: DocumentPageResult[] }> {
  const maxPages = options?.maxPages || Number(process.env.PDF_MAX_PAGES) || 500;

  // require("pdf-parse") in ESM environment resolves to a module namespace or main function
  const rawPdfParse = require("pdf-parse");
  const pdfParse = typeof rawPdfParse === "function" ? rawPdfParse : rawPdfParse.default || rawPdfParse.pdfParse;

  if (typeof pdfParse !== "function") {
    // Fallback: simple text buffer decoder if pdfParse parser is unavailable
    const rawText = buffer.toString("utf-8");
    const clean = normalizeText(rawText);
    return {
      pageCount: 1,
      pages: [
        {
          pageNumber: 1,
          rawText,
          cleanText: clean,
          characterCount: clean.length,
          extractionMethod: "text-fallback",
          ocrUsed: false,
        },
      ],
    };
  }

  const data = await pdfParse(buffer, { max: maxPages });
  const pageCount = data.numpages || 1;

  if (pageCount > maxPages) {
    throw new Error(`PDF exceeds maximum allowed page limit of ${maxPages} pages.`);
  }

  const rawPages = data.text ? data.text.split(/\f|\n\n\n+/) : [];

  const pages: DocumentPageResult[] = [];
  for (let i = 0; i < pageCount; i++) {
    const raw = rawPages[i] || data.text || `[Page ${i + 1}]`;
    const clean = normalizeText(raw);
    pages.push({
      pageNumber: i + 1,
      rawText: raw,
      cleanText: clean,
      characterCount: clean.length,
      extractionMethod: "pdf-parse",
      ocrUsed: false,
    });
  }

  return { pageCount, pages };
}
