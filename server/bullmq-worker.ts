import { SocialProviderRegistry } from './social.provider.js';
import { Worker, Queue, UnrecoverableError } from "bullmq";
import { pool, transaction, audit, type DB } from "./db.js";
import { redis, publishingQueue } from "./queues.js";
import { decryptToken } from "./security.js";
import { socialProvider, ProviderError } from "./providers/social.js";
import {
  publishYouTubeRecord,
  pollYouTubeProcessing,
} from "./youtube.service.js";
import { createPublishPlan } from "./publish-planner.js";
import { PLATFORM_CAPABILITIES, type Platform } from "./platform-capabilities.js";
import { pdfWorker } from "./pdf-worker.js";
import { aiWorker } from "./ai-worker.js";
import { knowledgeAutomationQueue, knowledgeAutomationWorker } from './knowledge/automation.worker.js';

import { executePublishRecord } from "./publishing.js";
export { executePublishRecord, claim, aggregate } from "./publishing.js";
const worker = new Worker(
  "social-publishing",
  async (job) => {
    const res = await executePublishRecord(job.data.id, {
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts || 1,
    });
    if (!res.success && res.error) {
      if (res.retry) throw new Error(res.error);
      throw new UnrecoverableError(res.error);
    }
  },
  {
    connection: redis,
    concurrency: 5,
    lockDuration: 90000,
    maxStalledCount: 1,
  },
);
// The database is the durable outbox. Redis restarts do not lose pending schedules.
const maintenanceQueue = new Queue("scheduler-maintenance", {
  connection: redis,
});
await maintenanceQueue.upsertJobScheduler(
  "outbox-relay",
  { every: 30000 },
  {
    name: "relay",
    data: {},
    opts: { removeOnComplete: true, removeOnFail: 100 },
  },
);
import { FestivalAutoSchedulerService } from "./calendar/festival-auto-scheduler.js";

const maintenance = new Worker(
  "scheduler-maintenance",
  async () => {
    await pollYouTubeProcessing();
    try {
      await FestivalAutoSchedulerService.runFestivalAutoScheduler(pool);
    } catch (err: any) {
      console.error(
        JSON.stringify({
          event: "festival_auto_scheduler_error",
          error: err?.message,
        }),
      );
    }
    const jobs = (
      await pool.query(
        "SELECT id,execute_at FROM scheduled_posts WHERE state='PENDING' ORDER BY execute_at LIMIT 200",
      )
    ).rows;
    for (const item of jobs) {
      await publishingQueue.add(
        "publish",
        { id: item.id },
        {
          jobId: item.id,
          delay: Math.max(0, new Date(item.execute_at).getTime() - Date.now()),
        },
      );
      await pool.query(
        "UPDATE scheduled_posts SET state='ENQUEUED' WHERE id=$1 AND state='PENDING'",
        [item.id],
      );
    }
    const enqueued = (
      await pool.query(
        "SELECT id,execute_at FROM scheduled_posts WHERE state='ENQUEUED' AND execute_at<now() ORDER BY execute_at LIMIT 200",
      )
    ).rows;
    for (const item of enqueued)
      if (!(await publishingQueue.getJob(item.id)))
        await publishingQueue.add(
          "publish",
          { id: item.id },
          { jobId: item.id },
        );
    try {
      await pool.query(
        "DELETE FROM auth_sessions WHERE absolute_expires_at < now()",
      );
    } catch {}
  },
  { connection: redis, concurrency: 1 },
);
for (const w of [worker, maintenance, pdfWorker, aiWorker, knowledgeAutomationWorker]) {
  w.on("failed", (j) =>
    console.error(
      JSON.stringify({ event: "queue_failed", queue: w.name, jobId: j?.id }),
    ),
  );
  w.on("error", () =>
    console.error(JSON.stringify({ event: "worker_error", queue: w.name })),
  );
}
async function shutdown() {
  await Promise.allSettled([
    maintenance.close(),
    worker.close(),
    pdfWorker.close(),
    aiWorker.close(),
    knowledgeAutomationWorker.close(),
    knowledgeAutomationQueue.close(),
    maintenanceQueue.close(),
    publishingQueue.close(),
  ]);
  await redis.quit();
  await pool.end();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
console.log(
  JSON.stringify({
    event: "workers_ready",
    queues: [
      "social-publishing",
      "scheduler-maintenance",
      "pdf-processing",
      "content-generation",
    ],
  }),
);
