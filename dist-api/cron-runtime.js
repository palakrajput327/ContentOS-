import { randomUUID } from 'node:crypto';
export const lanes = {
    priority: ['auth-email-dispatch', 'social-publishing', 'youtube-processing'],
    background: ['pdf-processing', 'content-generation', 'batch-processing', 'festival-automation', 'knowledge-automation', 'queue-maintenance'],
};
export async function runCron(queue, options) {
    const owner = randomUUID(), lane = options.lane;
    const leaseMs = options.leaseMs || 180000;
    if (!await queue.acquireLane(lane, owner, leaseMs))
        return { skipped: true, processed: 0 };
    const stop = new AbortController();
    const onStop = () => stop.abort();
    options.signal?.addEventListener('abort', onStop, { once: true });
    if (options.signal?.aborted)
        stop.abort();
    let active, busy = false, lost = false, processed = 0;
    const started = Date.now();
    const heartbeat = setInterval(async () => {
        if (busy)
            return;
        busy = true;
        try {
            if (!await queue.renewLane(lane, owner, leaseMs) || (active && !await queue.heartbeat(active, leaseMs))) {
                lost = true;
                stop.abort();
            }
        }
        catch {
            lost = true;
            stop.abort();
        }
        finally {
            busy = false;
        }
    }, options.heartbeatMs || 10000);
    let failure = null;
    try {
        await queue.recover(lanes[lane]);
        if (!stop.signal.aborted)
            await options.prepare?.();
        while (!stop.signal.aborted && Date.now() - started < (options.budgetMs ?? 45000)) {
            active = await queue.claim(lanes[lane], leaseMs);
            if (!active)
                break;
            let outcome;
            try {
                outcome = await options.handle(active, stop.signal);
            }
            catch {
                outcome = { outcome: active.queue === 'social-publishing' ? 'uncertain' : 'retry', code: 'HANDLER_INTERRUPTED' };
            }
            if (lost)
                throw new Error('WORKER_LEASE_LOST');
            if (!await queue.settle(active, outcome.outcome, outcome.result, outcome.code || null)) {
                throw new Error('JOB_LEASE_LOST');
            }
            processed++;
            active = undefined;
        }
        return { skipped: false, processed };
    }
    catch (error) {
        failure = error instanceof Error ? error.message : 'CRON_FAILED';
        throw error;
    }
    finally {
        clearInterval(heartbeat);
        options.signal?.removeEventListener('abort', onStop);
        // Wait for a running heartbeat before the caller closes the database pool.
        while (busy)
            await new Promise(resolve => setTimeout(resolve, 10));
        if (!lost)
            await queue.releaseLane(lane, owner, failure);
    }
}
