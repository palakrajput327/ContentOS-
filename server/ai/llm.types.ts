import { z } from "zod";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateTextInput {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateTextResult {
  provider?: string;
  model?: string;
  text: string;
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface GenerateStructuredInput<T> {
  messages: LLMMessage[];
  schema: z.ZodSchema<T>;
  schemaName?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface StructuredGenerationResult<T> {
  provider?: string;
  model?: string;
  data: T;
  rawText: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMProvider {
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
  generateStructured<T>(input: GenerateStructuredInput<T>): Promise<StructuredGenerationResult<T>>;
  validateConfiguration(): Promise<boolean>;
}

export class LLMConfigurationException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMConfigurationException";
  }
}

export class LLMProviderException extends Error {
  public readonly statusCode?: number;
  public readonly isRetryable: boolean;

  constructor(message: string, statusCode?: number, isRetryable: boolean = false) {
    super(message);
    this.name = "LLMProviderException";
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
  }
}
