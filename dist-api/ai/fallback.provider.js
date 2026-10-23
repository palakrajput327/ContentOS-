import { LLMConfigurationException, LLMProviderException } from "./llm.types.js";
/** Ordered per-request failover; mock output is never a live fallback. */
export class FallbackLLMProvider {
    providers;
    constructor(providers) {
        this.providers = providers;
    }
    async validateConfiguration() {
        for (const provider of this.providers)
            if (await provider.validateConfiguration())
                return true;
        return false;
    }
    async run(generate) {
        let attempted = 0;
        let retryable = false;
        const errors = [];
        for (const provider of this.providers) {
            if (!await provider.validateConfiguration())
                continue;
            attempted++;
            try {
                return await generate(provider);
            }
            catch (error) {
                if (error instanceof LLMProviderException) {
                    retryable ||= Boolean(error.isRetryable);
                    errors.push(error.message);
                }
                else if (error instanceof Error) {
                    errors.push(error.message);
                }
            }
        }
        if (!attempted)
            throw new LLMConfigurationException("No configured LLM provider is available. Add a key for a provider in the configured chain.");
        throw new LLMProviderException("All " + attempted + " configured LLM providers failed: " + errors.join("; "), undefined, retryable);
    }
    generateText(input) { return this.run(provider => provider.generateText(input)); }
    generateStructured(input) { return this.run(provider => provider.generateStructured(input)); }
}
