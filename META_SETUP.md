# Meta connection setup

ContentOS reads FACEBOOK_APP_ID and FACEBOOK_APP_SECRET from the existing .env. Register this exact Valid OAuth Redirect URI in Meta Facebook Login settings:

https://hindustandigitalworkshop.info/api/v1/social/facebook/callback

Keep the Meta app in Development mode. Enable Facebook Login and Instagram API with Facebook Login, with pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish. Test with an app admin/developer/tester who has access to the Page. Link the Instagram Business account to that Page in Meta Business Suite.

Run npm run build:api and npm run migrate, deploy/restart API and frontend, then open Channels > Connect Meta. Authorize all five permissions, select the Page, and choose Connect Page + Instagram. Both IDs are saved as separate social accounts and their Page access tokens are encrypted with the workspace encryption context. Pending selection tokens are encrypted and expire after 15 minutes. Missing Pages and missing linked Instagram accounts give actionable errors.

Facebook text/image and Instagram image publishing are supported. Video requests fail explicitly. Meta tokens can be revoked; reconnect when required. Existing workspace connections are replaced only after selecting a Page with a linked Instagram account.

The Meta dashboard settings and a real OAuth round trip require verification in the signed-in Meta app. Local code changes do not change the dashboard app mode.

Meta callback returns to the origin of FACEBOOK_REDIRECT_URI, so a local APP_URL cannot send production Meta connections to localhost. Actual granted permissions and Page content creation access are checked before completing the connection.
