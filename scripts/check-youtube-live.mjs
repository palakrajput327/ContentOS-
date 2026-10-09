import { pool } from "../dist-api/db.js";
import { withYouTubeToken } from "../dist-api/youtube.service.js";
try {
  const accounts = (
    await pool.query(
      "SELECT a.id,a.workspace_id,a.name,a.provider_id,a.state,t.expires_at,t.refresh_ciphertext IS NOT NULL AS has_refresh FROM social_accounts a JOIN social_account_tokens t ON t.account_id=a.id WHERE lower(a.platform)='youtube'",
    )
  ).rows;
  for (const a of accounts) {
    const result = {
      name: a.name,
      state: a.state,
      hasRefreshToken: a.has_refresh,
      accessTokenExpired: a.expires_at
        ? new Date(a.expires_at).getTime() < Date.now()
        : null,
    };
    try {
      await withYouTubeToken(a.workspace_id, a.id, async (token) => {
        const res = await fetch(
          "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true",
          {
            headers: { Authorization: "Bearer " + token },
            signal: AbortSignal.timeout(20000),
          },
        );
        const data = await res.json();
        result.apiStatus = res.status;
        if (!res.ok) {
          result.reason = data.error?.errors?.[0]?.reason || data.error?.status;
          return;
        }
        result.channelFound = Boolean(data.items?.length);
        result.savedChannelMatches =
          data.items?.some((c) => c.id === a.provider_id) || false;
        const info = await fetch(
          "https://oauth2.googleapis.com/tokeninfo?access_token=" +
            encodeURIComponent(token),
          { signal: AbortSignal.timeout(20000) },
        );
        if (info.ok) {
          const metadata = await info.json();
          const scopes = String(metadata.scope || "").split(" ");
          result.uploadScopeGranted = scopes.some((s) =>
            [
              "https://www.googleapis.com/auth/youtube",
              "https://www.googleapis.com/auth/youtube.upload",
              "https://www.googleapis.com/auth/youtube.force-ssl",
            ].includes(s),
          );
          result.oauthClientMatches =
            metadata.aud ===
            (process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID);
        }
      });
    } catch (e) {
      result.failure = e.code || e.name;
    }
    const publications = (
      await pool.query(
        "SELECT state,processing_status,actual_visibility,error_code,publish_warning FROM scheduled_posts WHERE workspace_id=$1 AND account_id=$2 ORDER BY execute_at DESC LIMIT 3",
        [a.workspace_id, a.id],
      )
    ).rows;
    console.log(
      JSON.stringify({ ...result, recentPublications: publications }),
    );
  }
  if (!accounts.length) console.log("No saved YouTube account found.");
} catch (e) {
  console.log("YouTube diagnostic failed: " + (e.code || e.name));
  process.exitCode = 1;
} finally {
  await pool.end();
}
