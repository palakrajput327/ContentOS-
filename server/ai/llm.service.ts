import { OpenAICompatibleProvider } from "./openai-compatible.provider.js";
import { MockLLMProvider } from "./mock.provider.js";
import { FallbackLLMProvider } from "./fallback.provider.js";
import { LLMConfigurationException, LLMProvider } from "./llm.types.js";
let currentProvider: LLMProvider | null = null;
const vendors = {
  gemini: { prefix: "GEMINI", url: "https://generativelanguage.googleapis.com/v1beta/openai/" },
  groq: { prefix: "GROQ", url: "https://api.groq.com/openai/v1" },
  openrouter: { prefix: "OPENROUTER", url: "https://openrouter.ai/api/v1" },
};
export function createLLMProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  const primary = env.LLM_PROVIDER?.trim() || "openai-compatible";
  const fallbacks = (env.LLM_FALLBACK_PROVIDERS || "").split(",").map(s => s.trim()).filter(Boolean);
  if (primary === "mock") {
    if (fallbacks.length) throw new LLMConfigurationException("Mock mode cannot use live fallbacks.");
    return new MockLLMProvider();
  }
  const timeoutMs = Number(env.LLM_TIMEOUT_MS || 60000);
  const maxRetries = Number(env.LLM_MAX_RETRIES || 3);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10)
    throw new LLMConfigurationException("Invalid LLM timeout or retry configuration.");
  const providers = [...new Set([primary, ...fallbacks])].map(name => {
    const shared = { providerName: name, timeoutMs, maxRetries };
    if (name === "openai-compatible") return new OpenAICompatibleProvider({ ...shared,
      apiKey: env.LLM_API_KEY || "", baseUrl: env.LLM_BASE_URL || "https://api.openai.com/v1", model: env.LLM_MODEL || "gpt-6-luna" });
    if (!Object.hasOwn(vendors, name)) throw new LLMConfigurationException("Unknown LLM provider: " + name);
    const vendor = vendors[name as keyof typeof vendors];
    const apiKey = env[vendor.prefix + "_API_KEY"]?.trim() || "";
    const model = env[vendor.prefix + "_MODEL"]?.trim();
    if (apiKey && !model) throw new LLMConfigurationException(vendor.prefix + "_MODEL is required when its API key is configured.");
    return new OpenAICompatibleProvider({ ...shared, apiKey, model: model || "unconfigured", baseUrl: env[vendor.prefix + "_BASE_URL"] || vendor.url });
  });
  return new FallbackLLMProvider(providers);
}
export function getLLMProvider(): LLMProvider { return currentProvider ??= createLLMProvider(); }
export function setLLMProvider(provider: LLMProvider) { currentProvider = provider; }
