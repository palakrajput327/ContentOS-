import {
  GenerateStructuredInput,
  GenerateTextInput,
  GenerateTextResult,
  LLMConfigurationException,
  LLMProvider,
  LLMProviderException,
  StructuredGenerationResult,
} from "./llm.types.js";

export interface OpenAICompatibleOptions {
  providerName?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class OpenAICompatibleProvider implements LLMProvider {
  private providerName: string;
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(options?: OpenAICompatibleOptions) {
    this.providerName = options?.providerName ?? "openai-compatible";
    this.apiKey = options?.apiKey ?? process.env.LLM_API_KEY ?? "";
    this.baseUrl = (options?.baseUrl || process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/?$/, "/");
    this.model = options?.model || process.env.LLM_MODEL || "gpt-6-luna";
    this.timeoutMs = options?.timeoutMs ?? Number(process.env.LLM_TIMEOUT_MS || 60000);
    this.maxRetries = options?.maxRetries ?? Number(process.env.LLM_MAX_RETRIES || 3);
  }

  async validateConfiguration(): Promise<boolean> {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  private async fetchWithRetry(url: string, payload: any): Promise<any> {
    if (!await this.validateConfiguration()) {
      throw new LLMConfigurationException("AI Provider API key is not configured on the server.");
    }

    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0 || this.maxRetries > 10 || !Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new LLMConfigurationException("Invalid LLM timeout or retry configuration.");
    }
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= this.maxRetries) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
          const status = response.status;
          const isRetryable = status === 429 || status >= 500;
          await response.body?.cancel();

          const err = new LLMProviderException(
            `LLM API request failed (${status}).`,
            status,
            isRetryable,
          );

          if (!isRetryable || attempt === this.maxRetries) {
            throw err;
          }

          lastError = err;
        } else {
          return await response.json();
        }
      } catch (err: any) {
        if (err instanceof LLMConfigurationException) throw err;
        if (err instanceof LLMProviderException && !err.isRetryable) throw err;

        lastError = err;

        if (attempt >= this.maxRetries) {
          if (err instanceof LLMProviderException) throw err;
          throw new LLMProviderException(
            `LLM API request failed after ${attempt} retries.`,
            undefined,
            true,
          );
        }
      }

      attempt++;
      const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
      await new Promise((res) => setTimeout(res, backoffMs));
    }

    throw lastError || new LLMProviderException("LLM request failed.");
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const endpoint = new URL("chat/completions", this.baseUrl).toString();
    const payload = {
      model: this.model,
      messages: input.messages,
      temperature: input.temperature ?? 0.2,
      max_tokens: input.maxTokens,
    };

    const res = await this.fetchWithRetry(endpoint, payload);
    const content = res.choices?.[0]?.message?.content || "";

    if (typeof content !== "string" || !content.trim()) throw new LLMProviderException("LLM returned empty or invalid text.");
    return {
      provider: this.providerName, model: this.model,
      text: content,
      finishReason: res.choices?.[0]?.finish_reason,
      usage: res.usage
        ? {
            promptTokens: res.usage.prompt_tokens,
            completionTokens: res.usage.completion_tokens,
            totalTokens: res.usage.total_tokens,
          }
        : undefined,
    };
  }

  async generateStructured<T>(input: GenerateStructuredInput<T>): Promise<StructuredGenerationResult<T>> {
    const endpoint = new URL("chat/completions", this.baseUrl).toString();
    const hasJsonWord = input.messages.some((m) =>
      m.content.toLowerCase().includes("json"),
    );
    const messages = hasJsonWord
      ? input.messages
      : [
          ...input.messages,
          {
            role: "system" as const,
            content: "Respond strictly with a valid json object matching the requested schema.",
          },
        ];

    const payload = {
      model: this.model,
      messages,
      temperature: input.temperature ?? 0.1,
      max_tokens: input.maxTokens,
      response_format: { type: "json_object" },
    };

    const res = await this.fetchWithRetry(endpoint, payload);
    const rawText = res.choices?.[0]?.message?.content || "";

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText.trim());
    } catch {
      const match = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match) {
        try {
          parsedJson = JSON.parse(match[1].trim());
        } catch {}
      }
      if (!parsedJson) {
        const firstBrace = rawText.indexOf("{");
        const lastBrace = rawText.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          try {
            parsedJson = JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
          } catch {}
        }
      }
      if (!parsedJson) {
        throw new LLMProviderException(
          "LLM returned invalid non-JSON output in structured mode.",
        );
      }
    }

    const validation = input.schema.safeParse(parsedJson);
    if (!validation.success) {
      console.error(
        `[${this.providerName}] Structured output validation error:`,
        validation.error.issues,
        "Received parsed JSON:",
        JSON.stringify(parsedJson, null, 2),
      );
      throw new LLMProviderException(
        `LLM structured output validation failed: ${validation.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
      );
    }

    return {
      provider: this.providerName,
      model: this.model,
      data: validation.data,
      rawText,
      usage: res.usage
        ? {
            promptTokens: res.usage.prompt_tokens,
            completionTokens: res.usage.completion_tokens,
            totalTokens: res.usage.total_tokens,
          }
        : undefined,
    };
  }
}
