import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import { PostgresQueue } from './postgres-queue.js';
export async function reconciliationPlan(db) {
    const items = [], review = [];
    for (const row of (await db.query(`SELECT id,workspace_id,state,execute_at FROM scheduled_posts
    WHERE state IN ('PENDING','ENQUEUED','PROCESSING','UNCERTAIN') ORDER BY id`)).rows) {
        if (['PROCESSING', 'UNCERTAIN'].includes(row.state))
            review.push({ type: 'publication', id: row.id, workspaceId: row.workspace_id, reason: row.state });
        else
            items.push({ queue: 'social-publishing', key: row.id, workspaceId: row.workspace_id, payload: { id: row.id, workspaceId: row.workspace_id }, runAt: row.execute_at, attempts: 5, backoff: 60000 });
    }
    for (const row of (await db.query(`SELECT id,workspace_id,status,processing_version FROM documents
    WHERE status IN ('QUEUED','PROCESSING','EXTRACTING','CHUNKING','NORMALIZING') ORDER BY id`)).rows) {
        if (row.status !== 'QUEUED')
            review.push({ type: 'document', id: row.id, workspaceId: row.workspace_id, reason: row.status });
        else
            items.push({ queue: 'pdf-processing', key: `${row.id}-version-${row.processing_version}`, workspaceId: row.workspace_id, payload: { documentId: row.id, workspaceId: row.workspace_id }, runAt: new Date(), attempts: 3, backoff: 10000 });
    }
    for (const row of (await db.query(`SELECT g.id,g.workspace_id,g.status,g.input,d.status AS document_status FROM ai_generations g
    LEFT JOIN documents d ON d.id::text=g.input->>'documentId' AND d.workspace_id=g.workspace_id
    WHERE g.generation_type='DOCUMENT_KNOWLEDGE' AND g.status IN ('QUEUED','PROCESSING') ORDER BY g.id`)).rows) {
        if (row.status !== 'QUEUED' || row.document_status !== 'READY')
            review.push({ type: 'generation', id: row.id, workspaceId: row.workspace_id, reason: 'IN_FLIGHT_OR_DOCUMENT_NOT_READY' });
        else
            items.push({ queue: 'content-generation', key: row.id, workspaceId: row.workspace_id, payload: { generationId: row.id, documentId: row.input.documentId, workspaceId: row.workspace_id }, runAt: new Date(), attempts: 3, backoff: 10000 });
    }
    for (const row of (await db.query(`SELECT b.id,b.workspace_id,b.status,
    EXISTS(SELECT 1 FROM batch_child_items c WHERE c.batch_id=b.id AND c.workspace_id=b.workspace_id AND c.status='PROCESSING') AS interrupted_child
    FROM batch_jobs b WHERE b.status IN ('PENDING','PROCESSING') ORDER BY b.id`)).rows) {
        if (row.status !== 'PENDING' || row.interrupted_child)
            review.push({ type: 'batch', id: row.id, workspaceId: row.workspace_id, reason: 'IN_FLIGHT_BATCH' });
        else
            items.push({ queue: 'batch-processing', key: row.id, workspaceId: row.workspace_id, payload: { batchId: row.id, workspaceId: row.workspace_id }, runAt: new Date(), attempts: 3, backoff: 5000 });
    }
    const email = (await db.query(`SELECT state,count(*)::integer AS count FROM email_outbox
    WHERE state IN ('PENDING','PROCESSING','FAILED') AND is_test=false GROUP BY state`)).rows;
    return { items, review, email };
}
export async function importPlan(items, db = pool) {
    const queue = new PostgresQueue(pool);
    for (const item of items) {
        // Stable source identity ensures backfill and the regular relay do not create two jobs.
        const present = (await db.query(`SELECT 1 FROM queue_jobs WHERE queue=$1 AND workspace_id=$2 AND
      ((queue='social-publishing' AND payload->>'id'=$3) OR
       (queue='pdf-processing' AND payload->>'documentId'=$3) OR
       (queue='content-generation' AND payload->>'generationId'=$3) OR
       (queue='batch-processing' AND payload->>'batchId'=$3)) AND state IN ('waiting','active','completed','uncertain')`, [item.queue, item.workspaceId, item.payload.id || item.payload.documentId || item.payload.generationId || item.payload.batchId])).rowCount;
        if (!present)
            await queue.enqueue(item.queue, 'reconciled', item.payload, { workspaceId: item.workspaceId, key: item.key, runAt: new Date(item.runAt), attempts: item.attempts, backoff: item.backoff, initialAttempts: item.initialAttempts }, db);
    }
}
export async function reconcileMain(args = process.argv.slice(2)) {
    const apply = args.includes('--apply');
    if (apply && !args.includes('--confirm-workers-stopped'))
        throw new Error('Applying requires --confirm-workers-stopped');
    const client = await pool.connect();
    try {
        await client.query(apply ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        // This serializes backfills but does not replace the operator's old-worker stop requirement.
        if (apply)
            await client.query('SELECT pg_advisory_xact_lock(74152024)');
        const plan = await reconciliationPlan(client);
        const exportArg = args.find(a => a.startsWith('--redis-export='));
        if (apply && !exportArg && !args.includes('--accept-database-only-recovery'))
            throw new Error('Redis inventory or explicit database-only recovery approval required');
        const redisOnly = [];
        if (exportArg) {
            const exported = JSON.parse(await readFile(exportArg.slice(15), 'utf8'));
            for (const job of exported.jobs || []) {
                if (['auth-email-dispatch', 'scheduler-maintenance', 'knowledge-automation'].includes(job.queue))
                    continue;
                const item = plan.items.find(item => item.queue === job.queue && (!job.workspaceId || item.workspaceId === job.workspaceId) &&
                    (item.payload.id || item.payload.documentId || item.payload.generationId || item.payload.batchId) === job.sourceId);
                if (item && job.state !== 'active' && job.state !== 'failed' && job.attemptsMade < job.maxAttempts) {
                    item.initialAttempts = job.attemptsMade;
                    item.attempts = job.maxAttempts;
                    item.backoff = job.backoffMs;
                    item.runAt = new Date(Math.max(new Date(item.runAt).getTime(), Number(job.runAt)));
                }
                else {
                    redisOnly.push({ queue: job.queue, jobId: job.jobId, reason: 'REQUIRES_SOURCE_OR_IN_FLIGHT_REVIEW' });
                }
            }
            if (apply && redisOnly.length)
                throw new Error('Unreconciled Redis jobs require review');
        }
        if (apply && plan.review.length)
            throw new Error('In-flight or uncertain records require review; no import applied');
        if (apply)
            await importPlan(plan.items, client);
        console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', ...plan, redisOnly }, null, 2));
        await client.query('COMMIT');
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
    reconcileMain().catch(() => { console.error('Reconciliation failed; no secrets printed. Review source state and connectivity.'); process.exitCode = 1; }).finally(() => pool.end());
}
