import { pool } from './db.js';
import { queueBackend } from './queue-backend.js';
import { PostgresQueue } from './postgres-queue.js';
const legacy = queueBackend() === 'bullmq';
const bull = legacy ? await import('bullmq') : null;
const RedisClass = legacy ? (await import('ioredis')).Redis : null;
export const redis = RedisClass ? new RedisClass(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null,
}) : null;
export const postgresQueue = new PostgresQueue(pool);
export const queueNames = ['content-generation', 'pdf-processing', 'video-rendering', 'social-publishing', 'analytics-sync', 'notification'];
async function validateTenant(queue, data, db) {
    let row;
    if (queue === 'social-publishing') {
        row = (await db.query('SELECT workspace_id FROM scheduled_posts WHERE id=$1', [data.id])).rows[0];
        if (data.workspaceId && row?.workspace_id !== data.workspaceId)
            throw new Error('Queue tenant mismatch');
    }
    else {
        const mapping = {
            'pdf-processing': ['documents', 'documentId'],
            'content-generation': ['ai_generations', 'generationId'],
            'batch-processing': ['batch_jobs', 'batchId'],
        };
        const entry = mapping[queue];
        if (!entry || !data.workspaceId)
            throw new Error('Unsupported queue or missing tenant');
        row = (await db.query(`SELECT workspace_id FROM ${entry[0]} WHERE id=$1 AND workspace_id=$2`, [data[entry[1]], data.workspaceId])).rows[0];
        if (queue === 'content-generation' && row) {
            const document = (await db.query('SELECT id FROM documents WHERE id=$1 AND workspace_id=$2', [data.documentId, data.workspaceId])).rows[0];
            if (!document)
                throw new Error('Queue document tenant mismatch');
        }
    }
    if (!row?.workspace_id)
        throw new Error('Queue source record missing or outside tenant');
    return row.workspace_id;
}
export function createQueue(name, defaults = {}) {
    if (bull) {
        const q = new bull.Queue(name, { connection: redis, defaultJobOptions: defaults.defaultJobOptions });
        return {
            name: q.name,
            add: (jobName, data, opts, _db) => q.add(jobName, data, opts),
            getJob: (id, _workspaceId, _db) => q.getJob(id),
            close: () => q.close(),
            options: { connection: redis, ...defaults },
        };
    }
    return {
        name,
        async add(jobName, data, opts = {}, db = pool) {
            const workspaceId = await validateTenant(name, data, db);
            const options = { ...defaults.defaultJobOptions, ...opts };
            const key = options.jobId || data.batchId || data.generationId || data.documentId || data.id;
            if (!key)
                throw new Error('A stable queue job identifier is required');
            return postgresQueue.enqueue(name, jobName, { ...data, workspaceId }, {
                workspaceId, key, attempts: options.attempts, backoff: options.backoff?.delay,
                runAt: new Date(Date.now() + (options.delay || 0)),
            }, db);
        },
        async getJob(id, workspaceId, db = pool) {
            if (!workspaceId)
                throw new Error('Queue lookup requires workspaceId');
            const row = (await db.query('SELECT * FROM queue_jobs WHERE queue=$1 AND scope=$2 AND dedupe_key=$3', [name, workspaceId, id])).rows[0];
            if (!row)
                return undefined;
            return {
                getState: async () => row.state,
                remove: async () => {
                    const changed = await db.query(`UPDATE queue_jobs SET dedupe_key=dedupe_key||':archived:'||id::text,updated_at=now()
            WHERE id=$1 AND workspace_id=$2 AND state IN ('failed','completed','cancelled')`, [row.id, workspaceId]);
                    if (!changed.rowCount)
                        throw new Error('Active or uncertain job cannot be removed');
                },
            };
        },
        close: async () => { },
        options: defaults,
    };
}
export const publishingQueue = createQueue('social-publishing', {
    defaultJobOptions: {
        attempts: 5, backoff: { type: 'exponential', delay: 60000 },
        removeOnComplete: { age: 7 * 86400 }, removeOnFail: { age: 30 * 86400 },
    },
});
