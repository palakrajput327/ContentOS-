# YouTube setup on another PC

The local YouTube upload/refresh suite passed. The saved channel was checked read-only against Google: API 200, channel ID matches, upload scope granted, OAuth client matches, refresh token present. Stored publication records include processing success for public and private videos. One optional custom-thumbnail operation has a permission warning; the video itself was published. No new upload was sent during this audit.

## Clone configuration

.env and uploads/ are ignored by Git. Cloning code does not copy OAuth credentials, the encryption key, or local uploaded files. Configure the second PC with the intended environment. If both PCs access the same ContentOS database, the token encryption key must match; do not generate a different key for existing encrypted records. Re-upload media when running against separate local storage, or configure shared cloud storage. Keep credentials out of Git.

## Different Google account

In Google Cloud, select the project that owns YOUTUBE_CLIENT_ID, then Google Auth Platform > Audience. If the app is External and Testing, add the testing Gmail under Test users. If it is Internal, accounts outside its organization are not eligible. Authorize with the intended Gmail/Brand Account and a real YouTube channel. Enable YouTube Data API v3 in this same project.

Testing authorizations and refresh tokens for YouTube scopes can expire after seven days. Reconnect if Google revokes or expires the grant.

## Exact callback

The current local callback is:
http://localhost:5173/api/v1/social/accounts/youtube/callback

Register that exact URI on the Web application OAuth client, including port and path. Each PC running ContentOS locally can use the same localhost callback if its own API/frontend are running. If a PC only opens the hosted site, the hosted server must instead use and register:
https://hindustandigitalworkshop.info/api/v1/social/accounts/youtube/callback

Restart the API after updating .env.

## Distinguish failures

- Google 403 access_denied while connecting: check test-user audience / organization restrictions.
- Google redirect_uri_mismatch: register the exact configured callback.
- Connected but upload permission denied: check API enablement, granted scopes, channel access and the exact provider error.
- Only custom thumbnail fails: check custom thumbnail eligibility/authorization; avoid re-uploading the already published video.
- Local media missing on another PC: local uploads did not travel with the clone.
- Private result despite requesting public: check the YouTube API project's audit restrictions and returned visibility.

## Checks

npm run test:youtube
node --env-file=.env scripts/check-youtube-live.mjs

The second command queries Google and may refresh an existing token; it does not upload a video.

Official references:
https://support.google.com/cloud/answer/15549945
https://support.google.com/accounts/answer/16668185
https://developers.google.com/youtube/v3/docs/videos/insert
https://developers.google.com/youtube/v3/docs/thumbnails/set
