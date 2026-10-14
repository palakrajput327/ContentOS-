import { queueBackend } from './queue-backend.js';
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { loadConfig } from "./config.js";
import { deliverEmails } from "./mail.js";
import { pool } from "./db.js";
import { requireMail } from './codes.js';
if (queueBackend()==='postgres') throw new Error('Use cron-worker in PostgreSQL mode');
const config = loadConfig();
try { requireMail(); } catch {
  console.error('Mail worker not started: set Gmail MAIL_USERNAME and MAIL_PASSWORD in the private .env file.');
  process.exit(1);
}
const redis = new Redis(config.REDIS_URL!, { maxRetriesPerRequest: null });
redis.on("error", () =>
  console.error(JSON.stringify({ event: "mail_redis_unavailable" })),
);
const queue = new Queue("auth-email-dispatch", { connection: redis });
await queue.upsertJobScheduler(
  "email-outbox",
  { every: 10000 },
  {
    name: "deliver",
    data: {},
    opts: { removeOnComplete: true, removeOnFail: 50 },
  },
);
const worker = new Worker("auth-email-dispatch", () => deliverEmails(), {
  connection: redis,
  concurrency: 1,
});
worker.on("error", () =>
  console.error(JSON.stringify({ event: "mail_worker_error" })),
);
worker.on("failed", () =>
  console.error(JSON.stringify({ event: "mail_dispatch_failed" })),
);
console.log(JSON.stringify({ event: "mail_worker_ready" }));
async function stop() {
  await worker.close();
  await queue.close();
  await redis.quit();
  await pool.end();
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
