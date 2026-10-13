# Visual knowledge and source posters — 2026-10-13

Phase 2 and Phase 3 are implemented in the existing Studio, knowledge review and Approvals flow. Deployment activation and live browser/provider verification remain pending.

## Implemented

- Image OCR and optional vision analysis produce separate, source-linked knowledge entries. Users can correct, approve or reject them; only confirmed, current evidence enters automated generation.
- Cached analysis, per-image leases, workspace/role checks and partial-failure handling preserve reviewed knowledge and avoid duplicate extraction.
- Source reuse requires separate permission attestation. Approved PDF images can produce square, portrait or landscape branded posters with a workspace logo, brand colors, headline and CTA.
- Posters retain document/page/image lineage, deduplicate identical renders and enter the existing review queue. Publishing checks require approval and reject revoked or stale source reuse.
- Compact thumbnails and quotas remain enforced. Full-resolution source images are reconstructed from the original PDF in memory rather than stored again.

## Verification

API/frontend TypeScript and production builds passed. The existing frontend bundle-size warning remains.

Isolated PostgreSQL tests passed: `test-visual-source.mjs`, `test-source-media.mjs` and `test-knowledge-automation.mjs`. These cover HTTP role/tenant checks, OCR/vision separation, review preservation, leases, render deduplication, source lineage, publishing approval/revocation guards, quota enforcement and existing automation behavior. OCR/vision responses are mocked; no real provider calls or social posts were made. The rendered poster fixture was visually inspected.

Live UI verification remains pending because the browser automation runtime failed to initialize (missing kernel asset path). Current dialogs have not been certified across both themes and mobile in a live browser.

## Activation and remaining work

Apply pending migrations 018, 019 and 020 using the existing migration runner; do not rerun already applied migrations. The application database was not migrated in this work.

Configure `VISION_MODEL` and the appropriate existing provider credentials; `VISION_PROVIDER` can override the default provider. Verify the selected provider/model supports image input. Verify Tesseract language resources for `OCR_LANGUAGES` (default English).

Then perform a real image-only PDF check through extraction, knowledge review, source reuse, poster preview and Approvals. Real social publishing and Full Auto readiness remain a separate validation stream. Phase 4 carousels, ads and video are not implemented.
