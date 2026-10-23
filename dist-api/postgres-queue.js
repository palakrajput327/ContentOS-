import { randomUUID } from 'node:crypto';
export class PostgresQueue {
    database;
    constructor(database) {
        this.database = database;
    }
    async enqueue(queue, name, payload, options, db = this.database) {
        const scope = options.workspaceId || 'system';
        const row = (await db.query(`INSERT INTO queue_jobs
      (id,queue,scope,workspace_id,dedupe_key,name,payload,max_attempts,backoff_ms,run_at,priority,attempts)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT(queue,scope,dedupe_key) DO NOTHING
      RETURNING *`, [randomUUID(), queue, scope, options.workspaceId || null, options.key, name,
            JSON.stringify(payload), options.attempts || 3, options.backoff ?? 10000,
            options.runAt || new Date(), options.priority || 0, options.initialAttempts || 0])).rows[0];
        return (row || (await db.query('SELECT * FROM queue_jobs WHERE queue=$1 AND scope=$2 AND dedupe_key=$3', [queue, scope, options.key])).rows[0]);
    }
    async claim(queues, leaseMs = 180000) {
        const owner = randomUUID();
        return (await this.database.query(`WITH candidate AS (
      SELECT id FROM queue_jobs WHERE state='waiting' AND run_at<=now() AND attempts<max_attempts
      AND queue=ANY($1::text[]) ORDER BY priority DESC,run_at,id
      FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE queue_jobs j SET state='active',owner=$2,lease_until=now()+$3*interval '1 millisecond',
      attempts=attempts+1,updated_at=now() FROM candidate c WHERE j.id=c.id RETURNING j.*`, [queues, owner, leaseMs])).rows[0];
    }
    async heartbeat(job, leaseMs = 180000) {
        return !!(await this.database.query(`UPDATE queue_jobs SET lease_until=now()+$3*interval '1 millisecond',updated_at=now()
      WHERE id=$1 AND owner=$2 AND state='active' AND lease_until>now()`, [job.id, job.owner, leaseMs])).rowCount;
    }
    async settle(job, outcome, result = null, code = null) {
        const retry = outcome === 'retry' && job.attempts < job.max_attempts;
        const state = retry ? 'waiting' : outcome === 'retry' ? 'failed' : outcome;
        const delay = Math.min(job.backoff_ms * 2 ** Math.max(0, job.attempts - 1), 86400000);
        const client = await this.database.connect();
        try {
            await client.query('BEGIN');
            const changed = !!(await client.query(`UPDATE queue_jobs SET state=$3,result=$4,error_code=$5,
      run_at=CASE WHEN $3='waiting' THEN now()+$6*interval '1 millisecond' ELSE run_at END,
      finished_at=CASE WHEN $3='waiting' THEN NULL ELSE now() END,
      owner=NULL,lease_until=NULL,updated_at=now()
      WHERE id=$1 AND owner=$2 AND state='active' AND lease_until>now()`, [job.id, job.owner, state, JSON.stringify(result), code, delay])).rowCount;
            if (changed && state === 'uncertain' && job.queue === 'social-publishing') {
                const records = await client.query(`UPDATE scheduled_posts SET state='UNCERTAIN',error_code=$3
        WHERE id=$1 AND workspace_id=$2 AND state NOT IN ('PUBLISHED','CANCELLED','FAILED','UNCERTAIN')
        RETURNING content_id,content_version`, [job.payload.id, job.workspace_id, code || 'PROVIDER_OUTCOME_UNKNOWN']);
                for (const row of records.rows)
                    await client.query(`UPDATE content SET status='UNCERTAIN',updated_at=now()
        WHERE id=$1 AND workspace_id=$2 AND version=$3`, [row.content_id, job.workspace_id, row.content_version]);
            }
            await client.query('COMMIT');
            return changed;
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async recover(queues) {
        // A lost publishing attempt is never automatically dispatched again.
        // A separate transaction locks expired rows and updates business state together.
        const client = await this.database.connect();
        try {
            await client.query('BEGIN');
            const jobs = (await client.query(`SELECT * FROM queue_jobs WHERE state='active' AND lease_until<now()
        AND queue=ANY($1::text[]) FOR UPDATE SKIP LOCKED LIMIT 100`, [queues])).rows;
            for (const job of jobs) {
                let sourceState;
                if (job.queue === 'social-publishing') {
                    sourceState = (await client.query('SELECT state FROM scheduled_posts WHERE id=$1 AND workspace_id=$2 FOR UPDATE', [job.payload.id, job.workspace_id])).rows[0]?.state;
                    await client.query(`UPDATE scheduled_posts SET state='UNCERTAIN',error_code='INTERRUPTED_ATTEMPT'
            WHERE id=$1 AND workspace_id=$2 AND state NOT IN ('PUBLISHED','CANCELLED','FAILED','UNCERTAIN')`, [job.payload.id, job.workspace_id]);
                    await client.query(`UPDATE content c SET status='UNCERTAIN',updated_at=now() FROM scheduled_posts s
            WHERE s.id=$1 AND s.workspace_id=$2 AND s.state='UNCERTAIN' AND c.id=s.content_id
            AND c.workspace_id=s.workspace_id AND c.version=s.content_version`, [job.payload.id, job.workspace_id]);
                }
                const state = job.queue === 'social-publishing'
                    ? sourceState === 'PUBLISHED' ? 'completed' : sourceState === 'CANCELLED' ? 'cancelled' : sourceState === 'FAILED' ? 'failed' : 'uncertain'
                    : job.attempts >= job.max_attempts ? 'failed' : 'waiting';
                await client.query(`UPDATE queue_jobs SET state=$2,owner=NULL,lease_until=NULL,error_code='INTERRUPTED_ATTEMPT',
          run_at=now()+$3*interval '1 millisecond',updated_at=now(),finished_at=CASE WHEN $2='waiting' THEN NULL ELSE now() END
          WHERE id=$1`, [job.id, state, Math.min(job.backoff_ms * 2 ** Math.max(0, job.attempts - 1), 86400000)]);
            }
            await client.query('COMMIT');
            return jobs.length;
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async acquireLane(lane, owner, leaseMs = 180000) {
        return !!(await this.database.query(`INSERT INTO queue_worker_leases(lane,owner,lease_until)
      VALUES($1,$2,now()+$3*interval '1 millisecond') ON CONFLICT(lane) DO UPDATE SET
      owner=EXCLUDED.owner,lease_until=EXCLUDED.lease_until,last_started_at=now(),last_error=NULL
      WHERE queue_worker_leases.lease_until<now() RETURNING lane`, [lane, owner, leaseMs])).rowCount;
    }
    async renewLane(lane, owner, leaseMs = 180000) {
        return !!(await this.database.query(`UPDATE queue_worker_leases SET lease_until=now()+$3*interval '1 millisecond'
      WHERE lane=$1 AND owner=$2 AND lease_until>now()`, [lane, owner, leaseMs])).rowCount;
    }
    async releaseLane(lane, owner, error = null) {
        await this.database.query(`UPDATE queue_worker_leases SET lease_until=now(),last_finished_at=now(),last_error=$3::text,
      last_success_at=CASE WHEN $3::text IS NULL THEN now() ELSE last_success_at END WHERE lane=$1 AND owner=$2`, [lane, owner, error]);
    }
    async recurring(name, intervalMs, fn) {
        const client = await this.database.connect();
        try {
            await client.query('BEGIN');
            await client.query('INSERT INTO queue_recurring_tasks(name) VALUES($1) ON CONFLICT DO NOTHING', [name]);
            const due = (await client.query(`SELECT name FROM queue_recurring_tasks WHERE name=$1 AND next_run_at<=now()
        FOR UPDATE SKIP LOCKED`, [name])).rowCount;
            if (due) {
                await fn(client);
                await client.query(`UPDATE queue_recurring_tasks SET next_run_at=now()+$2*interval '1 millisecond' WHERE name=$1`, [name, intervalMs]);
            }
            await client.query('COMMIT');
            return !!due;
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
}
