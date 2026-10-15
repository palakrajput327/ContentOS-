import { loadMetaMedia } from './meta.media.js';
import { getStorageProvider } from './storage/storage.factory.js';
import { spawn } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, pool, transaction } from "./db.js";
import {
  WorkspaceRequired,
  Public,
  assertPermission,
  encryptToken,
  decryptToken,
  hash,
  type AuthedRequest,
} from "./security.js";
import {
  SocialProviderRegistry,
  type SocialProviderName,
} from "./social.provider.js";
import {
  socialRedirectUri,
  metaFrontendUrl,
  socialCredentialConfigured,
} from "./social.oauth.js";

import {
  META_SCOPES,
  metaVersion,
  metaRequest,
  metaPages,
  metaPermissions,
} from "./meta.api.js";

export const telegramConnectSchema = z.object({
  botToken: z.string().trim().min(1, "Telegram Bot Token is required"),
  chatId: z.string().trim().min(1, "Target Chat/Channel ID is required"),
});

export const publishSchema = z.object({
  socialAccountId: z.string().uuid("Valid social account ID required"),
});

@Controller()
export class SocialController {
  @Public()
  @Get('social/meta/media/:ticket')
  async metaMediaDownload(@Param('ticket') ticket:string,@Res() res:Response,@Query('format') format?:string) {
    const asset=await loadMetaMedia(ticket);
    const stream=await getStorageProvider().provider.read(asset.bucket,asset.object_key);
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Referrer-Policy','no-referrer');
    if (format === 'jpeg' && asset.mime_type.startsWith('image/') && !['image/jpeg','image/jpg'].includes(asset.mime_type)) {
      const executable = ffmpeg as unknown as string | null;
      if (!executable) {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          const { createCanvas, loadImage } = await import('@napi-rs/canvas');
          const img = await loadImage(Buffer.concat(chunks));
          const canvas = createCanvas(img.width, img.height);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const jpegBuf = await canvas.encode('jpeg');
          res.setHeader('Content-Type','image/jpeg');
          res.setHeader('Content-Length',String(jpegBuf.length));
          res.send(jpegBuf);
          return;
        } catch {
          stream.destroy();
          throw new BadRequestException('Instagram JPEG conversion is unavailable on this server. Upload a JPG image.');
        }
      }
      res.setHeader('Content-Type','image/jpeg');
      const conversion=spawn(executable,['-hide_banner','-loglevel','error','-i','pipe:0','-frames:v','1','-f','image2pipe','-vcodec','mjpeg','-q:v','2','pipe:1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
      const timeout=setTimeout(()=>{conversion.kill();res.destroy();},30000);
      conversion.stderr.resume();
      conversion.on('error',()=>res.destroy());
      conversion.stdin.on('error',()=>res.destroy());
      stream.on('error',()=>{conversion.kill();res.destroy();});
      conversion.on('close',code=>{clearTimeout(timeout);if(code!==0)res.destroy();});
      res.on('close',()=>{clearTimeout(timeout);stream.destroy();if(conversion.exitCode===null)conversion.kill();});
      stream.pipe(conversion.stdin);
      conversion.stdout.pipe(res);
      return;
    }
    res.setHeader('Content-Type',asset.mime_type);
    res.setHeader('Content-Length',String(asset.size_bytes));
    stream.on('error',()=>res.destroy());
    stream.pipe(res);
  }
  @Public()
  @Get('social/meta/text-card')
  async metaTextCard(@Query('text') text: string, @Query('title') titleStr: string, @Res() res: Response) {
    const cleanText = (text || 'ContentOS Post').slice(0, 500);
    const cleanTitle = (titleStr || '').slice(0, 80);

    const words = cleanText.split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';
    for (const word of words) {
      if ((currentLine + ' ' + word).length > 28) {
        lines.push(currentLine.trim());
        currentLine = word;
      } else {
        currentLine += (currentLine ? ' ' : '') + word;
      }
    }
    if (currentLine) lines.push(currentLine.trim());
    const displayLines = lines.slice(0, 10);

    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const svg = `<svg width="1080" height="1080" viewBox="0 0 1080 1080" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="50%" stop-color="#1e1b4b"/>
          <stop offset="100%" stop-color="#311042"/>
        </linearGradient>
        <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#6366f1"/>
          <stop offset="100%" stop-color="#a855f7"/>
        </linearGradient>
      </defs>
      <rect width="1080" height="1080" fill="url(#bg)"/>
      <rect x="80" y="80" width="920" height="12" fill="url(#accent)" rx="6"/>
      ${cleanTitle ? `<text x="80" y="160" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="30" font-weight="700" fill="#a855f7" letter-spacing="1.5">${esc(cleanTitle.toUpperCase())}</text>` : ''}
      <g transform="translate(80, ${cleanTitle ? 260 : 220})">
        ${displayLines.map((line, idx) => `<text x="0" y="${idx * 68}" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="44" font-weight="600" fill="#f8fafc">${esc(line)}</text>`).join('\n')}
      </g>
      <rect x="80" y="960" width="920" height="2" fill="rgba(255,255,255,0.15)"/>
      <text x="80" y="1005" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="24" font-weight="500" fill="#94a3b8">ContentOS Brand Post</text>
    </svg>`;

    const executable = ffmpeg as unknown as string | null;
    if (executable) {
      const { Readable } = await import('node:stream');
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const conversion = spawn(executable, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'image2', '-i', 'pipe:0',
        '-frames:v', '1',
        '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '2', 'pipe:1'
      ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

      const timeout = setTimeout(() => { conversion.kill(); if (!res.headersSent) res.destroy(); }, 15000);
      conversion.stderr.resume();
      conversion.on('close', () => clearTimeout(timeout));
      res.on('close', () => { clearTimeout(timeout); if (conversion.exitCode === null) conversion.kill(); });

      const stream = new Readable();
      stream.push(Buffer.from(svg));
      stream.push(null);
      stream.pipe(conversion.stdin);
      conversion.stdout.pipe(res);
      return;
    }
    try {
      const { createCanvas, loadImage } = await import('@napi-rs/canvas');
      const img = await loadImage(Buffer.from(svg));
      const canvas = createCanvas(1080, 1080);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 1080, 1080);
      const jpegBuf = await canvas.encode('jpeg');
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Length', String(jpegBuf.length));
      res.send(jpegBuf);
      return;
    } catch {
      res.status(400).json({
        error: "Instagram auto-poster generation failed: JPEG image conversion unavailable on server. Upload a JPG or PNG image.",
      });
    }
  }
  @WorkspaceRequired()
  @Get("social/accounts")
  async listAccounts(@Req() r: AuthedRequest) {
    const w = r.workspace.id;
    const res = await pool.query(
      "SELECT id, platform, provider_id, name, state, last_sync FROM social_accounts WHERE workspace_id = $1 ORDER BY name ASC",
      [w],
    );
    return {
      accounts: res.rows.map((a) => ({
        id: a.id,
        platform: a.platform,
        providerId: a.provider_id,
        name: a.name,
        state: a.state,
        lastSync: a.last_sync,
      })),
    };
  }

  @WorkspaceRequired()
  @Post("social/accounts/telegram/connect")
  async connectTelegram(@Req() r: AuthedRequest, @Body() input: unknown) {
    assertPermission(r.workspace.role, "manage");
    const v = telegramConnectSchema.parse(input);
    const w = r.workspace.id;

    const provider = SocialProviderRegistry.getProvider("telegram");
    const valResult = await provider.validateConnection(v);

    if (!valResult.valid) {
      throw new BadRequestException(
        `Telegram connection failed: ${valResult.details?.error || valResult.status}`,
      );
    }

    const encryptedToken = encryptToken(v.botToken, w);
    const accountId = randomUUID();

    return transaction(async (db) => {
      // Upsert or insert social account for workspace + platform
      await db.query(
        `INSERT INTO social_accounts(id, workspace_id, platform, provider_id, name, state, last_sync)
         VALUES($1, $2, 'telegram', $3, $4, $5, NOW())
         ON CONFLICT (workspace_id, platform) DO UPDATE
         SET provider_id = EXCLUDED.provider_id,
             name = EXCLUDED.name,
             state = EXCLUDED.state,
             last_sync = NOW()`,
        [accountId, w, valResult.providerId, valResult.name, valResult.status],
      );

      // Fetch actual account ID (in case of upsert)
      const acc = (
        await db.query(
          "SELECT id FROM social_accounts WHERE workspace_id = $1 AND platform = 'telegram'",
          [w],
        )
      ).rows[0];

      await db.query(
        `INSERT INTO social_account_tokens(account_id, ciphertext, expires_at)
         VALUES($1, $2, $3)
         ON CONFLICT (account_id) DO UPDATE
         SET ciphertext = EXCLUDED.ciphertext, expires_at=EXCLUDED.expires_at`,
        [acc.id, encryptedToken, null],
      );

      await audit(
        db,
        w,
        r.user.id,
        "connected_channel",
        "social_account",
        acc.id,
        valResult.name,
        null,
        {
          platform: "telegram",
          chatId: v.chatId,
        },
      );

      return {
        id: acc.id,
        platform: "telegram",
        providerId: valResult.providerId,
        name: valResult.name,
        state: valResult.status,
      };
    });
  }

  @WorkspaceRequired()
  @Post([
    "social/accounts/:platform/connect",
    "social/accounts/:platform/connect-oauth",
  ])
  async startOAuthConnect(
    @Req() r: AuthedRequest,
    @Param("platform") platformParam: string,
  ) {
    assertPermission(r.workspace.role, "manage");
    const platform = ["meta", "instagram", "facebook"].includes(
      platformParam.toLowerCase(),
    )
      ? "facebook"
      : platformParam.toLowerCase() === "twitter"
        ? "x"
        : platformParam.toLowerCase();
    const redirectUri = socialRedirectUri(platform);

    let clientId: string | undefined;
    let authUrlBase: string | undefined;
    let scope: string | undefined;

    if (platform === "linkedin") {
      clientId = process.env.LINKEDIN_CLIENT_ID;
      authUrlBase = "https://www.linkedin.com/oauth/v2/authorization";
      scope = "openid profile w_member_social";
    } else if (platform === "facebook") {
      clientId = process.env.FACEBOOK_APP_ID;
      authUrlBase =
        "https://www.facebook.com/" + metaVersion() + "/dialog/oauth";
      scope = META_SCOPES;
    } else if (platform === "instagram") {
      clientId = process.env.INSTAGRAM_CLIENT_ID || process.env.META_CLIENT_ID;
      authUrlBase = "https://api.instagram.com/oauth/authorize";
      scope = "user_profile,user_media";
    } else if (platform === "x" || platform === "twitter") {
      clientId = process.env.X_CLIENT_ID;
      authUrlBase = "https://twitter.com/i/oauth2/authorize";
      scope = "tweet.read tweet.write users.read offline.access";
    } else if (platform === "youtube") {
      clientId = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
      authUrlBase = "https://accounts.google.com/o/oauth2/v2/auth";
      scope = "https://www.googleapis.com/auth/youtube";
    } else {
      throw new BadRequestException(
        `1-click OAuth redirect is not supported for ${platform}`,
      );
    }

    const clientSecret =
      platform === "facebook"
        ? process.env.FACEBOOK_APP_SECRET
        : platform === "instagram"
          ? process.env.INSTAGRAM_CLIENT_SECRET ||
            process.env.META_CLIENT_SECRET
          : platform === "youtube"
            ? process.env.YOUTUBE_CLIENT_SECRET ||
              process.env.GOOGLE_CLIENT_SECRET
            : process.env[`${platform.toUpperCase()}_CLIENT_SECRET`];
    const isConfigured =
      socialCredentialConfigured(clientId) &&
      socialCredentialConfigured(clientSecret);

    if (!isConfigured) {
      return {
        configured: false,
        message:
          platform === "facebook"
            ? "Set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET in .env."
            : `Please add your real ${platform.toUpperCase()}_CLIENT_ID and ${platform.toUpperCase()}_CLIENT_SECRET in .env to connect your official ${platform} account.`,
      };
    }

    const state = randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60000);

    await pool.query(
      `INSERT INTO oauth_states(state_hash, workspace_id, user_id, session_hash, expires_at, provider)
       VALUES($1, $2, $3, $4, $5, $6)`,
      [
        hash(state),
        r.workspace.id,
        r.user.id,
        r.sessionHash || hash(r.user.id),
        expiresAt,
        platform,
      ],
    );

    const url = `${authUrlBase}?response_type=code&client_id=${encodeURIComponent(
      clientId!,
    )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(
      scope,
    )}&state=${state}`;

    return {
      configured: true,
      url:
        platform === "youtube"
          ? `${url}&access_type=offline&prompt=consent`
          : platform === "facebook"
            ? `${url}&auth_type=rerequest`
            : url,
      redirectUri,
    };
  }

