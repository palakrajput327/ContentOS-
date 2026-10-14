# Changed-file report

The worktree includes the previous approved FFmpeg/runtime fixes. Files labelled "Earlier runtime fix" were already changed before the PostgreSQL queue task; no new cPanel configuration or deployment-script edits were made in this phase. No .env or production secrets were modified.

| File | Scope | Git status |
| --- | --- | --- |
| .cpanel.yml | Earlier runtime fix | Modified |
| app.mjs | PostgreSQL queue implementation/testing | Modified |
| deploy/cpanel-deploy.sh | Earlier runtime fix | Modified |
| package-lock.json | Earlier runtime fix | Modified |
| package.json | PostgreSQL queue implementation/testing | Modified |
| scripts/test-youtube-publishing.mjs | Earlier runtime fix | Modified |
| server/admin.controller.ts | PostgreSQL queue implementation/testing | Modified |
| server/ai-worker.ts | PostgreSQL queue implementation/testing | Modified |
| server/batch/batch.service.ts | PostgreSQL queue implementation/testing | Modified |
| server/batch/batch.worker.ts | PostgreSQL queue implementation/testing | Modified |
| server/calendar/festival.controller.ts | PostgreSQL queue implementation/testing | Modified |
| server/config.ts | PostgreSQL queue implementation/testing | Modified |
| server/db.ts | PostgreSQL queue implementation/testing | Modified |
| server/documents/documents.controller.ts | PostgreSQL queue implementation/testing | Modified |
| server/knowledge/automation.worker.ts | PostgreSQL queue implementation/testing | Modified |
| server/knowledge/knowledge.controller.ts | PostgreSQL queue implementation/testing | Modified |
| server/knowledge/knowledge.service.ts | PostgreSQL queue implementation/testing | Modified |
| server/mail-worker.ts | PostgreSQL queue implementation/testing | Modified |
| server/mail.ts | PostgreSQL queue implementation/testing | Modified |
| server/main.ts | PostgreSQL queue implementation/testing | Modified |
| server/migrate.ts | PostgreSQL queue implementation/testing | Modified |
| server/pdf-worker.ts | PostgreSQL queue implementation/testing | Modified |
| server/phase-main.ts | PostgreSQL queue implementation/testing | Modified |
| server/queues.ts | PostgreSQL queue implementation/testing | Modified |
| server/worker.ts | PostgreSQL queue implementation/testing | Modified |
| docs/CPANEL_RUNTIME_FIXES.md | Earlier runtime fix | New |
| docs/POSTGRES_QUEUE_DEPLOYMENT.md | PostgreSQL queue implementation/testing | New |
| scripts/test-mail-runtime.mjs | Earlier runtime fix | New |
| scripts/test-pdf-runtime.mjs | Earlier runtime fix | New |
| scripts/test-postgres-queue.mjs | PostgreSQL queue implementation/testing | New |
| scripts/test-queue-runtime.mjs | Earlier runtime fix | New |
| scripts/verify-ffmpeg.mjs | Earlier runtime fix | New |
| server/batch/batch-processing.ts | PostgreSQL queue implementation/testing | New |
| server/bullmq-export.ts | PostgreSQL queue implementation/testing | New |
| server/bullmq-worker.ts | PostgreSQL queue implementation/testing | New |
| server/cron-job.ts | PostgreSQL queue implementation/testing | New |
| server/cron-runtime.ts | PostgreSQL queue implementation/testing | New |
| server/cron-tasks.ts | PostgreSQL queue implementation/testing | New |
| server/cron-worker.ts | PostgreSQL queue implementation/testing | New |
| server/migrations/023_postgres_queue.sql | PostgreSQL queue implementation/testing | New |
| server/pdf-processing.ts | PostgreSQL queue implementation/testing | New |
| server/postgres-queue.ts | PostgreSQL queue implementation/testing | New |
| server/publishing.ts | PostgreSQL queue implementation/testing | New |
| server/queue-backend.ts | PostgreSQL queue implementation/testing | New |
| server/queue-reconcile.ts | PostgreSQL queue implementation/testing | New |
| server/rate-limiter.ts | PostgreSQL queue implementation/testing | New |
| docs/POSTGRES_QUEUE_CHANGED_FILES.md | This report | New |
| docs/POSTGRES_QUEUE_TEST_RESULTS.md | Final validation results | New |

Generated frontend build changes were restored after successful build verification. dist-api is a generated, ignored local build output.
