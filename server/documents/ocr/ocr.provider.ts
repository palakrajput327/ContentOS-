import { DocumentPageResult } from "../documents.types.js";

export interface OcrInput {
  buffer: Buffer;
  pageNumber: number;
}

export interface OcrResult {
  text: string;
  confidence: number;
  provider: string;
}

export interface OcrProvider {
  extract(input: OcrInput): Promise<OcrResult>;
  isAvailable(): boolean;
}

export class StubOcrProvider implements OcrProvider {
  isAvailable(): boolean {
    return process.env.OCR_ENABLED === "true";
  }

  async extract(input: OcrInput): Promise<OcrResult> {
    if (!this.isAvailable()) {
      throw new Error("OCR provider is not currently configured or enabled.");
    }
    return {
      text: "",
      confidence: 0,
      provider: process.env.OCR_PROVIDER || "none",
    };
  }
}

export class TesseractOcrProvider implements OcrProvider {
  isAvailable(): boolean {
    return true;
  }

  async extract(input: OcrInput): Promise<OcrResult> {
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      try {
        const ret = await worker.recognize(input.buffer);
        return {
          text: ret.data.text || "",
          confidence: (ret.data.confidence || 80) / 100,
          provider: "tesseract",
        };
      } finally {
        await worker.terminate().catch(() => {});
      }
    } catch (err: any) {
      console.warn("[OCR] Tesseract extraction failed:", err?.message || err);
      return { text: "", confidence: 0, provider: "tesseract-failed" };
    }
  }

  async extractFromPDF(pdfBuffer: Buffer, maxOcrPages = 8, totalPages?: number): Promise<Map<number, string>> {
    const pageTexts = new Map<number, string>();
    try {
      const { PDFParse } = await import("pdf-parse");
      const { createWorker } = await import("tesseract.js");
      const parser = new PDFParse({ data: pdfBuffer });
      const worker = await createWorker("eng");

      try {
        let total: number = totalPages ?? 0;
        if (total <= 0) {
          const info = await parser.getText().catch(() => ({ total: 1 }));
          total = Number((info as any)?.total) || 1;
        }

        // Evenly sample pages across the entire document
        const pagesToExtract: number[] = [];
        if (total <= maxOcrPages) {
          for (let i = 1; i <= total; i++) pagesToExtract.push(i);
        } else {
          const step = (total - 1) / (maxOcrPages - 1);
          const set = new Set<number>();
          for (let i = 0; i < maxOcrPages; i++) {
            const p = Math.min(total, Math.max(1, Math.round(1 + i * step)));
            if (!set.has(p)) {
              set.add(p);
              pagesToExtract.push(p);
            }
          }
        }

        console.log(`[OCR] Evenly sampling ${pagesToExtract.length} pages across ${total} total pages:`, pagesToExtract);

        const imgs = await parser.getImage({ partial: pagesToExtract });
        const rawPages = imgs?.pages || [];

        for (let idx = 0; idx < rawPages.length; idx++) {
          const pageObj = rawPages[idx];
          const imgData = pageObj?.images?.[0]?.data;
          const pageNum = pagesToExtract[idx] || (pageObj as any)?.num || idx + 1;

          if (imgData) {
            const ret = await worker.recognize(Buffer.from(imgData));
            const text = ret.data.text || "";
            if (text.trim().length > 0) {
              pageTexts.set(pageNum, text);
            }
          }
        }
      } finally {
        await worker.terminate().catch(() => {});
        await parser.destroy().catch(() => {});
      }
    } catch (err: any) {
      console.warn("[OCR] Batch PDF OCR failed:", err?.message || err);
    }
    return pageTexts;
  }
}

// Scanned PDF Heuristic: Average text density < 20 clean characters per page
export function detectScannedPDF(pages: DocumentPageResult[]): boolean {
  if (!pages || pages.length === 0) return true;
  const totalChars = pages.reduce((sum, p) => sum + (p.cleanText?.length || 0), 0);
  const avgCharsPerPage = totalChars / pages.length;
  return avgCharsPerPage < 20;
}
