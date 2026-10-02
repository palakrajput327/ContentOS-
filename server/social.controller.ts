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
  socialCredentialConfigured,
} from "./social.oauth.js";

export const telegramConnectSchema = z.object({
  botToken: z.string().trim().min(1, "Telegram Bot Token is required"),
  chatId: z.string().trim().min(1, "Target Chat/Channel ID is required"),
});

export const publishSchema = z.object({
  socialAccountId: z.string().uuid("Valid social account ID required"),
});

@Controller()
export class SocialController {
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
    const platform =
      platformParam.toLowerCase() === "twitter"
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
      platform === "instagram"
        ? process.env.INSTAGRAM_CLIENT_SECRET || process.env.META_CLIENT_SECRET
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
        message: `Please add your real ${platform.toUpperCase()}_CLIENT_ID and ${platform.toUpperCase()}_CLIENT_SECRET in .env to connect your official ${platform} account.`,
      };
    }

    const state = randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60000);

    await pool.query(
      `INSERT INTO oauth_states(state_hash, workspace_id, user_id, session_hash, expires_at)
       VALUES($1, $2, $3, $4, $5)`,
      [
        hash(state),
        r.workspace.id,
        r.user.id,
        r.sessionHash || hash(r.user.id),
        expiresAt,
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
          : url,
      redirectUri,
    };
  }

  @Public()
  @Get("social/accounts/:platform/callback")
  async oauthCallback(
    @Param("platform") platformParam: string,
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("error") errorStr: string,
    @Res() res: Response,
  ) {
    const platform = platformParam.toLowerCase() as SocialProviderName;
    const appUrl = process.env.APP_URL || "http://localhost:5173";

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
      acc.platform === "telegram"
        ? { botToken: token, chatId: acc.provider_id }
        : { token };
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
