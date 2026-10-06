import { z } from "zod";
export function loadConfig() {
  const env = z
    .object({
      APP_ENV: z
        .enum(["development", "production", "test"])
        .default("development"),
      APP_URL: z.string().url(),
      DATABASE_URL: z.string().url(),
      REDIS_URL: z.string().url(),
      ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i),
      PORT: z.coerce.number().int().min(1).max(65535).default(3001),
      MAIL_HOST: z.string().min(1),
      MAIL_PORT: z.coerce.number().int().positive(),
      MAIL_FROM_ADDRESS: z.string().email(),
      MAIL_USERNAME: z.string().optional(),
      MAIL_PASSWORD: z.string().optional(),
      MAIL_SECURE: z.enum(["true", "false"]).default("false"),
      LOCAL_MAILBOX_URL: z.string().url().optional(),
      STORAGE_PROVIDER: z.string().default("s3"),
      STORAGE_ENDPOINT: z.string().optional(),
      STORAGE_REGION: z.string().default("us-east-1"),
      STORAGE_BUCKET: z.string().optional(),
      STORAGE_ACCESS_KEY: z.string().optional(),
      STORAGE_SECRET_KEY: z.string().optional(),
      STORAGE_FORCE_PATH_STYLE: z.string().default("true"),
      LLM_PROVIDER: z.string().default("openai-compatible"),
      LLM_FALLBACK_PROVIDERS: z.string().default(""),
      GEMINI_API_KEY: z.string().optional(),
      GEMINI_MODEL: z.string().optional(),
      GEMINI_BASE_URL: z.string().optional(),
      GROQ_API_KEY: z.string().optional(),
      GROQ_MODEL: z.string().optional(),
      GROQ_BASE_URL: z.string().optional(),
      OPENROUTER_API_KEY: z.string().optional(),
      OPENROUTER_MODEL: z.string().optional(),
      OPENROUTER_BASE_URL: z.string().optional(),
      LLM_API_KEY: z.string().optional(),
      LLM_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
      LLM_MODEL: z.string().default("gpt-6-luna"),
      LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
      LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
      FEATURE_KNOWLEDGE_ENGINE: z.string().default("true"),
      CLIPDROP_API_KEY: z.string().optional(),
    })
    .parse(process.env);
  if (
    env.APP_ENV === "production" &&
    new URL(env.APP_URL).protocol !== "https:"
  )
    throw new Error("APP_URL must use HTTPS in production.");
  process.env.TOKEN_ENCRYPTION_KEY = env.ENCRYPTION_KEY;
  process.env.NODE_ENV = env.APP_ENV;
  return env;
}
