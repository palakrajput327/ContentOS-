import { queueBackend } from './queue-backend.js';
import { Worker } from "bullmq";
import { pool } from "./db.js";
import { redis } from "./queues.js";
import { processPDFDocument } from "./pdf-processing.js";
export { processPDFDocument } from "./pdf-processing.js";
if (queueBackend() === 'postgres')
    throw new Error('Use cron-worker in PostgreSQL mode');
export const pdfWorker = new Worker("pdf-processing", async (job) => {
    const { documentId, workspaceId } = job.data;
    return processPDFDocument(documentId, workspaceId);
}, {
    connection: redis,
    concurrency: Number(process.env.PDF_WORKER_CONCURRENCY) || 4,
});
pdfWorker.on("failed", (job, err) => {
    console.error(`[PDF Worker] Job ${job?.id} failed with error:`, err);
});
async function shutdown() {
    await pdfWorker.close();
    await redis.quit();
    await pool.end();
}
if (process.argv[1] && process.argv[1].endsWith("pdf-worker.js")) {
    process.on("SIGTERM", () => void shutdown());
    process.on("SIGINT", () => void shutdown());
    console.log(JSON.stringify({ event: "pdf_worker_ready", queue: "pdf-processing" }));
}
