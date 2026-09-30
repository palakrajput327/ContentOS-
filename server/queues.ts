import { Queue } from "bullmq";
import { Redis } from "ioredis";
export const queueNames = [
  "content-generation",
  "pdf-processing",
  "video-rendering",
  "social-publishing",
  "analytics-sync",
  "notification",
] as const;
export const redis = new Redis(
  process.env.REDIS_URL || "redis://127.0.0.1:6379",
  { maxRetriesPerRequest: null },
);
export const publishingQueue = new Queue("social-publishing", {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 60000 },
    removeOnComplete: { age: 7 * 86400 },
    removeOnFail: { age: 30 * 86400 },
  },
});
