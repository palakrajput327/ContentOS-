import { z } from "zod";

export const knowledgeTypeSchema = z.enum([
  "COMPANY_NAME",
  "DESCRIPTION",
  "PRODUCT",
  "SERVICE",
  "INDUSTRY",
  "LOCATION",
  "CUSTOMER",
  "CASE_STUDY",
  "STATISTIC",
  "DIFFERENTIATOR",
  "TECHNOLOGY",
  "FAQ",
  "CTA",
  "WEBSITE",
  "CONTACT",
  "CLAIM",
  "CONTENT_TOPIC",
]);

export type KnowledgeType = z.infer<typeof knowledgeTypeSchema>;

export const extractedFactSchema = z.object({
  type: knowledgeTypeSchema,
  key: z.string().min(1).max(128),
  value: z.union([z.string(), z.record(z.any()), z.array(z.any())]),
  supportingChunkIds: z.array(z.string().uuid()).min(1),
  confidence: z.number().min(0).max(1).optional(),
});

export type ExtractedFact = z.infer<typeof extractedFactSchema>;

export const knowledgeExtractionOutputSchema = z.object({
  facts: z.array(extractedFactSchema),
});

export type KnowledgeExtractionOutput = z.infer<typeof knowledgeExtractionOutputSchema>;

export interface KnowledgeExtractionJobPayload {
  generationId: string;
  documentId: string;
  workspaceId: string;
  actorId: string;
  correlationId?: string;
}
