# cPanel runtime dependency and queue audit

## Deployment

`ffmpeg-static` 5.3.0 is a runtime dependency because the social controller imports it during startup. Production pruning must retain it. The application no longer builds TypeScript in `postinstall`; builds are explicit deployment steps.

Activate the Node.js 22 environment using the command shown by cPanel. Keep its `node_modules` symlink. Do not upload Windows dependencies or binaries to Linux.

For a deployment with prebuilt `dist-api` and `dist`:

```bash
npm install --omit=dev --ignore-scripts --no-audit --no-fund
npm rebuild ffmpeg-static --ignore-scripts=false
node scripts/verify-ffmpeg.mjs
```

The selective rebuild runs FFmpeg's installer without invoking an application TypeScript postinstall. It downloads the binary for the server's platform. The verification checks executable access and actually runs `-version`, with a timeout. Download restrictions or host execution restrictions stop deployment; package import success alone is insufficient. A host-supplied executable can instead be selected with the package's `FFMPEG_BIN` environment variable.

Current releases build only in GitHub Actions or locally on Node.js 22. The cPanel script verifies prebuilt artifacts, installs production dependencies in an isolated stage with scripts disabled, then selectively installs and verifies FFmpeg. The project `.npmrc` defaults to `ignore-scripts=true`; the explicit FFmpeg rebuild overrides this for that package only. Deployment preserves the managed application symlink and snapshots the previous dependency directory and npm policy for rollback. Do not run an extra npm installation in the live application directory.

The reported cPanel `tsc: command not found` failure was traced to the actual deployed package.json, which still contained `postinstall: npm run build:api`. The repository removed this hook in commit `25fd073`, but the application folder retained the old manifest. See [the current prebuilt guide](../deploy/PREBUILT.md) for the evidence, install-policy regression and exact future operator steps. No TypeScript or Vite dependency is added to production to compensate for stale deployment state.

## Redis remains required

No secrets or startup dependency semantics were changed. `phase-main.ts` waits for PostgreSQL and Redis before listening. Its HTTP/rate-limit client has finite retries; workers retain indefinite per-request retry behavior. Configure an available Redis TCP/TLS endpoint on the host separately. A valid configuration schema is not a connectivity check.

## Recurring command traffic

| Scheduler | Previous interval | Current interval | Nominal runs/day |
| --- | --- | --- | --- |
| Email outbox | 2 seconds | 10 seconds | 43,200 → 8,640 |
| Publishing maintenance relay | 5 seconds | 30 seconds | 17,280 → 2,880 |
| Knowledge planner | 60 seconds | unchanged | 1,440 |

The first two schedulers now create approximately 81% fewer periodic runs combined. This is not a measured Redis command reduction: job lifecycle Lua scripts, blocking waits, locks, rate limiting and actual workload all contribute. Email pickup may wait about 10 seconds and newly scheduled posts may wait about 30 seconds for the relay, plus processing time. Maintenance also polls YouTube processing, runs festival scans and cleans expired auth sessions, so those operations inherit the new interval.

Queues, retry/backoff policies, worker concurrency, lock duration, lock renewal and stalled checks are preserved. No queue data is cleared and no worker is disabled.

## Worker instances

Previously, documents and knowledge API paths dynamically imported `pdf-worker.js` to call a processing function. That import constructed a PDF Worker and Redis connections in each API process that exercised the path. `pdf-processing.ts` now contains the utility; all those callers import it. `pdf-worker.ts` remains the dedicated consumer and re-exports the utility for compatibility.

`worker.ts` intentionally owns publishing, maintenance, PDF, AI and knowledge consumers. Do not run standalone PDF/AI worker entry points alongside it unless extra concurrency is intentional. `mail-worker.ts` is a separate required process for email delivery. `batch.worker.ts` defines a consumer but is not imported by the current main worker entry point; ensure its separate hosting is configured if batch jobs are used. This change does not add or remove that consumer.

Queue producers in controllers remain intentional. Reused Redis clients do not eliminate BullMQ's separate blocking connection per Worker. A future change could split festival scans and cleanup from the publishing relay; doing so needs separate scheduling and recovery tests.

## Local validation

`npm run test:runtime` compiles the backend and runs isolated tests with mocked PostgreSQL, Redis, SMTP and queue constructors. The tests check queue retry options, scheduler intervals, lock/stall preservation, mail success/retries, PDF import isolation, duplicate-processing leases and a real PDF extraction through mocked persistence.

Additional regression checks:

```text
node scripts/test-social-publish.mjs
node --test scripts/test-youtube-publishing.mjs
node scripts/test-pdf.mjs
npm run build
npm run verify:ffmpeg
```

Tests never load the production `.env`. They do not validate a live cPanel Linux binary or a production Redis endpoint. Verify these on the server before restart, then check `/api/v1/health` and `/api/v1/health/ready`. Compare Redis provider command counters over equal idle and active time windows; preserve all consumers when comparing.

Verified locally on Node.js 22.23.3: backend/frontend production build passed; 9 runtime tests and 13 YouTube publishing tests passed; LinkedIn/Telegram publishing checks and the PDF core checks passed. FFmpeg verification also passed locally on Windows. The frontend build retains its large-chunk warning. Git Bash syntax validation of the deployment script and root manifest/lockfile consistency checks passed. The YouTube scheduler test fixture was updated to supply workspace, caption, media and daily-capacity data required by current validation; application validation was not weakened. Generated frontend build changes were restored to keep this patch focused on runtime fixes.
