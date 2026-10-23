import { fileURLToPath } from 'node:url';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
// Explicit read-only inventory. Never import worker modules or decrypt payloads.
export async function exportBullmq() {
    if (!process.env.REDIS_URL)
        throw new Error('REDIS_URL is required');
    const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 5000, retryStrategy: () => null });
    redis.on('error', () => { });
    const jobs = [];
    const queues = ['social-publishing', 'pdf-processing', 'content-generation', 'batch-processing',
        'auth-email-dispatch', 'scheduler-maintenance', 'knowledge-automation', 'video-rendering', 'analytics-sync', 'notification'];
    try {
        for (const name of queues) {
            const queue = new Queue(name, { connection: redis, skipMetasUpdate: true });
            try {
                for (let offset = 0;; offset += 100) {
                    const page = await queue.getJobs(['wait', 'active', 'delayed', 'failed', 'paused', 'prioritized', 'waiting-children'], offset, offset + 99, true);
                    for (const job of page) {
                        const state = await job.getState();
                        const score = state === 'delayed' ? await redis.zscore(queue.toKey('delayed'), job.id) : null;
                        jobs.push({ queue: name, jobId: job.id, workspaceId: job.data?.workspaceId || null,
                            sourceId: job.data?.id || job.data?.documentId || job.data?.generationId || job.data?.batchId || null,
                            state, attemptsMade: job.attemptsMade, maxAttempts: job.opts.attempts || 1,
                            backoffMs: typeof job.opts.backoff === 'object' ? job.opts.backoff.delay : typeof job.opts.backoff === 'number' ? job.opts.backoff : 0,
                            runAt: score ? Math.floor(Number(score) / 4096) : job.timestamp,
                            // Unknown payload values may contain credentials: expose field names only.
                            payloadFields: Object.keys(job.data || {}) });
                    }
                    if (page.length < 100)
                        break;
                }
            }
            finally {
                await queue.close();
            }
        }
        return { exportedAt: new Date().toISOString(), jobs };
    }
    finally {
        redis.disconnect();
    }
}
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
    exportBullmq().then(result => console.log(JSON.stringify(result, null, 2))).catch(() => { console.error('Redis export unavailable. Existing jobs were not changed.'); process.exitCode = 1; });
}
