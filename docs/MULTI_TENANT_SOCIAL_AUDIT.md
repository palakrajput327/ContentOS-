# ContentOS multi-tenant social connections: audit and local safety pass

Audit date: 15 October 2026. Phase 1 inventory/trace completed before application
changes. This is an enhancement of the existing providers, controllers, encrypted
token tables and queue backends. No production connection, environment, data,
migration, queue activation, commit, push or deployment is authorized by this report.

## Evidence matrix (baseline before this pass)

| Area | Status | Evidence and minimal action |
| --- | --- | --- |
| Signup, verification, login, refresh/logout | Implemented; local regression required | `phase-auth.controller.ts`: hashed passwords, verified-email sessions, hashed access/refresh tokens, rotation/replay checks. Preserve semantics. |
| Workspace provisioning and switching | Implemented | `workspace-session.ts`: first verified user gets Owner workspace + brand kit; membership-checked selection. No new provisioning flow needed. |
| Join workspace / RBAC | Implemented, invite UX incomplete | `workspace.controller.ts`: Owner/Admin adds an existing registered user by email; no emailed invitation-acceptance flow. Guards check membership and role; preserve ownership. |
| Platform credentials vs tenant credentials | Implemented; misleading UI | App client IDs/secrets/redirects stay backend-only. Connections store workspace-encrypted access tokens, destination IDs and YouTube refresh tokens. UI currently tells ordinary users to edit .env; replace with administrator-facing setup guidance. |
| Facebook / Instagram OAuth | Implemented, incomplete | Existing Meta user-token discovery and pending Page selector encrypt tokens. Pending selection is user/workspace scoped. Facebook-only Page is incorrectly rejected without Instagram; document/limit this pass to explicit low-risk fixes. |
| LinkedIn / YouTube connection UI | Implemented, environment-dependent | Manage.tsx -> social controller -> provider validation -> encrypted database. App configuration/review is an operator responsibility, not per-user .env changes. |
| OAuth state | Broken safety invariants | Generic callback selects a state without provider/session binding and consumes only after network exchange; PhaseGuard does not set sessionHash; Meta consumes separately. Fix shared one-use claim bound to provider, browser session, active user and current managing membership. |
| X OAuth | Incomplete/broken | Constant code_verifier with no authorization challenge; generic connection validates via users/me, but scheduled legacy adapter has no refresh and may simulate success. Minimal PKCE repair needs one additive nullable encrypted-verifier column; publishing/refresh gaps remain release gates. |
| Telegram | Implemented, validation incomplete | UI accepts per-user bot/channel values, database encrypts token. Validator currently accepts failed/non-admin getChatMember responses; fail closed and keep useful safe errors. |
| Same-platform multiple accounts | Missing; cross-layer change required | Migration 002 has UNIQUE(workspace_id,platform), every connector upserts that key. Composer .find(), schedule .rows[0], calendar cardinality, batch/festival account selection assume one per platform. Do not relax uniqueness in isolation and silently change publishing destinations. |
| Token encryption / tenant boundary | Implemented, legacy compatibility gaps | AES-256-GCM with workspace AAD; older publishing adapter expects workspace:account AAD. Centralize compatible reads without changing stored values/keys. Never return credentials in account lists. |
| Expiry and refresh | Partial | YouTube serializes refresh under token-row lock and handles invalid_grant. Generic callback drops LinkedIn/X expiry and X refresh data. Other provider refresh is incomplete; reconnect must remain explicit where unsupported. |
| Disconnect / history | Broken for previously scheduled accounts | DELETE social_accounts conflicts with scheduled_posts FK. Soft-disconnect + remove only that workspace's credentials; retain schedules, published IDs and audit history. In-flight remote sends cannot be undone. |
| Publishing tenant/account resolution | Implemented; regression required | API constrains account_id+workspace_id; queues use stored schedule account and tenant; database has composite FKs. Preserve claims, retries and UNCERTAIN handling. |
| Daily scheduling capacity | Implemented, not billing | daily-posting.ts locks workspace and checks daily target/festival reservations/spacing. This is an operational planning preference, not a plan/trial allowance. |
| Storage quota / provider credits | Implemented, not posting entitlements | Migration 019 + storage-budget lock byte budget. Clipdrop credit headers describe upstream provider balance, not per-workspace credits. |
| Trial, paid plan, account/member/workspace/post/AI allowance | Missing | No entitlement/subscription/trial/usage ledger in 001-023 or controller/worker paths. Propose below; do not invent commercial amounts or pretend current APIs enforce trial limits. |
| PostgreSQL queue without Redis | Implemented | queue-backend, queues, postgres-queue, cron-* and rate-limiter select PostgreSQL path; preserve routing/leases/dedupe and test with isolated PostgreSQL and no REDIS_URL. |
| Approval, AI Studio, festival/drip planning | Implemented with existing tests | Existing approval versions, daily locks and automation review state must remain unchanged. No need to replace provider or publishing architecture. |

