# LLM fallback configuration

Captions and document knowledge extraction share the same ordered provider chain.
Set these values in the private server environment (.env locally or .env.production for Compose):

```env
LLM_PROVIDER=gemini
LLM_FALLBACK_PROVIDERS=groq,openrouter
GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=your-available-gemini-model
GROQ_API_KEY=your-groq-key
GROQ_MODEL=your-available-groq-model
OPENROUTER_API_KEY=your-openrouter-key
OPENROUTER_MODEL=your-available-openrouter-model
LLM_TIMEOUT_MS=30000
LLM_MAX_RETRIES=1
```

Choose chat models supporting JSON object output. Model IDs are explicit because availability depends on the provider and account. Restart the API and ai-worker after changing configuration. Compose already supplies .env.production to both services.

Each request starts with the primary provider and tries fallbacks in order. Providers with empty keys are skipped; a configured key requires a model. A successful response stops the chain. Rate limits and server/network/timeout failures use the configured retry budget before failover. Other HTTP errors, empty text, invalid JSON, and schema validation failures advance immediately. Retries are per provider (initial attempt plus LLM_MAX_RETRIES); the timeout applies to each attempt, so total latency can span multiple providers and backoff delays.

Only listed providers receive requests. On failover, the same prompt/document chunks are sent to the next configured service. API credentials remain separate per provider. Mock mode is explicit and cannot be mixed into a live chain. Unknown provider names and invalid retry settings fail configuration validation. If no provider succeeds, the operation fails instead of returning fabricated facts.

Existing openai-compatible settings remain supported through LLM_API_KEY, LLM_BASE_URL, and LLM_MODEL. Leave LLM_FALLBACK_PROVIDERS empty for a single provider. Optional GEMINI_BASE_URL, GROQ_BASE_URL, and OPENROUTER_BASE_URL override vendor endpoints. Knowledge metadata records successful provider/model per batch; caption records identify the successful provider.

Verification: npm run test:llm builds the API, runs 12 mocked HTTP fallback tests, and runs existing knowledge mock checks. Live model quality, credentials, and database end-to-end extraction still require a configured live run.

Official endpoint references:
- Gemini: https://ai.google.dev/gemini-api/docs/openai
- Groq: https://console.groq.com/docs/overview
- OpenRouter: https://openrouter.ai/docs/quickstart
