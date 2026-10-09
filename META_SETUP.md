# Meta publishing setup

The app uses FACEBOOK_APP_ID and FACEBOOK_APP_SECRET from .env. Keep your Meta dashboard app in Development mode. Test login with an app administrator/developer/tester who can create content on the Facebook Page.

Register the exact FACEBOOK_REDIRECT_URI in Meta Facebook Login settings. For local OAuth testing: http://localhost:3001/api/v1/social/facebook/callback. For production: https://hindustandigitalworkshop.info/api/v1/social/facebook/callback. The local callback returns to APP_URL (usually http://localhost:5173); the production callback returns to its own site.

Restart the API after changing credentials. Open Channels > Connect Meta, grant pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic and instagram_content_publish, select your managed Page, then Connect Page + Instagram. The Page must be linked to an Instagram professional account. Both account IDs and encrypted Page tokens are saved atomically. Existing tokens must be reconnected when switching Meta apps.

## Supported composer formats

- Facebook: text, image with caption, video post, or Reel. Select Video post/Reel on the Facebook publishing card.
- Instagram: image with caption, or video published as a Reel. Uploaded PNG/WebP images are delivered as JPEG through the existing signed media endpoint using FFmpeg; the original asset is preserved. External image URLs must already supply JPEG. Choose whether the Reel also appears in the feed.
- Different captions/media and formats can be set per platform in the existing composer. Other providers keep their current flows.
- Stories, multi-asset carousels, PDF/documents and audio-only posts are not implemented in this flow. Meta enforces its own media requirements.

## Media accessibility

Meta must download the actual file from a public URL without ContentOS login. Cloud storage URLs are signed immediately before publishing with a one-hour lifetime. Local uploads use a scoped, encrypted one-hour media link served by this API; the rest of the storage remains authenticated. For local development, set META_MEDIA_PUBLIC_BASE_URL to a publicly reachable HTTPS address forwarding to this API, or configure cloud storage. A localhost-only media URL cannot be downloaded by Meta. Do not point this variable at another server that lacks the new media endpoint.

Uploads must be completed and belong to the workspace. Instagram JPEG conversion requires the API media endpoint to be publicly accessible, including when the original PNG/WebP is in cloud storage. Video processing is polled before publication is marked complete. Uncertain publication outcomes require checking the account before another attempt.

## Validation

When /me/accounts is empty, discovery checks the user token with /debug_token (validity, app ID, USER type and all required scopes). It resolves only Page IDs explicitly granted under pages_show_list granular scopes, using the same Facebook user token, and requires a returned Page token. Instagram discovery uses instagram_business_account on that Page; Instagram-only target IDs are never treated as Pages. Graph failures and malformed responses are separate from genuinely empty lists. No raw Graph error messages or tokens are logged or returned.

An empty list with no selected Page grants requires checking the login account under the Page's New Pages Experience Page access settings, including content creation access. Consent alone does not prove Page access. The failed callback does not persist its token, so historical failures cannot be fully diagnosed from a screenshot. Reconnect after restarting the API. A current encrypted pending user token can be inspected safely with node --env-file=.env scripts/check-meta-discovery.mjs.

npm run build:api
node scripts/test-meta-discovery.mjs
node scripts/test-image-publishing.mjs
node scripts/test-meta-oauth.mjs
node scripts/test-meta-connection.mjs
node scripts/test-meta-publishing.mjs
npm run build

These tests mock Meta; they do not publish real posts. A real OAuth grant and an approved test post are still required to verify the live accounts.
