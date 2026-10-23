export class MockLLMProvider {
    mockTextResponse = "Mock text response from MockLLMProvider.";
    mockStructuredData = null;
    shouldFail = false;
    async validateConfiguration() {
        return true;
    }
    async generateText(input) {
        if (this.shouldFail) {
            throw new Error("MockLLMProvider configured failure.");
        }
        return {
            text: this.mockTextResponse,
            finishReason: "stop",
            usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
        };
    }
    async generateStructured(input) {
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
