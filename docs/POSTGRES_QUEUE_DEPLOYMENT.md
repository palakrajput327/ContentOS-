# PostgreSQL queue: implementation, validation and operator checklist

## Approval boundary

This implementation is local only. Production SQL, .env, cPanel configuration and cron jobs have not been changed. BullMQ remains installed and is the default when QUEUE_BACKEND is unset. All commands below that target the server are an operator plan, not instructions that have already been executed. Migration, import, backend selection, worker shutdown and cron activation require explicit production approval.

## Architecture and preserved functionality

- `QUEUE_BACKEND=postgres` selects a PostgreSQL producer adapter. It never constructs Redis clients. Both API bootstrap implementations use PostgreSQL rate-limit counters in this mode. Authentication, CSRF/origin checks, password hashing and tenant membership checks remain active.
- `QUEUE_BACKEND=bullmq` preserves the legacy producer/consumer path and requires Redis. Legacy worker entry points reject PostgreSQL mode with an instruction to use cron.
- Queue records use stable deduplication keys scoped by queue and workspace. Queue insertion can participate in the same transaction as document, generation or batch creation. Claims use a short `FOR UPDATE SKIP LOCKED` transaction. Network work runs outside that claim transaction.
- Renewable lane leases prevent two active cron invocations from admitting work in one lane. Job leases and owner tokens fence stale acknowledgements. Lease-loss aborts the active child. Each child verifies current ownership during execution. A signal stops admission and drains/terminates the bounded child; timers, IPC and database connections are closed.
- Social publishing keeps business-record claims, content versions, cancellation, account checks, terminal states and published-record uniqueness. Ambiguous provider responses, killed publishing children and expired publishing leases require verification. They are not automatically sent again. PostgreSQL jobs never replace or delete existing `scheduled_posts` rows.
- The priority lane dispatches existing encrypted email-outbox records, publishes due posts and polls YouTube processing. Email dispatch preserves expiry, test-message isolation, SMTP backoff and terminal failure behavior. It checks expiry again immediately before sending. Mail bodies and encryption keys are not copied into queue payloads.
- The background lane handles PDF extraction, knowledge/AI, batches, festival automation, knowledge automation and cleanup. PDF completion and its automatic AI enqueue commit together in PostgreSQL mode. AI retries reset an interrupted generation's processing state; deterministic fact identifiers avoid duplicate persisted facts with the same generation/type/key. Already completed generations are skipped.
- Batch children commit business changes and completion together. Completed children are skipped on replay. Tenant checks apply to child claims and queue producers. Review rejection preserves `updated_by` while clearing approval.
- Festival generation retains existing workspace eligibility and approval settings. Manual-review workspaces still get `NEEDS_REVIEW` drafts. The queue change does not approve them or turn on auto-publishing.
- Automatic PDF work no longer runs inside API requests in PostgreSQL mode. The fast-track endpoint returns `QUEUED`; processing results become available through the existing status endpoints. Explicit legacy synchronous behavior remains in BullMQ mode.

## Migration 023: not applied to production

`server/migrations/023_postgres_queue.sql` adds queue jobs, lane/resource leases, recurring task state and rate-limit counters with appropriate indexes. It also adds `batch_jobs.updated_at` and `batch_child_items.item_index` if absent: existing consumer code relied on these columns, but earlier checked-in migrations did not create them. Existing columns and values are not replaced. Old batch items default to index 0; their precise original input ordering may require review.

No migration runs from installation, startup or cron. The migration command supports `--list` (read-only) and `--only=023_postgres_queue.sql`; a named nonexistent migration is rejected. Running the old unqualified migration command still applies all pending migrations, so use the scoped command during the approved cutover.

## Scheduling and resource limits

Use two separate once-per-minute cron entries. A lane normally admits work for 45 seconds, then finishes one child. Each child has a 90-second timeout and a five-second termination grace. The invocation's watchdog stops further work after budget + 95 seconds. The next minute's invocation skips a live lane rather than racing it. Leases default to 180 seconds and renew every ten seconds.

Email tasks have highest priority and process at most five messages per dispatch with a 30-second admission budget. With no backlog, minute-cron pickup is approximately 0–60 seconds plus worker/SMTP time. This is not a guaranteed production delivery SLA. A backlogged priority lane increases latency; monitor pending age. Large PDFs, OCR, batch operations or uploads that cannot finish within the child deadline may exhaust retries. Repeated API/LLM calls can occur for interrupted non-publishing work. No universal exactly-once guarantee exists for SMTP or external social APIs. Publishing prefers an uncertain/manual-verification outcome to a duplicate post.

The queue adds no hosting service, but consumes existing PostgreSQL CPU, connections and storage. Queue history is retained; there is no automatic deletion of historical scheduled work. Set a reviewed retention policy later. SQL counters are cleaned by the maintenance task. Shared-host limits and PostgreSQL plan usage still require observation.

