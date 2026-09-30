import { Worker, Queue, UnrecoverableError } from "bullmq";
import { randomUUID } from "node:crypto";
import { pool, transaction, audit, type DB } from "./db.js";
import { redis, publishingQueue } from "./queues.js";
import { decryptToken } from "./security.js";
import { socialProvider, ProviderError } from "./providers/social.js";
async function aggregate(
  db: DB,
  contentId: string,
  wid: string,
  version: number,
) {
  const rows = (
    await db.query(
      "SELECT state FROM scheduled_posts WHERE content_id=$1 AND workspace_id=$2 AND content_version=$3",
      [contentId, wid, version],
    )
  ).rows;
  const states = rows.map((r) => r.state);
  const status = states.every((s) => s === "PUBLISHED")
    ? "PUBLISHED"
    : states.includes("UNCERTAIN")
      ? "UNCERTAIN"
      : states.includes("FAILED")
        ? "FAILED"
        : "PUBLISHING";
  await db.query(
    "UPDATE content SET status=$3,updated_at=now() WHERE id=$1 AND workspace_id=$2",
    [contentId, wid, status],
  );
}
async function claim(id: string) {
  return transaction(async (db) => {
    const raw = (
      await db.query(
        "SELECT content_id,workspace_id FROM scheduled_posts WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!raw) return null;
    const content = (
      await db.query(
        "SELECT * FROM content WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [raw.content_id, raw.workspace_id],
      )
    ).rows[0];
    const job = (
      await db.query("SELECT * FROM scheduled_posts WHERE id=$1 FOR UPDATE", [
        id,
      ])
    ).rows[0];
    if (["CANCELLED", "PUBLISHED", "FAILED", "UNCERTAIN"].includes(job.state))
      return null;
    if (
      content.version !== job.content_version ||
      !["SCHEDULED", "PUBLISHING", "FAILED", "UNCERTAIN"].includes(
        content.status,
      )
    ) {
      await db.query(
        "UPDATE scheduled_posts SET state='CANCELLED' WHERE id=$1",
        [id],
      );
      return null;
    }
    if (job.state === "PROCESSING") {
      await db.query(
        "UPDATE scheduled_posts SET state='UNCERTAIN',error_code='INTERRUPTED_ATTEMPT' WHERE id=$1",
        [id],
      );
      await aggregate(db, content.id, job.workspace_id, job.content_version);
      await audit(
        db,
        job.workspace_id,
        null,
        "publishing requires verification",
        "content",
        content.id,
        content.title,
      );
      return null;
    }
    if (new Date(job.execute_at).getTime() > Date.now())
      throw new Error("Job arrived before execution time");
    const account = (
      await db.query(
        "SELECT a.*,t.ciphertext,t.expires_at FROM social_accounts a LEFT JOIN social_account_tokens t ON t.account_id=a.id WHERE a.id=$1 AND a.workspace_id=$2 FOR SHARE OF a",
        [job.account_id, job.workspace_id],
      )
    ).rows[0];
    if (
      !account?.ciphertext ||
      account.state !== "Connected" ||
      (account.expires_at &&
        new Date(account.expires_at).getTime() <= Date.now())
    ) {
      await db.query(
        "UPDATE scheduled_posts SET state='FAILED',error_code='RECONNECT_REQUIRED' WHERE id=$1",
        [id],
      );
      await aggregate(db, content.id, job.workspace_id, job.content_version);
      await audit(
        db,
        job.workspace_id,
        null,
        "publishing failed: reconnect required",
        "content",
        content.id,
        content.title,
      );
      return null;
    }
    await db.query(
      "UPDATE scheduled_posts SET state='PROCESSING',attempt_started_at=now() WHERE id=$1",
      [id],
    );
    await db.query(
      "UPDATE content SET status='PUBLISHING' WHERE id=$1 AND workspace_id=$2",
      [content.id, job.workspace_id],
    );
    return { job, content, account };
  });
}
const worker = new Worker(
  "social-publishing",
  async (job) => {
    const c = await claim(job.data.id);
    if (!c) return;
    const { account, content, job: record } = c;
    let providerId: string;
    try {
      providerId = await socialProvider(account.platform).publishText(
        {
          token: decryptToken(
            account.ciphertext,
            `${record.workspace_id}:${account.id}`,
          ),
          providerId: account.provider_id,
        },
        content.variants[account.platform] || content.body,
      );
    } catch (error) {
      const e =
        error instanceof ProviderError
          ? error
          : new ProviderError("PROVIDER_OUTCOME_UNKNOWN", false, true);
      const retry =
        e.retryable && job.attemptsMade + 1 < (job.opts.attempts || 1);
      await transaction(async (db) => {
        await db.query("SELECT id FROM content WHERE id=$1 FOR UPDATE", [
          content.id,
        ]);
        await db.query(
          "UPDATE scheduled_posts SET state=$2,error_code=$3 WHERE id=$1",
          [
            record.id,
            retry ? "ENQUEUED" : e.uncertain ? "UNCERTAIN" : "FAILED",
            e.code,
          ],
        );
        if (e.code === "RECONNECT_REQUIRED")
          await db.query(
            "UPDATE social_accounts SET state='Reconnect required' WHERE id=$1",
            [account.id],
          );
        await aggregate(
          db,
          content.id,
          record.workspace_id,
          record.content_version,
        );
        await audit(
          db,
          record.workspace_id,
          null,
          retry
            ? "publishing retry queued"
            : e.uncertain
              ? "publishing requires verification"
              : "publishing failed",
          "content",
          content.id,
          content.title,
          null,
          { code: e.code, platform: account.platform },
        );
      });
      if (retry) throw new Error(e.code);
      throw new UnrecoverableError(e.code);
    }
    // If the database fails after the provider accepts the post, leave PROCESSING.
    // A recovered job becomes UNCERTAIN; it must never publish a second time.
    await transaction(async (db) => {
      await db.query("SELECT id FROM content WHERE id=$1 FOR UPDATE", [
        content.id,
      ]);
      await db.query(
        "UPDATE scheduled_posts SET state='PUBLISHED',provider_post_id=$2,error_code=NULL WHERE id=$1",
        [record.id, providerId],
      );
      await db.query(
        "INSERT INTO published_posts(id,workspace_id,scheduled_post_id,provider_post_id) VALUES($1,$2,$3,$4) ON CONFLICT(scheduled_post_id) DO NOTHING",
        [randomUUID(), record.workspace_id, record.id, providerId],
      );
      await aggregate(
        db,
        content.id,
        record.workspace_id,
        record.content_version,
      );
      await audit(
        db,
        record.workspace_id,
        null,
        "published",
        "content",
        content.id,
        content.title,
        null,
        { platform: account.platform, providerPostId: providerId },
      );
    });
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
  { every: 5000 },
  {
    name: "relay",
    data: {},
    opts: { removeOnComplete: true, removeOnFail: 100 },
  },
);
const maintenance = new Worker(
  "scheduler-maintenance",
  async () => {
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
      await pool.query("DELETE FROM auth_sessions WHERE absolute_expires_at < now()");
    } catch {}
  },
  { connection: redis, concurrency: 1 },
);
for (const w of [worker, maintenance]) {
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
  await maintenance.close();
  await worker.close();
  await maintenanceQueue.close();
  await publishingQueue.close();
  await redis.quit();
  await pool.end();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
console.log(
  JSON.stringify({
    event: "workers_ready",
    queues: ["social-publishing", "scheduler-maintenance"],
  }),
);
