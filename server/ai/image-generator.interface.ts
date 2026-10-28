export interface ImageGenerationInput {
  prompt: string;
  headline?: string;
  aspectRatio?: string; // "1:1", "4:5", "16:9", "9:16"
  platform?: string;
  workspaceId: string;
  userId?: string;
  contentId?: string;
  brandOverlay?: boolean;
  referenceImages?: string[];
  metadata?: Record<string, any>;
}

export interface ImageGenerationOutput {
  assetUrl: string;
  assetId?: string;
  provider: string; // e.g., "clipdrop" | "flux" | "mock"
  providerJobId?: string;
  promptHash: string;
  generatedAt: string;
}

export interface ImageGenerator {
  readonly providerName: string;
  generate(input: ImageGenerationInput): Promise<ImageGenerationOutput>;
}
