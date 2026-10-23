import { pool } from './db.js';
import { loadConfig } from './config.js';
import { queueBackend } from './queue-backend.js';
export async function executeCronJob(job) {
    const p = job.payload, wid = job.workspace_id;
    if (wid && p.workspaceId !== wid)
        return { outcome: 'failed', code: 'TENANT_MISMATCH' };
    switch (job.queue) {
        case 'social-publishing': {
            const record = (await pool.query('SELECT id FROM scheduled_posts WHERE id=$1 AND workspace_id=$2', [p.id, wid])).rows[0];
            if (!record)
                return { outcome: 'failed', code: 'SOURCE_NOT_FOUND' };
            const { executePublishRecord } = await import('./publishing.js');
            const result = await executePublishRecord(p.id, { attemptsMade: job.attempts - 1, maxAttempts: job.max_attempts });
            return { outcome: result.state === 'UNCERTAIN' ? 'uncertain' : result.retry ? 'retry' : result.success || result.state === 'SKIPPED_OR_TERMINAL' ? 'completed' : 'failed', result, code: result.error };
        }
        case 'pdf-processing': {
            const { processPDFDocument } = await import('./pdf-processing.js');
            return { outcome: 'completed', result: await processPDFDocument(p.documentId, wid) };
        }
        case 'content-generation': {
            const source = (await pool.query('SELECT id,status FROM ai_generations WHERE id=$1 AND workspace_id=$2', [p.generationId, wid])).rows[0];
            if (!source)
                return { outcome: 'failed', code: 'SOURCE_NOT_FOUND' };
            if (source.status === 'COMPLETED')
                return { outcome: 'completed' };
            if (job.attempts > 1)
                await pool.query("UPDATE ai_generations SET status='QUEUED' WHERE id=$1 AND workspace_id=$2 AND status IN ('PROCESSING','FAILED')", [p.generationId, wid]);
            if (p.forcePdf) {
                const { processPDFDocument } = await import('./pdf-processing.js');
                await processPDFDocument(p.documentId, wid, { force: true, skipKnowledge: true });
            }
            const { KnowledgeService } = await import('./knowledge/knowledge.service.js');
            await new KnowledgeService().processKnowledgeExtraction(p.generationId, p.documentId, wid);
            return { outcome: 'completed' };
        }
        case 'batch-processing': {
            const { processBatch } = await import('./batch/batch-processing.js');
            await processBatch({ data: { batchId: p.batchId, workspaceId: wid } });
            return { outcome: 'completed' };
        }
        case 'auth-email-dispatch': {
            const { deliverEmails } = await import('./mail.js');
            const { requireMail } = await import('./codes.js');
            requireMail();
            await deliverEmails({ limit: 5, budgetMs: 30000 });
            return { outcome: 'completed' };
        }
        case 'youtube-processing': {
            const { pollYouTubeProcessing } = await import('./youtube.service.js');
            await pollYouTubeProcessing();
            return { outcome: 'completed' };
        }
        case 'festival-automation': {
            const { FestivalAutoSchedulerService } = await import('./calendar/festival-auto-scheduler.js');
            const result = await FestivalAutoSchedulerService.runFestivalAutoScheduler(pool);
            return { outcome: result.errors.length ? 'retry' : 'completed', result };
        }
        case 'knowledge-automation': {
            const { KnowledgeAutomationService } = await import('./knowledge/automation.service.js');
            const rows = (await pool.query('SELECT workspace_id FROM knowledge_automation_settings WHERE enabled=true AND next_run_at<=now() ORDER BY next_run_at LIMIT 10')).rows;
            for (const row of rows)
                await new KnowledgeAutomationService().run(row.workspace_id);
            return { outcome: 'completed' };
        }
        case 'queue-maintenance':
            await pool.query('DELETE FROM api_rate_limits WHERE expires_at<now()');
            await pool.query('DELETE FROM auth_sessions WHERE absolute_expires_at<now()');
            return { outcome: 'completed' };
        default: return { outcome: 'failed', code: 'UNKNOWN_QUEUE' };
    }
}
async function main() {
    loadConfig();
    if (queueBackend() !== 'postgres')
        throw new Error('Invalid backend');
    const [id, owner] = process.argv.slice(2);
    const job = (await pool.query(`SELECT * FROM queue_jobs WHERE id=$1 AND owner=$2 AND state='active' AND lease_until>now()`, [id, owner])).rows[0];
    if (!job)
        throw new Error('Job ownership lost');
    let busy = false;
    const guard = setInterval(async () => {
        if (busy)
            return;
        busy = true;
        try {
            if (!(await pool.query(`SELECT 1 FROM queue_jobs WHERE id=$1 AND owner=$2 AND state='active' AND lease_until>now()`, [id, owner])).rowCount)
                process.exit(2);
        }
        catch {
            process.exit(2);
        }
        finally {
            busy = false;
        }
    }, 5000);
    try {
        const result = await executeCronJob(job);
        if (process.send)
            await new Promise((resolve, reject) => process.send({ type: 'outcome', value: result }, error => error ? reject(error) : resolve()));
    }
    finally {
        clearInterval(guard);
        while (busy)
            await new Promise(r => setTimeout(r, 10));
    }
}
// Only executed as a child; importing handlers creates no workers.
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
    main().catch(() => { process.exitCode = 1; }).finally(async () => { await pool.end(); process.disconnect?.(); });
}
