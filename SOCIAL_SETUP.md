# Social account setup

Credentials belong only in the ignored local `.env` file. Restart the API after changing them.

## LinkedIn

Set `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and:

```
LINKEDIN_REDIRECT_URI=http://localhost:5173/api/v1/social/accounts/linkedin/callback
```

In the same LinkedIn developer app, add that exact URL under Auth > OAuth 2.0 settings > Authorized redirect URLs. Enable **Sign In with LinkedIn using OpenID Connect** and **Share on LinkedIn** under Products. The connection requests `openid profile w_member_social`.

Start both the API and Vite development server, open Channels in ContentOS, and connect LinkedIn. The callback on port 5173 uses Vite's `/api` proxy to reach the API on port 3001.

For production, use a publicly reachable HTTPS callback. Each provider can set its own `<PLATFORM>_REDIRECT_URI`; otherwise the callback is derived from `SOCIAL_OAUTH_BASE_URL` or `APP_URL`, followed by `/api/v1/social/accounts/<platform>/callback`.

## Other accounts

Instagram needs an Instagram/Meta developer app and an eligible professional account. X needs OAuth client credentials and API access. YouTube needs Google OAuth credentials and the YouTube Data API enabled. Telegram needs a bot token and destination chat/channel ID, with permission to post.

Existing Instagram and YouTube text publishing handlers return placeholder IDs, so a connected account alone does not establish working publishing. Complete and verify provider-specific media publishing before relying on those channels.

## Checks

Run `npm run build:api`, then `node scripts/test-social-oauth.mjs` to verify callback configuration.