## Local verification

```bash
npm run test:postgres-queue
npm run test:runtime
node --test scripts/test-youtube-publishing.mjs scripts/test-llm-fallback.mjs
node scripts/test-social-publish.mjs
node scripts/test-pdf.mjs
npm run build
npm run verify:ffmpeg
```

The PostgreSQL suite always creates a fresh loopback-only temporary cluster and database, overrides DATABASE_URL before application imports, changes to a temporary directory and never loads production .env. It applies migrations only in that database. SMTP, LLM and social providers are fixtures; no real emails or posts are sent. The installed embedded PostgreSQL runtime is 17.10; production PostgreSQL 18.6 is not contacted or empirically tested here. The SQL features used are supported in PostgreSQL 18, but staging/server validation remains necessary.

Coverage includes deduplicated and transactional enqueue, concurrent claims, delays, retry exhaustion, leases, stale-owner fencing, overlapping cron runs, abort/drain, an abruptly exited OS process, bounded child timeout, social duplicate delivery and uncertainty, tenant-forgery rejection, batch replay, reconciliation idempotency, OTP expiry/test isolation and simulated minute-cron latency, atomic rate limits, PDF→AI queue processing, interrupted AI recovery, festival manual review and an API that starts with no REDIS_URL and no Redis client.

The OTP fixture ages an email by 59 seconds and measures pickup latency. This tests the minute-cron scheduling model and expiry filters; it is not an end-to-end cPanel clock or Gmail latency measurement. Existing password-only login behavior is retained; the queue migration does not enable an optional login OTP flow that the current controller has disabled.

## Read-only reconciliation tools

After separate approval for server inspection, activate the Node 22 environment and run:

```bash
cd /home/hindust1/api.hidustansocialnetwork.in
source /home/hindust1/nodevenv/api.hidustansocialnetwork.in/22/bin/activate
node --env-file=.env dist-api/migrate.js --list
node --env-file=.env dist-api/queue-reconcile.js > /home/hindust1/contentos-queue-plan.json
```

The default reconciliation command uses a read-only transaction. It identifies recoverable schedules, queued documents, document-knowledge generations and batches; in-flight or uncertain records are listed for review. Emails remain in the existing outbox. The report contains record identifiers, not credentials or decrypted values.

If Redis becomes readable, stop legacy consumers and capture their inventory without starting workers:

```bash
node --env-file=.env dist-api/bullmq-export.js > /home/hindust1/contentos-bullmq-inventory.json
node --env-file=.env dist-api/queue-reconcile.js --redis-export=/home/hindust1/contentos-bullmq-inventory.json > /home/hindust1/contentos-queue-plan.json
```

The export suppresses queue metadata updates and exposes source identifiers, states, attempts, delay timing and payload field names only. It does not delete or mutate jobs. Redis quota exhaustion may prevent the inventory. Active/failed/unmatched jobs need explicit review. A matching inventory carries attempt limits, attempts already used, backoff and delayed timing into the import. Recurring dispatchers are recreated from application state; they are not imported as arbitrary queue payloads.

Database-only recovery cannot prove that all Redis-only payloads have been recovered or reproduce their retry counters. It requires a separate explicit acceptance flag and operator approval; it is not the default import policy. Reconciliation/import must occur while old consumers and new cron entries are stopped and queue-producing API requests are quiesced. Otherwise a snapshot is not a cutover boundary.

## Exact deployment checklist — requires production approval

1. Save the current application artifact and configuration securely. Record existing cron/worker commands, queue source counts, pending migration names and all in-flight or uncertain publications. Confirm PostgreSQL schema ownership/ALTER permissions for the two additive batch columns. Confirm Node 22, SMTP, FFmpeg execution and shared-host child runtime limits.
2. Prepare the tested artifact locally/CI. Install on cPanel with lifecycle scripts disabled; explicitly install and verify FFmpeg. Keep the CloudLinux `node_modules` symlink. Do not migrate, set the backend or start workers in this step.

```bash
npm install --omit=dev --ignore-scripts --no-audit --no-fund
npm rebuild ffmpeg-static --ignore-scripts=false
node scripts/verify-ffmpeg.mjs
```

3. Stop all old publishing, mail, PDF, AI, batch and automation consumers. Quiesce queue-producing API requests. Wait for active attempts to finish or classify them for verification. Keep old Redis jobs and application tables intact.
4. Apply only the approved additive migration:

```bash
node --env-file=.env dist-api/migrate.js --only=023_postgres_queue.sql
```

5. Obtain and review a fresh reconciliation plan and Redis inventory if possible. Resolve every active/uncertain record without blindly republishing. Approve the exact import report before using either write command below:

