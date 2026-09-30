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

// Scanned PDF Heuristic: Average text density < 20 clean characters per page
export function detectScannedPDF(pages: DocumentPageResult[]): boolean {
  if (!pages || pages.length === 0) return true;
  const totalChars = pages.reduce((sum, p) => sum + (p.cleanText?.length || 0), 0);
  const avgCharsPerPage = totalChars / pages.length;
  return avgCharsPerPage < 20;
}
