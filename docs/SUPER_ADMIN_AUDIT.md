# Super Admin implementation — 2026-10-13

## Existing implementation and first completed chunk

The separate `/admin` frontend and `/api/v1/admin` backend already existed. Normal registrations create workspace Owners, not platform administrators. The existing panel has overview, users, workspaces, authentication activity and basic infrastructure status. It is not the full Super Admin scope.

Removed fallback credentials and replaced process-memory sessions with hashed, expiring, revocable PostgreSQL sessions (migration 021). Controller-level protection now enforces the admin boundary independently of global guard route matching. Workspace sessions and roles do not authorize admin endpoints. Added failed-login throttling and admin login/logout audit events with request IP and user agent. Admin failures no longer trigger workspace session refresh/logout in the frontend.

The user list includes all database users and their memberships plus last recorded `USER_LOGIN`; unverified users are included. This timestamp is not continuous last-active tracking. Migration 021 was applied to the configured database without changing existing user/workspace records. Aggregate check: 13 users, 8 with a recorded login. Local credentials were configured as requested in the untracked environment file, never embedded in frontend code.

API/frontend TypeScript and the production frontend build pass (existing large-bundle warning remains). Isolated PostgreSQL/HTTP tests pass for missing credentials, workspace/forged-cookie denial, login, hashed session persistence across restart, user listing, logout, expiry and throttling (`scripts/test-admin-boundary.mjs`). Live localhost API verification passed with the configured credentials: all 13 users returned, 8 with recorded login, anonymous listing denied. The verification session was logged out. The frontend, API and Redis dependency were started locally; publishing workers were not started. Live visual browser QA has not been performed in this chunk.

## Remaining scope, in order

1. User/workspace suspension, session revocation, worker enforcement and an audited deletion policy; login history IP/device collection for normal users and real last-active tracking. Historical IP/device data cannot be recovered from current auth events.
2. Persisted Free demo/Starter/Pro/Agency subscriptions, daily limits, trial expiry, manual changes and coupons. Enforcement must cover generation, scheduling and workers, not just UI.
3. Payment-provider integration, webhooks, invoices, payment failures and GST invoice requirements. These need merchant configuration and requirements before activation.
4. Tenant usage/cost accounting for tokens, video minutes and storage; queue/publishing/token/API-error health beyond Redis connectivity.
5. Moderation/abuse reports; audited feature flags and global festival administration.
6. Explicit, time-bounded, audited support view-as sessions, clearly marked and initially read-only. Workspace roles must never confer impersonation privileges.

No suspend/delete, subscription, billing or impersonation feature is claimed as completed in this first chunk. Admin audit records are stored; a dedicated admin audit UI is still pending. Credential rotation currently requires revoking existing sessions explicitly or changing the configured username.

## Admin overview redesign — 2026-10-13

Replaced the old panel layout with dedicated responsive navigation: Overview, Users, Workspaces, Posts, Analytics, Activity & logins and System health. Removed the workspace-switch shortcut. Reused theme tokens, theme toggle, query caching and accessible Radix detail dialogs. Added search, status/event filters, paginated posts/activity, record previews, empty states and loading skeletons.

User records show unique IDs, account name/email, verification, workspace roles, created-post count, successful-login count and last recorded login. Workspaces now return one row per workspace even if multiple Owners exist. Events distinguish repeated actions from unique accounts and include workspace audit events plus Super Admin IP/device data. Normal-user historical IP/device was never recorded and remains unavailable.

New read-only admin endpoints provide posts, internal analytics and unified events. No mock engagement or revenue is displayed. Queue health explicitly reports that Redis connectivity alone cannot certify worker processing. Fixed an existing dashboard count query that crashed on object-shaped content variants; both object/array shapes are supported.

API/frontend TypeScript, production build and isolated admin API/security regressions pass. Live read-only reconciliation: 13 distinct users, 8 users with recorded login, 5 verified users, 11 distinct workspaces, 45 content records, and 672 activity events at verification time. User-list totals, summary and analytics agree. Verification sessions were logged out; live users were not deleted or deduplicated.

Live browser visual QA remains pending: the browser automation runtime failed to initialize due to a missing kernel asset path. Responsive/theme styles are implemented but have not been visually certified in this iteration. Billing, subscription enforcement, suspension, moderation and view-as remain the separate unfinished scope above.

## User actions and account lifecycle — 2026-10-13

Added per-user View, Edit and Delete controls with themed dialogs, active/suspended/deleted badges and status filters. Edit supports display name, status and a private admin note. Login and successful mutations use the existing Sonner feedback system. Dialogs retain Radix focus/Escape behavior, show failures, disable duplicate submissions, and use existing theme tokens in both modes.

Migration 022 adds account status, internal note, deletion timestamp, optimistic edit version and targeted admin audit metadata. It was applied to the configured database without suspending or deleting any real user. Normal login/session guards reject inactive accounts, session creation is checked under a user lock, and suspension/deletion revokes sessions and outstanding auth tokens. Reactivation permits a fresh sign-in and does not revive old sessions. Email verification is independent; activating an unverified account does not bypass verification.

Delete is explicitly soft deletion: access is disabled, the registry row, created posts and audit history are retained. The confirmation dialog shows post/membership impact and requires the exact account email. Last eligible workspace Owner deletion is blocked until ownership is transferred. Workspace row locks protect simultaneous owner deletions. Deleted accounts cannot be edited/reactivated through this UI. No physical data erasure, workspace deletion, role transfer, billing change or cancellation of existing workspace publishing is performed by this account action.

User edits and deletions are transactionally audit logged with administrator, target user, prior/next values, IP and device. Stale edit versions fail rather than overwriting another change. Admin credentials remain separate from database workspace users.

API/frontend TypeScript and production build pass. Isolated PostgreSQL/HTTP tests verify user edits, status changes, login/refresh blocking, session revocation, stale versions, exact-email confirmation, last-Owner protection, retained content and audit records alongside earlier admin isolation tests. Live visual QA for animations/mobile/both themes remains pending because the browser automation runtime cannot initialize; no claim of visual certification is made.

### Deletion policy correction

The user's explicit Super Admin authorization supersedes the earlier last-Owner deletion restriction. Super Admin can now soft-delete the last Owner after exact-email confirmation. The dialog warns about affected workspaces rather than blocking the action. Workspace lists resolve only active Owners and show `No active owner` where applicable. All access revocation, stale-version checks, audit records and retained-content rules remain in place. No real account was deleted during implementation.

### Sole platform administrator clarification

The configured administrator (`admin1`) is the sole platform authority. Legacy workspace Owner permissions are tenant-level permissions and are displayed as Workspace manager in the admin user list; they confer no platform ownership or authority over Super Admin. Workspace administration now displays the platform administrator. Removed last-owner/ownerless-workspace warnings and checks from deletion impact UI. Delete requires a standard confirmation button, not repeated email typing. The backend still validates the target/version and records the action. The account deletion remains access removal with retained content/history. No real account was deleted as part of this change.