## Scope of the local implementation

Apply only narrow security/integration fixes to existing paths: OAuth state/session
binding and atomic consumption, X PKCE, operator-vs-user configuration guidance,
safe connection errors, Telegram permission validation, legacy token decryption,
and history-preserving disconnect. Do not implement a parallel provider registry,
change workspace ownership, remove old credential variables, invent trial limits,
or enable a new queue backend. Account multiplicity and commercial entitlements
need the coordinated designs below; they are not silently enabled in this pass.

## Required entitlement design (proposal, not active enforcement)

Reuse workspaces/users/members, content, scheduled_posts, published_posts and
ai_generations. Add workspace_entitlements (nullable limits, explicit plan status,
trial_ends_at, effective dates and administrator audit) and a usage_reservations
ledger with unique(workspace,kind,business_key), amount and reserved/consumed/
released/uncertain state. Add authenticated administrative mutations using the
existing admin boundary; payment webhooks/upgrades require separate design.

Recommended accounting unit: one successful **destination publication** consumes
one post allowance; a three-platform post consumes three, because each is a
separate scheduled_posts/provider outcome. This is a proposal awaiting commercial
approval, not a hidden default. No account/post/AI/member/workspace count or trial
duration is hardcoded by this pass.

All direct publish, schedule/reschedule, bulk, festival, knowledge automation,
AI generation and connection writers must reserve under one workspace lock and
check the same entitlement service. Worker dispatch must recheck expiry and consume
the existing reservation, not reserve again. Duplicate jobs reuse a stable key;
cancel/confirmed pre-dispatch failure releases; provider-confirmed success consumes;
ambiguous sends retain uncertain reservations pending reconciliation and must not
automatically publish again. Reschedules transfer/reuse reservations transactionally.
Concurrent API/worker and administrator changes require locked integration tests.
API rate limiting and upstream YouTube quotas are not substitutes for this ledger.

No trial enforcement test can honestly pass against the current missing system.
Do not market/enforce paid/trial limits until this design and values are approved,
implemented across every writer, and concurrency/retry/uncertainty tests pass.

## Same-platform account multiplicity (coordinated proposal)

After approving destination selection semantics: add a unique connection identity
on (workspace_id,platform,provider_id), then relax the old single-platform unique
constraint without deleting rows. Change all five connector upserts together; keep
legacy account IDs on reconnect to the same destination. Add explicit account ID
selection to composer, schedule, calendar and batch, validate every selected ID
against the active workspace and platform, and keep festival's explicit account IDs.
For legacy content with one healthy account retain that mapping; when ambiguous,
require selection rather than picking an arbitrary account or broadcasting.
Do not deploy the uniqueness change without these writers/UI changes. No executable
migration that would prematurely enable ambiguous dispatch is included here.

## Environment inventory (names only; no values disclosed)

Platform/app configuration: FACEBOOK_APP_ID, FACEBOOK_APP_SECRET,
FACEBOOK_GRAPH_API_VERSION, LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET,
LINKEDIN_API_VERSION, X_CLIENT_ID, X_CLIENT_SECRET, YOUTUBE_CLIENT_ID,
YOUTUBE_CLIENT_SECRET (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET aliases),
SOCIAL_OAUTH_BASE_URL and per-platform *_REDIRECT_URI; APP_URL and
META_MEDIA_PUBLIC_BASE_URL configure frontend/media delivery. Legacy
INSTAGRAM_CLIENT_ID/SECRET and META_CLIENT_ID/SECRET branches exist, but active
Instagram UI aliases through Meta/Facebook. Keep them; do not add per-user app secrets.

