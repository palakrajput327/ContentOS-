import { GenerateTextInput, GenerateStructuredInput, LLMProvider, LLMConfigurationException, LLMProviderException } from "./llm.types.js";

/** Ordered per-request failover; mock output is never a live fallback. */
export class FallbackLLMProvider implements LLMProvider {
  constructor(private readonly providers: LLMProvider[]) {}
  async validateConfiguration(): Promise<boolean> {
    for (const provider of this.providers) if (await provider.validateConfiguration()) return true;
    return false;
  }
  private async run<T>(generate: (provider: LLMProvider) => Promise<T>): Promise<T> {
    let attempted = 0;
    let retryable = false;
    const errors: string[] = [];
    for (const provider of this.providers) {
      if (!await provider.validateConfiguration()) continue;
      attempted++;
      try { return await generate(provider); }
      catch (error) {
        if (error instanceof LLMProviderException) {
          retryable ||= Boolean(error.isRetryable);
          errors.push(error.message);
        } else if (error instanceof Error) {
          errors.push(error.message);
        }
      }
    }
    if (!attempted) throw new LLMConfigurationException("No configured LLM provider is available. Add a key for a provider in the configured chain.");
    throw new LLMProviderException("All " + attempted + " configured LLM providers failed: " + errors.join("; "), undefined, retryable);
  }
  generateText(input: GenerateTextInput) { return this.run(provider => provider.generateText(input)); }
  generateStructured<T>(input: GenerateStructuredInput<T>) { return this.run(provider => provider.generateStructured(input)); }
}
