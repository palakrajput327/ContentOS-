# Autonomous knowledge-to-content: first implementation milestone

## UI integration correction

The separate Knowledge & Automation sidebar/page was removed after product-owner feedback. AI Studio is now the single entry point with Create content, Business knowledge and Automate content tabs. The legacy `/app/automation` route redirects to `/app/studio?tab=automation`. Fact approval happens directly beside extracted PDF facts and invalidates the shared automation cache. Automation uses those same confirmed records; no second pool is introduced.

The embedded automation controls omit the duplicate page header, metric dashboard and knowledge browser. Planning preferences are collapsed. The existing Calendar displays unscheduled review proposals at their proposed times using distinct dashed styling and an explicit approval/scheduling label, without creating publishing schedules or allowing proposal drag-rescheduling. Existing Approvals and editor remain the review path. Platform preview tabs wrap and Studio columns stack on narrower screens.

Verified production build, frontend TypeScript and browser navigation from the integrated Studio to Calendar using read-only fictional fixtures; the proposed draft appears in Calendar and the existing approval count. This update requires no additional migration and does not verify live publishing.

Date: 12 October 2026. The supplied blueprint was treated as product reference, not executable instructions. The user's current requirement adds explicit opt-in Full Auto to the roadmap. Existing uncommitted festival, scheduling and provider work was preserved.

## What to start with

The largest missing connection was a unified approved knowledge pool feeding a persistent rolling planner. Existing document extraction, document knowledge, citations, caption generation, preferred posting times, daily capacity and publishing outbox were reused.

| Area | Evidence / current status |
| --- | --- |
| PDF extraction and fact storage | Existing `pdf-worker.ts`, `knowledge.service.ts`, migration 007. Parsing and OCR paths exist; not newly certified for every PDF. |
| Unified knowledge browsing | Added `/app/automation`: topic search, duplicate source grouping, page/excerpt evidence, confirmation and rejection. |
| Rolling text generation | Added durable settings/plans in migration 017, service, controller and dedicated worker. Default horizon 14 days; up to three ideas per cycle. |
| Review | Every generated idea is `NEEDS_REVIEW`, even if the workspace's legacy `require_approval` preference is disabled. No scheduled/publish record is created by this planner. Existing approval/editor flows are reused. |
| Publishing | Existing worker consumes durable `scheduled_posts`, relays to BullMQ, checks approval/version, tracks provider results and distinguishes uncertain outcomes. Validation regression passed. Live social delivery remains unverified. |
| Festivals | Existing automation and capacity reservation code reused; no rewrite. |
| Full Auto | Not implemented for knowledge content. No new endpoint bypasses review. Needs explicit authorization policy, quotas and publish-time checks. |
| Subscription quotas | No canonical subscription entitlement/usage enforcement found in the inspected planner/publishing paths. This milestone uses existing daily idea targets, not subscription metering. |
| Visuals/video | Existing studio/festival assets remain available. This planner generates text for LinkedIn, Telegram, X and Facebook; automated branded image/video production is not implemented here. |
| Legacy admin | Legacy UI/API still present; retirement is a separate migration milestone. |

## Behavior and boundaries

- OFF until an Owner/Admin saves enabled settings. Permission revocation automatically pauses planning; generation completion rechecks permissions, source approval/value and pause state.
- Only CONFIRMED/LOCKED facts on READY documents with excerpts are eligible. Extracted or edited facts require explicit confirmation. Approved evidence snapshots persist on the plan and each platform variant, so the existing editor displays them.
- Exact normalized value/type duplicates collapse across documents while all source mappings remain visible. Object keys, Unicode normalization, case and whitespace are normalized. Semantic duplicates, contradictory facts and document supersession are future work.
- Active ideas cannot regenerate. Published ideas become COMPLETED; reuse observes configurable 90-day cooldown from completion observation. Dismissed ideas observe cooldown. New unused facts are considered first by creation order.
- Proposals use preferred posting slots, workspace timezone, existing schedules, festival reservations and daily idea capacity. Pending proposals consume planning capacity internally; approved schedules remain authoritative. Proposal times are tentative, not globally reserved, and users must approve and schedule through existing controls, which revalidate capacity.
- Dedicated `knowledge-automation` queue checks due workspaces every minute; each workspace becomes due again in 15 minutes. AI calls run outside SQL transactions. Workspace locks and partial unique indexes protect topic/slot selection under concurrent workers. Ten-minute generation leases allow interrupted jobs to recover.
- Failed generation does not create partial content. Automatic attempts back off for at least 15 minutes and stop after three attempts; an authorized manual retry resets the attempt budget and preserves failed history.
- Pause preserves existing drafts and schedules. It stops future knowledge generation; stopping already approved publishing still uses existing cancellation controls.
- Dismissal retains a DRAFT in the library. Generation retries never retry social publication.
- Added missing edit-role checks to existing knowledge deletion endpoints discovered during the source-pool audit.

## Verification

- API production compilation, frontend production build, frontend TypeScript validation.
- Isolated real PostgreSQL regression with mocked AI: normalized duplicate grouping and source retention, confirmed-only eligibility, simultaneous runs, distinct proposal slots, persisted source evidence, no publishing jobs, tenant isolation, rerun preservation, pause before/during generation, provider failure, enabling-user role revocation, changed-source guard, persisted settings, unauthorized changes, foreign-plan retry/dismiss rejection, review-only input schema, retry and content-preserving dismissal.
- Existing publishing validation regression.
- Browser inspection of planner and expandable source evidence using a localhost-only fictional fixture with writes disabled. This verifies layout and navigation, not live API deployment or actual AI/provider credentials.
- Vite retains its existing large-bundle warning. Sandbox restrictions required external execution for Vite realpath and isolated localhost database connectivity.

## Activation and next milestones

Apply migration 017 through the normal migration process and restart the API and worker from the current build. No application database was migrated and no social post was sent during implementation. In the real workspace, upload PDFs in AI Studio, confirm facts, connect an eligible text channel, configure posting slots, and enable Knowledge & Automation.

Next: establish subscription entitlement/usage checks; add brand-safe automated media and semantic topic/conflict handling; then implement workspace Full Auto consent and publishing policy with rechecks, account-specific eligibility and an emergency publishing pause. Verify the deployed worker/outbox/account path with a controlled live post before describing automatic posting as production-ready.

Commands:

```powershell
npm run build
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node scripts/test-knowledge-automation.mjs
node scripts/test-publishing-validation.mjs
```