ENCRYPTION_KEY is mapped to TOKEN_ENCRYPTION_KEY by config; do not rotate either
as part of this pass. Infrastructure storage/mail/database credentials remain
backend-managed. TELEGRAM_BOT_TOKEN appears in local/production env files but no
active server path reads it for connection or publishing: workspace database tokens
are used. No account-specific Facebook/Page/Google channel env fallback was found
in active publishing paths. Dynamic environment access also exists for platform
client secrets and redirect URIs. Per-workspace IDs/access/refresh tokens belong
only in social_accounts/social_account_tokens/meta_oauth_pending/oauth_states.

## Audit coverage and exact inspected files

A static inventory/reference scan covered 221 server/frontend/script/test/SQL
files and all 23 migrations. This is repository-wide coverage, not a claim that
every line or live provider account was tested. The following files were read in
full or in focused control-flow sections; further implementation/test reads will
be recorded below:

- package.json; .github/workflows/release-artifact.yml; deploy/cpanel-deploy.sh;
  .cpanel.yml; app.mjs; server/config.ts; server/main.ts; server/phase-main.ts;
  server/security.ts; server/db.ts; server/auth.controller.ts;
  server/phase-auth.controller.ts; server/workspace-session.ts;
  server/workspace.controller.ts; server/admin.controller.ts.
- server/social.controller.ts; server/social.oauth.ts; server/social.provider.ts;
  server/providers/social.ts; server/meta.api.ts; server/meta.media.ts;
  server/meta.publishing.ts; server/youtube.api.ts; server/youtube.schema.ts;
  server/youtube.service.ts; server/content.controller.ts;
  server/publish-planner.ts; server/publishing.ts; server/platform-capabilities.ts.
- server/queues.ts; server/queue-backend.ts; server/postgres-queue.ts;
  server/worker.ts; server/bullmq-worker.ts; server/cron-job.ts;
  server/cron-tasks.ts; server/cron-runtime.ts; server/rate-limiter.ts;
  server/migrate.ts; server/ai.controller.ts; server/analytics.controller.ts;
  server/calendar/daily-posting.ts; server/calendar/calendar.controller.ts;
  server/calendar/festival-auto-scheduler.ts; server/knowledge/automation.service.ts;
  server/batch/batch-processing.ts; server/storage/storage-budget.ts;
  server/storage/managed-media.ts; server/clipdrop/clipdrop.service.ts.
- src/main.tsx; src/AuthApp.tsx; src/App.tsx; src/lib/api.ts;
  src/lib/auth-client.ts; src/lib/session.ts; src/lib/model.ts;
  src/pages/Authentication.tsx; src/pages/Manage.tsx; src/pages/Composer.tsx;
  src/pages/Library.tsx; src/components/PublishPreviewModal.tsx.
- server/migrations/001_auth.sql through 023_postgres_queue.sql (all filenames
  inventoried with schema/constraint/reference searches); .env, .env.example,
  .env.production.example, env-cpanel-production.env, deploy/production.env.example
  were inspected for relevant **variable names only**, never copied into reports/tests.
- scripts/test-social-oauth.mjs; scripts/test-social-publish.mjs;
  scripts/test-social-validation.mjs; scripts/test-meta-oauth.mjs;
  scripts/test-meta-callback.mjs; scripts/test-meta-connection.mjs;
  scripts/test-youtube-connection.mjs; scripts/test-youtube-publishing.mjs;
  scripts/test-publishing-validation.mjs; scripts/test-postgres-queue.mjs;
  scripts/test-auth.mjs; tests/auth.test.ts.

## Primary references

- OAuth state/user-agent binding and replay: https://www.rfc-editor.org/rfc/rfc9700.html
- Telegram membership/post permissions: https://core.telegram.org/bots/api

## Verification, changes, migrations and release gates

Implementation and measured test results will be appended after the local pass.
Existing features are not labelled live-working solely because code exists.
