# Approval and publishing progress

The current increment connects knowledge-generated proposals to the existing Approvals and Calendar screens. Owners and admins can approve and schedule atomically at the persisted proposed time. Content managers can schedule an already approved proposal. Approvers retain the existing approval-only action.

The endpoint validates tenant ownership, permissions, the reviewed content version, proposal state, future time, daily capacity, time collisions, healthy connected accounts, and platform content validation before committing approval and durable publishing jobs. Any validation failure rolls back the approval. Knowledge-generated drafts require review even when the workspace generally allows scheduling drafts. No new migration is required beyond existing migration 017.

Scheduling recognizes platform names irrespective of case. The existing manual schedule route uses shared platform content validation rather than its outdated three-platform allowlist. Telegram account validation also recognizes either platform-name casing.

Worker corrections: an active duplicate delivery does not mark an in-flight attempt uncertain; uncertain failures are never automatically retried; validation/token failures before provider dispatch are recorded as preflight failures; an empty aggregate cannot mark content published.

Validation: production build, frontend TypeScript check, platform publishing validation, and isolated PostgreSQL knowledge/approval regression tests. Tests cover exact proposal timestamp, stale versions, role and tenant isolation, account casing, approval rollback and versioned outbox creation. No live provider posts are sent.

Remaining M08/M09 work: unified publishing readiness/results UI, workspace-wide publishing pause, confirmed-failure retry controls and attempt history, consistent safeguards across immediate/bulk publishing paths, and controlled end-to-end provider/worker verification. Full Auto is not certified complete. Broader interface redesign remains a later step.
