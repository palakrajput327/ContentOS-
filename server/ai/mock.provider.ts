import {
  GenerateStructuredInput,
  GenerateTextInput,
  GenerateTextResult,
  LLMProvider,
  StructuredGenerationResult,
} from "./llm.types.js";

export class MockLLMProvider implements LLMProvider {
  public mockTextResponse: string = "Mock text response from MockLLMProvider.";
  public mockStructuredData: any = null;
  public shouldFail: boolean = false;

  async validateConfiguration(): Promise<boolean> {
    return true;
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    if (this.shouldFail) {
      throw new Error("MockLLMProvider configured failure.");
    }
    return {
      text: this.mockTextResponse,
      finishReason: "stop",
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    };
  }

  async generateStructured<T>(input: GenerateStructuredInput<T>): Promise<StructuredGenerationResult<T>> {
    if (this.shouldFail) {
      throw new Error("MockLLMProvider configured failure.");
    }

    const data = this.mockStructuredData || {
      facts: [
        {
          type: "COMPANY_NAME",
          key: "company_name",
          value: "ContentOS Technologies",
          supportingChunkIds: [],
        },
        {
          type: "SERVICE",
          key: "primary_service",
          value: "AI Social Media Management Platform",
          supportingChunkIds: [],
        },
      ],
    };

    const validation = input.schema.safeParse(data);
    if (!validation.success) {
      throw new Error(`Mock structured data failed schema validation: ${validation.error.message}`);
    }

    return {
      data: validation.data,
      rawText: JSON.stringify(data),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    };
  }
}
