# YouTube publishing audit — ContentOS

Updated 2 October 2026. Work resumed and implementation/live private publishing verification completed. No Git commit or push made.

## Result

Existing OAuth was reused. Short and Video both use resumable videos.insert. Composer includes upload, title, description, private/unlisted/public visibility, optional regular-video thumbnail, Publish Now and Schedule. Existing approvals, RBAC, workspace isolation, providers and scheduler are reused. Server-side ffprobe validates square/vertical Shorts up to 180 seconds. Community posts are excluded.

Live private tests passed:
- Publish Now: five-second 640x360 H.264/AAC synthetic video; videoId rCTqVgJ5mpE; processing succeeded; visibility private; ContentOS Published. Content ID f379f032-34c5-4ef3-97e3-b69803c54650.
- Scheduler: five-second 360x640 H.264/AAC synthetic Short; scheduled 11:46 AM IST; videoId 3pdzsNQdAlM; processing succeeded; visibility private; ContentOS Published. Content ID e0e6b8fe-a70d-4321-ad97-98614e41a293.
- Live routine token refresh succeeded and channel verification returned HTTP 200 with one channel. Offline refresh credentials are now stored encrypted.

The older two-second test oKPFjCqrUWM remains unavailable from videos.list; its exact cause is unresolved and it is not counted as successful processing. Missing videos are now distinguished from explicit processing failures.

## Files changed

24 source/config/test files plus this report: 25 files. One previously staged runtime MP4 is additional and must be excluded from Git.

Modified (16): .gitignore; package.json; package-lock.json; scripts/test-social-publish.mjs; server/content.controller.ts; server/social.controller.ts; server/social.provider.ts; server/storage/local-storage.provider.ts; server/storage/s3-storage.provider.ts; server/storage/storage.controller.ts; server/storage/storage.types.ts; server/worker.ts; server/workspace.controller.ts; src/lib/model.ts; src/pages/Composer.tsx; src/pages/Library.tsx.

Added (8): scripts/test-youtube-publishing.mjs; server/migrations/008_youtube_publishing.sql; server/storage/storage.factory.ts; server/video-tools.d.ts; server/youtube.api.ts; server/youtube.schema.ts; server/youtube.service.ts; src/pages/YouTubeComposer.tsx.

Dependencies: ffprobe-static for server inspection and development-only ffmpeg-static for synthetic fixtures. Added test:youtube script. Composer now remounts when post identity changes to prevent carrying a previous video's data into a new draft.

## APIs added/changed

- POST /api/v1/content and PATCH /api/v1/content/:id accept YouTube metadata and stored asset references.
- POST /api/v1/content/:id/publish dispatches through the video provider with approval/RBAC checks.
- POST /api/v1/content/:id/schedule uses the existing scheduled_posts outbox and worker.
- GET /api/v1/content/:id/youtube returns workspace-scoped videoId, upload/processing status, visibility, error and thumbnail warning.
- POST /api/v1/content/:id/youtube/check reconciles processing with schedule permission.
- Existing OAuth start/callback adds offline refresh-token/expiry persistence, without rebuilding OAuth or changing scopes.
- Local storage upload/download adds asset/workspace checks and size limits; providers support server-side streams.
- Removed duplicate SocialController publish route.

YouTube APIs: videos.insert (resumable), videos.list, thumbnails.set and Google's token refresh endpoint. HTTP 308 is handled as resumable upload status. Ambiguous responses probe the same saved encrypted session to avoid duplicate inserts. Quota, permission, revoked authentication and processing errors are classified; optional thumbnail failure is saved as a warning without uploading the video again.

## DB changes

Migration 008_youtube_publishing.sql is applied:
- content.youtube JSONB metadata.
- social_account_tokens.refresh_ciphertext, reusing existing expires_at.
- scheduled_posts.upload_session_ciphertext, processing_status, actual_visibility, processing_checked_at, publish_warning.
- Partial index for processing polling.

Existing content, media_assets, scheduled_posts, published_posts, memberships and activity logs are reused. No destructive migration.

## Tests/build

- Full API/frontend production build passed after final changes. Existing large frontend bundle warning remains.
- Frontend TypeScript check passed.
- All 13 publishing tests passed: Short/UTF-8 validation, upload/session recovery, real HTTP 308 transport, error classification, encrypted refresh/revocation, asset isolation, RBAC/approval, ffprobe inspection, processing outcomes and scheduler workspace/account/version/time preservation.
- Existing social publish, social validation, social OAuth and YouTube connection checks passed without external publishing.
- Actual UI Publish Now and scheduled private upload both reached processing succeeded. Live token refresh passed.

## What remains

- Optional thumbnail upload, public/unlisted visibility, forced quota exhaustion and revoked-consent live tests were not performed; error behavior is covered with mocks. Public uploads may remain private until Google's API-project audit.
- Interrupted-worker recovery needs production review: uncertain outcomes stop automatic duplication, but operator reconciliation may be required. Failed content can use the existing Duplicate draft flow.
- Production S3/container binaries, temporary disk capacity, concurrent storage regressions and unusual display-aspect metadata require deployment review. Existing 500 MB upload limit remains.
- npm install reported three dependency vulnerabilities; dependency security audit is outstanding.
- The initial older unavailable test's cause remains unknown; two new tests succeeded.

Local API/frontend/scheduler are running. Automatic approval initially rejected worker startup because of possible unrelated queued posts; a read-only audit then confirmed zero active publications, and the safe startup was approved.

## Git recommendation

Push a reviewed feature branch or draft PR after excluding credentials, runtime media and diagnostics. Include migration 008 with the code. Do not push directly to main as production-ready before remaining deployment reviews.

Important: uploads/.../file.mp4 is already staged. The new uploads/ ignore rule does not unstage it. Some files contain staged older versions and newer unstaged fixes; review and stage the final versions deliberately. No Git push or commit was performed.
