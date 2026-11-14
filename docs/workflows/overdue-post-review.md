# Missed schedule review

Open **Calendar** (`/app/calendar`). When schedules are more than 15 minutes late,
the **Missed schedules — review required** panel appears at the top, independently
of the calendar's selected month and filters. It refreshes every 30 seconds.

- **Publish now:** explicitly releases one account's schedule and queues it for publishing.
- **Reschedule:** chooses a future time for that account. The date input uses the device timezone, shown beside it; schedule labels use the workspace timezone.
- **Discard schedule:** cancels that publication and retains the content. If all its publications are cancelled, the content returns to Draft.
- Every action opens a confirmation dialog. There is no bulk publish action.
- A disconnected/expired account shows **Reconnect required** with a link to Channels. Reconnecting alone does not release an overdue schedule.
- Visual concepts scheduled through document automation also appear, labelled **all target channels**. Their actions apply to the concept's whole channel list. Discard removes the schedule and keeps the concept.

## Enforcement

`server/publishing.ts` checks lateness inside the existing transactional claim,
under the same content/record locks as publishing. It stores
`OVERDUE_REVIEW_REQUIRED` in the existing `scheduled_posts.error_code` field;
no schema migration is required. A held schedule needs explicit review even if
delivered again. The API lists overdue schedules even before a worker marks them.

Both queue relays and the API startup/periodic publisher exclude already held
records. The document visual-concept startup/periodic dispatcher only admits
schedules within the grace window. Restarting workers cannot automatically drain
late schedules into social accounts.

Review endpoints use workspace scoping and `schedule` permission. Review locks
the existing records, checks their version/state, and requires `confirm: true`.
Publish/reschedule reuse account-health checks, daily-slot validation, the queue
adapter, and audit logging. Publishing still goes through subscription,
approval, quota and duplicate-delivery safeguards. Rescheduling creates a fresh
queue delivery; obsolete deliveries cannot publish before the new time.

Failed, processing and uncertain attempts are not eligible for these actions.
They require their existing error/reconciliation workflow to avoid duplicates.

## Verification

- `npm run build:api`
- `npx tsc --noEmit`
- `npx vite build`
- `node --test scripts/test-overdue-ui.mjs` (rendering, permissions, reconnect state)
- `node --experimental-test-module-mocks --test --test-force-exit scripts/test-saas-workflow.mjs` (isolated PostgreSQL/API/cron workflow)
- `node --experimental-test-module-mocks --test --test-force-exit scripts/test-postgres-queue.mjs scripts/test-queue-runtime.mjs`

Deploy the API/worker code and frontend together. Until deployment, the live
installation retains its previous behavior. Tests do not publish to real social accounts.
