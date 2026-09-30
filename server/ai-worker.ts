import { Worker } from "bullmq";
import { pool } from "./db.js";
import { redis } from "./queues.js";
import { KnowledgeService } from "./knowledge/knowledge.service.js";
import { KnowledgeExtractionJobPayload } from "./knowledge/knowledge.types.js";

const knowledgeService = new KnowledgeService();

export const aiWorker = new Worker<KnowledgeExtractionJobPayload>(
  "content-generation",
  async (job) => {
    const { generationId, documentId, workspaceId } = job.data;
    console.log(`[AI Worker] Received job ${job.id} (${job.name}) for generation ${generationId}`);

    if (job.name === "extract-knowledge" || job.data?.generationId) {
      await knowledgeService.processKnowledgeExtraction(
        generationId,
        documentId,
        workspaceId,
      );
    } else {
      console.warn(`[AI Worker] Unknown job name '${job.name}'. Skipping.`);
    }
  },
  {
    connection: redis,
    concurrency: Number(process.env.AI_WORKER_CONCURRENCY) || 2,
  },
);

aiWorker.on("failed", (job, err) => {
  console.error(`[AI Worker] Job ${job?.id} failed:`, err);
});

async function shutdown() {
  await aiWorker.close();
  await redis.quit();
  await pool.end();
}

if (process.argv[1] && process.argv[1].endsWith("ai-worker.js")) {
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  console.log(JSON.stringify({ event: "ai_worker_ready", queue: "content-generation" }));
}
