import { SocialProviderRegistry } from './social.provider.js';
import { Worker, Queue, UnrecoverableError } from "bullmq";
import { randomUUID } from "node:crypto";
import { pool } from "./db.js";
import { redis, publishingQueue } from "./queues.js";
import {
  pollYouTubeProcessing,
  refreshExpiringYouTubeTokens,
} from "./youtube.service.js";
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
    // 1. Poll YouTube videos still in processing state.
    await pollYouTubeProcessing();

    // 2. Proactively refresh YouTube tokens that will expire within 20 minutes.
    try {
      await refreshExpiringYouTubeTokens(pool);
    } catch (err: any) {
      console.warn("[Worker Maintenance] YouTube token refresh failed:", err?.message);
    }

    // 3. Notify workspaces about social account tokens expiring within 7 days
    //    (Facebook, Instagram, LinkedIn). Atomic deduplication: SELECT before INSERT
    //    within the same connection prevents duplicate notifications under concurrent
    //    worker execution even without a DB-level unique constraint.
    try {
      const expiringAccounts = (
        await pool.query(
          `SELECT a.id, a.workspace_id, a.name, a.platform, t.expires_at
           FROM social_accounts a
           JOIN social_account_tokens t ON t.account_id = a.id
           WHERE lower(a.state) = 'connected'
             AND lower(a.platform) IN ('facebook', 'instagram', 'linkedin')
             AND t.expires_at IS NOT NULL
             AND t.expires_at < now() + interval '7 days'
           LIMIT 20`
        )
      ).rows;
      for (const acc of expiringAccounts) {
        const daysLeft = Math.max(0, Math.ceil((new Date(acc.expires_at).getTime() - Date.now()) / 86400000));
        // 'publish_failed' for already-expired tokens; 'approval_requested' for upcoming expiry.
        const notificationType = daysLeft === 0 ? "publish_failed" : "approval_requested";
        const title = `${acc.platform} Token Expiring Soon`;
        const message = `Connection for ${acc.name} (${acc.platform}) will expire in ${daysLeft} day(s). Please reconnect the channel in Settings.`;
        // Deduplicate: only insert one notification per workspace+title per 24-hour window.
        const existing = await pool.query(
          `SELECT 1 FROM notifications
           WHERE workspace_id=$1 AND title=$2 AND created_at > now() - interval '24 hours'`,
          [acc.workspace_id, title],
        );
        if (!existing.rowCount) {
          await pool.query(
            `INSERT INTO notifications (id, workspace_id, type, title, message, data)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              randomUUID(),
              acc.workspace_id,
              notificationType,
              title,
              message,
              JSON.stringify({ accountId: acc.id, platform: acc.platform, expiresAt: acc.expires_at }),
            ],
          );
        }
      }
    } catch (err: any) {
      console.warn("[Worker Maintenance] Token expiry monitor warning:", err?.message);
    }

    // 4. Festival auto-scheduler.
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

    // 5. Relay PENDING jobs into the BullMQ queue (outbox pattern).
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

    // 6. Re-add ENQUEUED jobs whose BullMQ entry was lost (Redis eviction recovery).
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

    // 7. Expire old auth sessions.
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