  @Public()
  @Get(["social/accounts/:platform/callback", "social/:platform/callback"])
  async oauthCallback(
    @Param("platform") platformParam: string,
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("error") errorStr: string,
    @Res() res: Response,
  ) {
    const platform = (
      ["instagram", "meta"].includes(platformParam.toLowerCase())
        ? "facebook"
        : platformParam.toLowerCase()
    ) as SocialProviderName;
    const appUrl =
      platform === "facebook"
        ? metaFrontendUrl()
        : process.env.APP_URL || "http://localhost:5173";

    if (errorStr || !code || !state) {
      return res.redirect(
        `${appUrl}/app/channels?error=${encodeURIComponent(errorStr || "OAuth canceled")}`,
      );
    }

    const stateHash = hash(state);
    const stateRes = await pool.query(
      "SELECT * FROM oauth_states WHERE state_hash = $1 AND expires_at > NOW()",
      [stateHash],
    );

    if (!stateRes.rowCount) {
      return res.redirect(
        `${appUrl}/app/channels?error=${encodeURIComponent("OAuth session expired. Please try again.")}`,
      );
    }

    const stateRecord = stateRes.rows[0];
    if (platform === "facebook")
      return this.finishMetaOAuth(code, stateHash, stateRecord, res);
    const w = stateRecord.workspace_id;
    const userId = stateRecord.user_id;

    // Exchange code for token with platform provider
    let youtubeRefresh: string | undefined;
    let youtubeExpires: Date | null = null;
    let token = "";
    try {
      const redirectUri = socialRedirectUri(platform);
      if (platform === "linkedin") {
        const tokenRes = await fetch(
          "https://www.linkedin.com/oauth/v2/accessToken",
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code,
              redirect_uri: redirectUri,
              client_id: process.env.LINKEDIN_CLIENT_ID || "",
              client_secret: process.env.LINKEDIN_CLIENT_SECRET || "",
            }),
          },
        );
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) {
          throw new Error(
            `LinkedIn token exchange failed (${tokenData.error || tokenRes.status}). Check the client credentials, registered redirect URL, and enabled LinkedIn products.`,
          );
        }
        token = tokenData.access_token;
      } else if (platform === "instagram") {
        const tokenRes = await fetch(
          "https://api.instagram.com/oauth/access_token",
          {
            method: "POST",
            body: new URLSearchParams({
              client_id: process.env.INSTAGRAM_CLIENT_ID || "",
              client_secret: process.env.INSTAGRAM_CLIENT_SECRET || "",
              grant_type: "authorization_code",
              redirect_uri: redirectUri,
              code,
            }),
          },
        );
        const tokenData = await tokenRes.json();
        token = tokenData.access_token;
        if (token && process.env.INSTAGRAM_CLIENT_SECRET) {
          try {
            const longLivedRes = await fetch(
              `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(process.env.INSTAGRAM_CLIENT_SECRET)}&access_token=${encodeURIComponent(token)}`,
            );
            if (longLivedRes.ok) {
              const longLivedData = await longLivedRes.json();
              if (longLivedData.access_token) {
                token = longLivedData.access_token;
              }
            }
          } catch {
            // Keep short-lived token
          }
        }
      } else if (platform === "x") {
        const basicAuth = Buffer.from(
          `${process.env.X_CLIENT_ID || ""}:${process.env.X_CLIENT_SECRET || ""}`,
        ).toString("base64");
        const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${basicAuth}`,
          },
          body: new URLSearchParams({
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
            code_verifier: "challenge",
          }),
        });
        const tokenData = await tokenRes.json();
        token = tokenData.access_token;
      } else if (platform === "youtube") {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id:
              process.env.YOUTUBE_CLIENT_ID ||
              process.env.GOOGLE_CLIENT_ID ||
              "",
            client_secret:
              process.env.YOUTUBE_CLIENT_SECRET ||
              process.env.GOOGLE_CLIENT_SECRET ||
              "",
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok) {
          throw new Error(
            `YouTube token exchange failed (${tokenData.error || tokenRes.status}). Check the Google OAuth client credentials and registered redirect URL.`,
          );
        }
        token = tokenData.access_token;
        youtubeRefresh = tokenData.refresh_token;
        youtubeExpires = new Date(
          Date.now() + Number(tokenData.expires_in || 3600) * 1000,
        );
      }
    } catch (err: any) {
      return res.redirect(
        `${appUrl}/app/channels?error=${encodeURIComponent("Authentication error: " + err.message)}`,
      );
    }

    if (!token) {
      return res.redirect(
        `${appUrl}/app/channels?error=${encodeURIComponent("Could not obtain access token from " + platform + ". Please verify your credentials.")}`,
      );
    }

    const provider = SocialProviderRegistry.getProvider(platform);
    const valResult = await provider.validateConnection({ token });
    if (!valResult.valid) {
      return res.redirect(
        `${appUrl}/app/channels?error=${encodeURIComponent(valResult.details?.error || "Account validation failed for " + platform)}`,
      );
    }
    const encryptedToken = encryptToken(token, w);
    const accountId = randomUUID();

    await transaction(async (db) => {
      await db.query(
        `INSERT INTO social_accounts(id, workspace_id, platform, provider_id, name, state, last_sync)
         VALUES($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (workspace_id, platform) DO UPDATE
         SET provider_id = EXCLUDED.provider_id,
             name = EXCLUDED.name,
             state = EXCLUDED.state,
             last_sync = NOW()`,
        [
          accountId,
          w,
          platform,
          valResult.providerId,
          valResult.name,
          valResult.status,
        ],
      );

      const acc = (
        await db.query(
          "SELECT id FROM social_accounts WHERE workspace_id = $1 AND platform = $2",
          [w, platform],
        )
      ).rows[0];

      await db.query(
        `INSERT INTO social_account_tokens(account_id, ciphertext, expires_at)
         VALUES($1, $2, $3)
         ON CONFLICT (account_id) DO UPDATE
         SET ciphertext = EXCLUDED.ciphertext, expires_at=EXCLUDED.expires_at`,
        [acc.id, encryptedToken, youtubeExpires],
      );

      if (youtubeRefresh)
        await db.query(
          "UPDATE social_account_tokens SET refresh_ciphertext=$2 WHERE account_id=$1",
          [acc.id, encryptToken(youtubeRefresh, w)],
        );
      await db.query("DELETE FROM oauth_states WHERE state_hash = $1", [
        stateHash,
      ]);

      await audit(
        db,
        w,
        userId,
        "connected_channel_oauth",
        "social_account",
        acc.id,
        valResult.name,
        null,
        {
          platform,
        },
      );
    });

    return res.redirect(`${appUrl}/app/channels?connected=${platform}`);
  }

  private async finishMetaOAuth(
    code: string,
    stateHash: string,
    record: any,
    res: Response,
  ) {
    const appUrl = metaFrontendUrl();
    try {
      const consumed = await pool.query(
        "DELETE FROM oauth_states WHERE state_hash=$1 AND provider='facebook' RETURNING state_hash",
        [stateHash],
      );
      if (!consumed.rowCount)
        throw new Error(
          "Meta OAuth session expired or already used. Please reconnect.",
        );
      const credentials = {
        client_id: process.env.FACEBOOK_APP_ID || "",
        client_secret: process.env.FACEBOOK_APP_SECRET || "",
      };
      const short = await metaRequest("oauth/access_token", "", {
        ...credentials,
        code,
        redirect_uri: socialRedirectUri("facebook"),
      });
      if (!short.access_token) throw new Error("Meta code exchange did not return a Facebook user access token. Reconnect Meta.");
      const long = await metaRequest("oauth/access_token", "", {
        ...credentials,
        grant_type: "fb_exchange_token",
        fb_exchange_token: short.access_token,
      });
      if (!long.access_token)
        throw new Error("Meta did not return an access token.");
      await metaPermissions(long.access_token);
      await metaPages(long.access_token);
      const id = randomUUID();
      await pool.query(
        "DELETE FROM meta_oauth_pending WHERE expires_at < NOW()",
      );
      await pool.query(
        "INSERT INTO meta_oauth_pending(id,workspace_id,user_id,ciphertext,expires_at) VALUES($1,$2,$3,$4,$5)",
        [
          id,
          record.workspace_id,
          record.user_id,
          encryptToken(long.access_token, record.workspace_id),
          new Date(Date.now() + 15 * 60000),
        ],
      );
      return res.redirect(appUrl + "/app/channels?meta_pending=" + id);
    } catch (err: any) {
      return res.redirect(
        appUrl + "/app/channels?error=" + encodeURIComponent(err.message),
      );
    }
  }
  private async metaPending(r: AuthedRequest, id: string) {
    z.string().uuid().parse(id);
    const result = await pool.query(
      "SELECT * FROM meta_oauth_pending WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND expires_at > NOW()",
      [id, r.workspace.id, r.user.id],
    );
    if (!result.rowCount)
      throw new BadRequestException(
        "Meta Page selection expired. Please Connect Meta again.",
      );
    return result.rows[0];
  }
  @WorkspaceRequired()
  @Get("social/meta/pages/:id")
  async listMetaPages(@Req() r: AuthedRequest, @Param("id") id: string) {
    assertPermission(r.workspace.role, "manage");
    const pending = await this.metaPending(r, id);
    const pages = await metaPages(
      decryptToken(pending.ciphertext, r.workspace.id),
    );
    return {
      pages: pages.map((p) => ({
        id: p.id,
        name: p.name,
        instagram: p.instagram_business_account?.username || null,
      })),
    };
  }
  @WorkspaceRequired()
  @Post("social/meta/pages/:id/select")
  async selectMetaPage(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    assertPermission(r.workspace.role, "manage");
    const { pageId } = z
      .object({ pageId: z.string().regex(/^\d+$/) })
      .parse(input);
    const pending = await this.metaPending(r, id);
    const pages = await metaPages(
      decryptToken(pending.ciphertext, r.workspace.id),
    );
    const page = pages.find((p) => p.id === pageId);
    if (!page)
      throw new BadRequestException(
        "Selected Facebook Page is no longer accessible. Reconnect and grant Page access.",
      );
    if (!page.access_token)
      throw new BadRequestException(
        "Facebook Page token missing. Grant publishing access and reconnect.",
      );
    if (
      Array.isArray(page.tasks) &&
      !page.tasks.some((task: string) =>
        [
          "CREATE_CONTENT",
          "MANAGE",
          "PROFILE_PLUS_CREATE_CONTENT",
          "PROFILE_PLUS_FULL_CONTROL",
        ].includes(task),
      )
    ) {
      throw new BadRequestException(
        "Selected Facebook Page has no content publishing access. Ask the Page owner to grant content creation access, then reconnect Meta.",
      );
    }
    const ig = page.instagram_business_account;
    if (!ig?.id)
      throw new BadRequestException(
        "No linked Instagram Business account found for this Page. Link your Instagram professional account in Facebook Page settings / Meta Business Suite, then retry.",
      );
    await transaction(async (db) => {
      const claimed = await db.query(
        "DELETE FROM meta_oauth_pending WHERE id=$1 AND expires_at > NOW() RETURNING id",
        [id],
      );
      if (!claimed.rowCount)
        throw new BadRequestException(
          "Meta selection expired or already used.",
        );
      for (const account of [
        { platform: "facebook", id: page.id, name: page.name },
        {
          platform: "instagram",
          id: ig.id,
          name: ig.username ? "@" + ig.username : "Instagram Business",
        },
      ]) {
        const saved = await db.query(
          `INSERT INTO social_accounts(id,workspace_id,platform,provider_id,name,state,last_sync) VALUES($1,$2,$3,$4,$5,'CONNECTED',NOW()) ON CONFLICT(workspace_id,platform) DO UPDATE SET provider_id=EXCLUDED.provider_id,name=EXCLUDED.name,state='CONNECTED',last_sync=NOW() RETURNING id`,
          [
            randomUUID(),
            r.workspace.id,
            account.platform,
            account.id,
            account.name,
          ],
        );
        await db.query(
          "INSERT INTO social_account_tokens(account_id,ciphertext,expires_at) VALUES($1,$2,NULL) ON CONFLICT(account_id) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,expires_at=NULL",
          [saved.rows[0].id, encryptToken(page.access_token, r.workspace.id)],
        );
        await audit(
          db,
          r.workspace.id,
          r.user.id,
          "connected_channel_oauth",
          "social_account",
          saved.rows[0].id,
          account.name,
          null,
          { platform: account.platform, pageId: page.id, instagramId: ig.id },
        );
      }
    });
    return { connected: true };
  }

  @WorkspaceRequired()
  @Post("social/accounts/linkedin/token-connect")
  async connectLinkedInToken(@Req() r: AuthedRequest, @Body() input: unknown) {
    assertPermission(r.workspace.role, "manage");
    const { token } = z
      .object({ token: z.string().trim().min(1, "Access token required") })
      .parse(input);
    const w = r.workspace.id;

    const provider = SocialProviderRegistry.getProvider("linkedin");
    const valResult = await provider.validateConnection({ token });

    if (!valResult.valid) {
      throw new BadRequestException(
        `LinkedIn connection failed: ${valResult.details?.error || valResult.status}`,
      );
    }

    const encryptedToken = encryptToken(token, w);
    const accountId = randomUUID();

    return transaction(async (db) => {
      await db.query(
        `INSERT INTO social_accounts(id, workspace_id, platform, provider_id, name, state, last_sync)
         VALUES($1, $2, 'linkedin', $3, $4, $5, NOW())
         ON CONFLICT (workspace_id, platform) DO UPDATE
         SET provider_id = EXCLUDED.provider_id,
             name = EXCLUDED.name,
             state = EXCLUDED.state,
             last_sync = NOW()`,
        [accountId, w, valResult.providerId, valResult.name, valResult.status],
      );

      const acc = (
        await db.query(
          "SELECT id FROM social_accounts WHERE workspace_id = $1 AND platform = 'linkedin'",
          [w],
        )
      ).rows[0];

      await db.query(
        `INSERT INTO social_account_tokens(account_id, ciphertext, expires_at)
         VALUES($1, $2, NULL)
         ON CONFLICT (account_id) DO UPDATE
         SET ciphertext = EXCLUDED.ciphertext`,
        [acc.id, encryptedToken],
      );

      await audit(
        db,
        w,
        r.user.id,
        "connected_channel",
        "social_account",
        acc.id,
        valResult.name,
        null,
        {
          platform: "linkedin",
        },
      );

      return {
        id: acc.id,
        platform: "linkedin",
        providerId: valResult.providerId,
        name: valResult.name,
        state: valResult.status,
      };
    });
  }

  @WorkspaceRequired()
  @Post("social/accounts/:platform/token-connect")
  async connectPlatformToken(
    @Req() r: AuthedRequest,
    @Param("platform") platformParam: string,
    @Body() input: unknown,
  ) {
    assertPermission(r.workspace.role, "manage");
    const platform = platformParam.toLowerCase() as SocialProviderName;
    const { token } = z
      .object({ token: z.string().trim().min(1, "Access token required") })
      .parse(input);
    const w = r.workspace.id;

    const provider = SocialProviderRegistry.getProvider(platform);
    const valResult = await provider.validateConnection({ token });

    if (!valResult.valid) {
      throw new BadRequestException(
        `${platform.toUpperCase()} connection failed: ${valResult.details?.error || valResult.status}`,
      );
    }

    const encryptedToken = encryptToken(token, w);
    const accountId = randomUUID();

    return transaction(async (db) => {
      await db.query(
        `INSERT INTO social_accounts(id, workspace_id, platform, provider_id, name, state, last_sync)
         VALUES($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (workspace_id, platform) DO UPDATE
         SET provider_id = EXCLUDED.provider_id,
             name = EXCLUDED.name,
             state = EXCLUDED.state,
             last_sync = NOW()`,
        [
          accountId,
          w,
          platform,
          valResult.providerId,
          valResult.name,
          valResult.status,
        ],
      );

      const acc = (
        await db.query(
          "SELECT id FROM social_accounts WHERE workspace_id = $1 AND platform = $2",
          [w, platform],
        )
      ).rows[0];

      await db.query(
        `INSERT INTO social_account_tokens(account_id, ciphertext, expires_at)
         VALUES($1, $2, NULL)
         ON CONFLICT (account_id) DO UPDATE
         SET ciphertext = EXCLUDED.ciphertext`,
        [acc.id, encryptedToken],
      );

      await audit(
        db,
        w,
        r.user.id,
        "connected_channel",
        "social_account",
        acc.id,
        valResult.name,
        null,
        {
          platform,
        },
      );

      return {
        id: acc.id,
        platform,
        providerId: valResult.providerId,
        name: valResult.name,
        state: valResult.status,
      };
    });
  }

  @WorkspaceRequired()
  @Post("social/accounts/:id/validate")
  async validateAccount(@Req() r: AuthedRequest, @Param("id") id: string) {
    assertPermission(r.workspace.role, "manage");
    const w = r.workspace.id;

    const accRes = await pool.query(
      "SELECT a.id, a.platform, a.provider_id, t.ciphertext FROM social_accounts a JOIN social_account_tokens t ON t.account_id = a.id WHERE a.id = $1 AND a.workspace_id = $2",
      [id, w],
    );

    if (!accRes.rowCount) {
      throw new NotFoundException(
        "Social account not found in this workspace.",
      );
    }

    const acc = accRes.rows[0];
    const token = decryptToken(acc.ciphertext, w);
    const provider = SocialProviderRegistry.getProvider(
      acc.platform as SocialProviderName,
    );

    const config =
      String(acc.platform).toLowerCase() === "telegram"
        ? { botToken: token, chatId: acc.provider_id }
        : { token, destination: acc.provider_id };
    const valResult = await provider.validateConnection(config);
    const newState = valResult.valid ? "CONNECTED" : valResult.status;

    await pool.query(
      "UPDATE social_accounts SET state = $1, name = $2, last_sync = NOW() WHERE id = $3 AND workspace_id = $4",
      [newState, valResult.name, id, w],
    );

    await audit(
      pool,
      w,
      r.user.id,
      "validated_channel",
      "social_account",
      id,
      valResult.name,
      null,
      {
        state: newState,
      },
    );

    return {
      id,
      state: newState,
      name: valResult.name,
      valid: valResult.valid,
    };
  }

  @WorkspaceRequired()
  @Delete("social/accounts/:id")
  async disconnectAccount(@Req() r: AuthedRequest, @Param("id") id: string) {
    assertPermission(r.workspace.role, "manage");
    const w = r.workspace.id;

    const acc = (
      await pool.query(
        "SELECT id, name, platform FROM social_accounts WHERE id = $1 AND workspace_id = $2",
        [id, w],
      )
    ).rows[0];

    if (!acc) {
      throw new NotFoundException(
        "Social account not found in this workspace.",
      );
    }

    return transaction(async (db) => {
      await db.query(
        "DELETE FROM social_accounts WHERE id = $1 AND workspace_id = $2",
        [id, w],
      );
      await audit(
        db,
        w,
        r.user.id,
        "disconnected_channel",
        "social_account",
        id,
        acc.name,
        null,
        {
          platform: acc.platform,
        },
      );
      return { success: true, message: "Channel disconnected successfully." };
    });
  }
}
