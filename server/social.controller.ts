import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit, pool, transaction } from "./db.js";
import {
  WorkspaceRequired,
  assertPermission,
  encryptToken,
  decryptToken,
  type AuthedRequest,
} from "./security.js";
import { SocialProviderRegistry, type SocialProviderName } from "./social.provider.js";

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
        await db.query("SELECT id FROM social_accounts WHERE workspace_id = $1 AND platform = 'telegram'", [w])
      ).rows[0];

      await db.query(
        `INSERT INTO social_account_tokens(account_id, ciphertext, expires_at)
         VALUES($1, $2, NULL)
         ON CONFLICT (account_id) DO UPDATE
         SET ciphertext = EXCLUDED.ciphertext`,
        [acc.id, encryptedToken],
      );

      await audit(db, w, r.user.id, "connected_channel", "social_account", acc.id, valResult.name, null, {
        platform: "telegram",
        chatId: v.chatId,
      });

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
  @Post("social/accounts/:id/validate")
  async validateAccount(@Req() r: AuthedRequest, @Param("id") id: string) {
    assertPermission(r.workspace.role, "manage");
    const w = r.workspace.id;

    const accRes = await pool.query(
      "SELECT a.id, a.platform, a.provider_id, t.ciphertext FROM social_accounts a JOIN social_account_tokens t ON t.account_id = a.id WHERE a.id = $1 AND a.workspace_id = $2",
      [id, w],
    );

    if (!accRes.rowCount) {
      throw new NotFoundException("Social account not found in this workspace.");
    }

    const acc = accRes.rows[0];
    const botToken = decryptToken(acc.ciphertext, w);
    const provider = SocialProviderRegistry.getProvider(acc.platform as SocialProviderName);

    const valResult = await provider.validateConnection({ botToken, chatId: acc.provider_id });
    const newState = valResult.valid ? "CONNECTED" : valResult.status;

    await pool.query(
      "UPDATE social_accounts SET state = $1, name = $2, last_sync = NOW() WHERE id = $3 AND workspace_id = $4",
      [newState, valResult.name, id, w],
    );

    await audit(pool, w, r.user.id, "validated_channel", "social_account", id, valResult.name, null, {
      state: newState,
    });

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
      await pool.query("SELECT id, name, platform FROM social_accounts WHERE id = $1 AND workspace_id = $2", [id, w])
    ).rows[0];

    if (!acc) {
      throw new NotFoundException("Social account not found in this workspace.");
    }

    return transaction(async (db) => {
      await db.query("DELETE FROM social_accounts WHERE id = $1 AND workspace_id = $2", [id, w]);
      await audit(db, w, r.user.id, "disconnected_channel", "social_account", id, acc.name, null, {
        platform: acc.platform,
      });
      return { success: true, message: "Channel disconnected successfully." };
    });
  }

  @WorkspaceRequired()
  @Post("content/:id/publish")
  async publishContent(@Req() r: AuthedRequest, @Param("id") contentId: string, @Body() input: unknown) {
    assertPermission(r.workspace.role, "schedule");
    const v = publishSchema.parse(input);
    const w = r.workspace.id;

    return transaction(async (db) => {
      // 1. Lock content row for update to prevent concurrent duplicate publishing
      const contentRes = await db.query(
        "SELECT * FROM content WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
        [contentId, w],
      );

      if (!contentRes.rowCount) {
        throw new NotFoundException("Content item not found in this workspace.");
      }

      const content = contentRes.rows[0];
      if (content.status === "PUBLISHING") {
        throw new BadRequestException("This post is currently being published.");
      }
      if (content.status === "PUBLISHED") {
        throw new BadRequestException("This post has already been published.");
      }

      // 2. Lock and load social account belonging to same workspace
      const accRes = await db.query(
        "SELECT a.*, t.ciphertext FROM social_accounts a JOIN social_account_tokens t ON t.account_id = a.id WHERE a.id = $1 AND a.workspace_id = $2",
        [v.socialAccountId, w],
      );

      if (!accRes.rowCount) {
        throw new ForbiddenException("Selected social account does not belong to your active workspace.");
      }

      const acc = accRes.rows[0];
      const botToken = decryptToken(acc.ciphertext, w);
      const provider = SocialProviderRegistry.getProvider(acc.platform as SocialProviderName);

      // 3. Set content state to PUBLISHING
      await db.query(
        "UPDATE content SET status = 'PUBLISHING', updated_at = NOW(), updated_by = $1 WHERE id = $2 AND workspace_id = $3",
        [r.user.id, contentId, w],
      );

      await audit(db, w, r.user.id, "publish_started", "content", contentId, content.title || "Untitled Post", null, {
        platform: acc.platform,
        socialAccountId: acc.id,
      });

      // 4. Invoke Provider
      const result = await provider.publishText(
        { botToken, chatId: acc.provider_id },
        { text: content.body, destination: acc.provider_id },
      );

      if (!result.success) {
        await db.query(
          "UPDATE content SET status = 'FAILED', updated_at = NOW(), updated_by = $1 WHERE id = $2 AND workspace_id = $3",
          [r.user.id, contentId, w],
        );

        await audit(db, w, r.user.id, "publish_failed", "content", contentId, content.title || "Untitled Post", null, {
          platform: acc.platform,
          error: result.error,
        });

        throw new BadRequestException(`Publishing failed: ${result.error}`);
      }

      // 5. Update content state to PUBLISHED
      await db.query(
        "UPDATE content SET status = 'PUBLISHED', published_by = $1, updated_at = NOW(), updated_by = $1 WHERE id = $2 AND workspace_id = $3",
        [r.user.id, contentId, w],
      );

      // Record in scheduled_posts & published_posts
      const schedId = randomUUID();
      await db.query(
        `INSERT INTO scheduled_posts(id, workspace_id, content_id, account_id, content_version, execute_at, timezone, state, provider_post_id)
         VALUES($1, $2, $3, $4, $5, NOW(), 'UTC', 'PUBLISHED', $6)
         ON CONFLICT (content_id, account_id, content_version) DO UPDATE SET state = 'PUBLISHED', provider_post_id = EXCLUDED.provider_post_id`,
        [schedId, w, contentId, acc.id, content.version, result.providerPostId || "N/A"],
      );

      const actualSched = (
        await db.query("SELECT id FROM scheduled_posts WHERE content_id = $1 AND account_id = $2 AND content_version = $3", [contentId, acc.id, content.version])
      ).rows[0];

      const pubId = randomUUID();
      await db.query(
        "INSERT INTO published_posts(id, workspace_id, scheduled_post_id, provider_post_id, published_at) VALUES($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
        [pubId, w, actualSched.id, result.providerPostId || "N/A", result.publishedAt],
      );

      await audit(db, w, r.user.id, "published_content", "content", contentId, content.title || "Untitled Post", null, {
        platform: acc.platform,
        providerPostId: result.providerPostId,
      });

      return {
        success: true,
        contentId,
        status: "PUBLISHED",
        providerPostId: result.providerPostId,
        publishedAt: result.publishedAt,
      };
    });
  }
}
