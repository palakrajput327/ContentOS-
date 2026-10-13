# Festival Automation — Phases 3A, 3B and 3C

Implemented in the smm-panel-5 workspace on 10 October 2026. Existing uncommitted Phase 1/2 and provider changes were preserved.

## Delivered

- **3A:** Festival Automation navigation and active application route; persisted workspace controls for generation, publishing, approval, eligible accounts, region, language, preparation days, posting time, timezone and daily target. Generation and publishing are separate controls. Real workspace brand details appear in the 1080×1080 SVG preview. Fixed the preview date expression returning January 1 instead of the actual festival date.
- **3B:** Live database monitoring, per-account publishing states/errors, reconnect links, history and poster links; manual approval and scheduling; safe publishing retries; generation retries for failed records with no content. Uncertain or already published jobs cannot be retried. Completed/failed Redis jobs are removed before returning the durable outbox record to PENDING. The publishing worker remains responsible for execution.
- **3C:** Configurable daily target (default 3, range 1–50), shared workspace capacity across content sources, festival reservations, distinct-content counting across platforms, 10-minute conflict checks, and a dashboard daily notice. Workspace row locks serialize scheduling decisions. Existing schedules are preserved; automatic festival content uses the next available time on the same local date. Regular and batch scheduling consume the shared budget. Slot suggestions honor it and no longer return an unchecked fallback time.
- Repaired legacy calendar queries using nonexistent scheduled_posts.scheduled_at/status columns and replaced its destructive reschedule implementation with versioned durable outbox records. Only explicit user rescheduling changes existing schedules; started publishing attempts are protected.

PDF **generation/automation** remains separate future work. Existing PDF-origin content uses the same regular or batch scheduling controls and therefore shares festival capacity; no independent PDF campaign scheduler was added.

## Files changed for this work

- `server/migrations/016_daily_posting.sql`
- `server/calendar/daily-posting.ts`
- `server/calendar/festival.controller.ts`
- `server/calendar/festival.service.ts`
- `server/calendar/festival-auto-scheduler.ts`
- `server/calendar/auto-scheduler.ts`
- `server/calendar/calendar.controller.ts`
- `server/content.controller.ts`
- `server/batch/batch.worker.ts`
- `src/pages/FestivalAutomation.tsx`
- `src/pages/festival.css`
- `src/components/DailyPostingNotice.tsx`
- `src/pages/Overview.tsx`
- `src/components/Shell.tsx`
- `src/App.tsx`
- `src/AuthApp.tsx` (the active frontend router)
- `scripts/test-festival-phase3.mjs`
- This report.

## Verification

Passed production API/frontend build and frontend TypeScript validation. Vite reports the existing large-bundle advisory.

Passed Phase 1 automation, Phase 2 mock publishing, publishing-validation and festival-poster regression scripts. The poster regression reports its existing SVG fallback in this environment; its PASS output does not establish real JPEG conversion or production image publishing readiness.

The new Phase 3 suite uses a separate real PostgreSQL database, launches bundled Windows PostgreSQL on a randomized localhost port, and stops it after testing. It verifies:

- Settings save/reload, OFF defaults and target constraints.
- Invalid times, unauthorized roles and foreign/disconnected account rejection.
- Workspace isolation for monitoring, settings, approval and retry actions.
- Manual approval schedules once, records approval, and rejects duplicate actions.
- Branded preview has the correct festival date and company name.
- Uncertain publication cannot be retried; failed generation retries cannot delete content-bearing records.
- Multi-account content counts as one daily post, published festivals consume their reservation, and cancelled records release capacity.
- Approved schedules are preserved, timezone allocation and time conflicts are enforced.
- Two simultaneous transactions cannot overbook the final daily slot.

## Running the updated application

Apply migrations through the project's normal migration command, including 014, 015 and **016** as appropriate, then restart/redeploy the API and worker with the new build. No deployment database was migrated and no real social post was sent by this work.

Browser inspection confirmed the new navigation and route load locally. The currently running API at localhost:3001 serves an older version and returns `Cannot GET /api/v1/calendar/festivals/settings`; full dashboard visual verification against the running API remains pending its restart and migrations. Database/controller verification above used the isolated test database.

For live publishing verification, the deployment needs its database, Redis, API, worker, object storage, actual JPEG renderer and valid connected social accounts. Connect accounts through the application rather than sharing tokens in chat.

Commands:

```powershell
npm run build
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node scripts/test-festival-phase3.mjs
node scripts/test-festival-automation.mjs
node scripts/test-festival-phase2.mjs
node scripts/test-publishing-validation.mjs
node scripts/test-festival-poster.mjs
```
