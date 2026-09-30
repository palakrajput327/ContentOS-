export type DocumentStatus =
  | "UPLOADED"
  | "QUEUED"
  | "PROCESSING"
  | "EXTRACTING"
  | "NORMALIZING"
  | "CHUNKING"
  | "READY"
  | "FAILED";

export interface DocumentPageResult {
  pageNumber: number;
  rawText: string;
  cleanText: string;
  characterCount: number;
  extractionMethod: string;
  ocrUsed: boolean;
  ocrConfidence?: number;
}

export interface DocumentChunkResult {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  content: string;
  characterCount: number;
  tokenCount: number;
  contentHash: string;
}

export interface ExtractionJobPayload {
  documentId: string;
  workspaceId: string;
  correlationId?: string;
}

export interface DocumentProcessingResult {
  documentId: string;
  pageCount: number;
  chunkCount: number;
  pages: DocumentPageResult[];
  chunks: DocumentChunkResult[];
  ocrUsed: boolean;
}