```bash
# Preferred, when the reviewed Redis inventory is available:
node --env-file=.env dist-api/queue-reconcile.js --apply --confirm-workers-stopped --redis-export=/home/hindust1/contentos-bullmq-inventory.json

# Alternative ONLY after explicitly accepting the documented recovery gaps:
node --env-file=.env dist-api/queue-reconcile.js --apply --confirm-workers-stopped --accept-database-only-recovery
```

The importer runs in a transaction, serializes concurrent imports, refuses unresolved source-state review items and does not overwrite existing queue payloads or scheduled records. An apply failure rolls back the import. Unmatched Redis inventory entries also block the preferred import.

6. With explicit approval, set only `QUEUE_BACKEND=postgres` in the production application environment. Preserve ENCRYPTION_KEY and every other secret. Restart the API and verify `/api/v1/health/ready` reports `queueBackend: postgres` and `redis: disabled`. Verify authenticated access, cross-workspace rejection and rate limits.
7. Add these two cPanel Cron Jobs, each with schedule `* * * * *`:

```bash
/bin/bash -lc 'cd /home/hindust1/api.hidustansocialnetwork.in && source /home/hindust1/nodevenv/api.hidustansocialnetwork.in/22/bin/activate && node --env-file=.env dist-api/cron-worker.js --lane=priority --budget-seconds=45' >> /home/hindust1/contentos-cron-priority.log 2>&1
```

```bash
/bin/bash -lc 'cd /home/hindust1/api.hidustansocialnetwork.in && source /home/hindust1/nodevenv/api.hidustansocialnetwork.in/22/bin/activate && node --env-file=.env dist-api/cron-worker.js --lane=background --budget-seconds=45' >> /home/hindust1/contentos-cron-background.log 2>&1
```

8. Verify fresh lane success timestamps, no accumulating active leases, pending-job age, OTP delivery/expiry, controlled publishing and festival drafts. Health readiness checks database/schema availability; it does not prove that cron is configured or jobs are being processed. Retain legacy BullMQ code and data during observation.

Useful read-only SQL after approval:

```sql
SELECT queue,state,count(*) FROM queue_jobs GROUP BY queue,state ORDER BY queue,state;
SELECT lane,last_started_at,last_finished_at,last_success_at,last_error
FROM queue_worker_leases WHERE lane IN ('priority','background');
SELECT min(run_at) AS oldest_due FROM queue_jobs WHERE state='waiting' AND run_at<=now();
```

## Exact rollback checklist — requires production approval

1. Disable the two PostgreSQL cron entries and quiesce new work. Allow children to finish, or stop them and explicitly review interrupted publications. Confirm no active lane/job lease remains before enabling another publisher.
2. Preserve PostgreSQL queue rows, schedules, encrypted records and the additive schema. Do not drop tables, reset statuses en masse, or delete old Redis jobs.
3. If Redis is usable, reconcile jobs created/processed since cutover against source records and old Redis state. Exclude published, cancelled, uncertain and in-flight attempts from automatic replay. Move only explicitly approved, unattempted work back to the legacy backend.
4. Restore the previous artifact/backend configuration and restart the API; then restart only the approved legacy consumers. Never leave PostgreSQL cron publishers and BullMQ publishers active together.
5. If Redis is still unavailable/quota-blocked, changing back to BullMQ will reintroduce the outage. The safe fallback is to keep the PostgreSQL API running with cron processing paused until an operator approves recovery. Do not claim that a Redis-less BullMQ rollback restores service.
6. Verify authentication, pending schedules, account statuses and delivery counts before reopening traffic. Keep the migration and reconciliation reports for auditing.

## Remaining limitations and approval items

- Production PostgreSQL 18.6, cPanel process limits, provider delivery latency and Linux FFmpeg have not been exercised by local tests.
- Large PDF/video/AI workloads can exceed the child timeout. PDF parsing restarts on retry; there is no resumable per-page OCR or generic LLM response checkpoint. Persisted AI fact identifiers prevent repeated facts with the same key, but interrupted AI calls may consume provider quota again.
- External exactly-once publishing is not guaranteed; uncertain attempts intentionally block automatic resend. SMTP accepted-but-unrecorded outcomes can also duplicate delivery on recovery.
- Existing Redis-only jobs and interrupted legacy batch/document work require reconciliation. Historical batch ordering may not be recoverable where the old schema lacked `item_index`.
- PostgreSQL history and rate counters use existing storage/compute. No additional hosting service is required, but no production resource/SLA claim is made.
- Legacy database TLS behavior is retained for remote hosts; local loopback tests disable TLS. Reviewing existing remote TLS certificate verification is a separate security task.
- No production schema change, import, .env edit, restart, cron activation, commit, push or deployment was authorized or performed in this local implementation phase.
