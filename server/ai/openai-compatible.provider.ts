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
          const errText = await response.text().catch(() => "");
          console.error(`[LLM Provider Error] ${this.providerName} (${status}):`, errText);

          const isQuotaExceeded = /quota|RESOURCE_EXHAUSTED|limit exceeded|per day/i.test(errText);
          const isRetryable = (status === 429 && !isQuotaExceeded) || (status >= 500 && status !== 501);

          // If Gemini model hits 429 quota or 404, automatically try next working Gemini model
          if (this.providerName === "gemini") {
            const geminiModels = [this.model, "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"].filter((m, i, a) => m && a.indexOf(m) === i);
            const currentIdx = geminiModels.indexOf(payload.model || this.model);
            if (currentIdx !== -1 && currentIdx < geminiModels.length - 1) {
              const nextModel = geminiModels[currentIdx + 1];
              console.log(`[Gemini] Switching model from ${payload.model} to ${nextModel} due to ${status}`);
              payload.model = nextModel;
              attempt++;
              continue;
            }
          }

          let suggestedWaitMs = 0;
          const matchWait = errText.match(/try again in (\d+(?:\.\d+)?)s/i);
          if (matchWait) {
            suggestedWaitMs = Math.ceil(parseFloat(matchWait[1]) * 1000) + 1200;
          }

          if (status === 400) {
            try {
              const parsedErr = JSON.parse(errText);
              if (parsedErr.error?.failed_generation) {
                let partial = parsedErr.error.failed_generation.trim();
                if (!partial.endsWith("}")) partial += "]}";
                return { choices: [{ message: { content: partial } }] };
              }
            } catch {}
          }

          const err = new LLMProviderException(
            `LLM API request failed (${status}): ${errText.slice(0, 120)}`,
            status,
            isRetryable,
          );

          if (!isRetryable || attempt === this.maxRetries) {
            throw err;
          }

          lastError = err;
          attempt++;
          const baseBackoff = Math.min(2000 * Math.pow(2, attempt), 15000);
          const backoffMs = Math.max(suggestedWaitMs, baseBackoff);
          await new Promise((res) => setTimeout(res, backoffMs));
          continue;
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
        attempt++;
        const backoffMs = Math.min(2000 * Math.pow(2, attempt), 15000);
        await new Promise((res) => setTimeout(res, backoffMs));
      }
    }

    throw lastError || new LLMProviderException("LLM request failed.");
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const endpoint = new URL("chat/completions", this.baseUrl).toString();
    const payload = {
      model: this.model,
      messages: input.messages.map(m=>m.images?.length?{role:m.role,content:[{type:'text',text:m.content},...m.images.map(url=>({type:'image_url',image_url:{url}}))]}:{role:m.role,content:m.content}),
      temperature: input.temperature ?? 0.2,
      max_tokens: this.providerName === "groq" ? Math.min(input.maxTokens ?? 800, 800) : input.maxTokens,
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

    const payload: any = {
      model: this.model,
      messages: messages.map(m=>'images' in m && m.images?.length?{role:m.role,content:[{type:'text',text:m.content},...m.images.map(url=>({type:'image_url',image_url:{url}}))]}:{role:m.role,content:m.content}),
      temperature: input.temperature ?? 0.1,
      max_tokens: this.providerName === "groq" ? Math.min(input.maxTokens ?? 800, 800) : (input.maxTokens ?? 4096),
      response_format: { type: "json_object" },
    };

    const res = await this.fetchWithRetry(endpoint, payload);
    const choice = res.choices?.[0];
    let rawText = choice?.message?.content || "";
    if (!rawText.trim() && choice?.message?.reasoning) {
      rawText = choice.message.reasoning;
    }

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
        const firstBracket = rawText.indexOf("[");
        const lastBracket = rawText.lastIndexOf("]");
        if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
          try {
            const arr = JSON.parse(rawText.slice(firstBracket, lastBracket + 1));
            parsedJson = { facts: arr };
          } catch {}
        }
      }
      if (!parsedJson) {
        // Salvage parser for partial or truncated facts
        const firstBrace = rawText.indexOf("{");
        if (firstBrace !== -1) {
          const fromBrace = rawText.slice(firstBrace);
          const lastFactEnd = fromBrace.lastIndexOf("}");
          if (lastFactEnd !== -1) {
            const candidate = fromBrace.slice(0, lastFactEnd + 1);
            for (const suffix of ["", "]}", "}"]) {
              try {
                parsedJson = JSON.parse(candidate + suffix);
                if (parsedJson) break;
              } catch {}
            }
          }
        }
      }
      if (!parsedJson) {
        console.error(`[${this.providerName}] Failed to parse JSON. Raw text:`, rawText);
        throw new LLMProviderException(
          `LLM returned invalid non-JSON output in structured mode: ${rawText.slice(0, 120)}`,
        );
      }
    }

    let validatedData: T = parsedJson as T;
    if (input.schema && typeof (input.schema as any).safeParse === "function") {
      const validation = (input.schema as any).safeParse(parsedJson);
      if (!validation.success) {
        console.error(
          `[${this.providerName}] Structured output validation error:`,
          validation.error.issues,
          "Received parsed JSON:",
          JSON.stringify(parsedJson, null, 2),
        );
        throw new LLMProviderException(
          `LLM structured output validation failed: ${validation.error.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
        );
      }
      validatedData = validation.data;
    }

    return {
      provider: this.providerName,
      model: this.model,
      data: validatedData,
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
