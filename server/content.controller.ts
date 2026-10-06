import {
  Get,
  Body,
  Controller,
  Param,
  Post,
  Patch,
  Req,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { audit, transaction, type DB } from "./db.js";
import {
  assertPermission,
  WorkspaceRequired,
  validateTimezone,
  decryptToken,
  type AuthedRequest,
} from "./security.js";
import {
  SocialProviderRegistry,
  type SocialProviderName,
} from "./social.provider.js";
import {
  publishYouTubeNow,
  validateYouTubeInput,
  checkYouTubeRecord,
} from "./youtube.service.js";
import { youtubeSchema } from "./youtube.schema.js";
import { pool } from "./db.js";
import { serializePost } from "./workspace.controller.js";

import {
  PLATFORM_CAPABILITIES,
  normalizeVariant,
  validatePlatformVariant,
  type Platform,
} from "./platform-capabilities.js";
import { createPublishPlan } from "./publish-planner.js";
import { NotificationsService } from "./notifications/notifications.service.js";

export const publishSchema = z.object({
  socialAccountId: z.string().uuid("Valid social account ID required"),
});
export const platformSchema = z.enum([
  "LinkedIn",
  "Instagram",
  "X",
  "YouTube",
  "Telegram",
]);

export const variantObjectSchema = z.object({
  caption: z.string().trim().max(10000).optional(),
  title: z.string().trim().max(500).optional(),
  mediaAssetId: z.string().uuid().optional(),
  mediaUrl: z.string().optional(),
  mediaType: z.enum(["text", "image", "video", "document"]).optional(),
  metadata: z.record(z.any()).optional(),
});

export const variantSchema = z.union([
  z.string().trim().max(10000),
  variantObjectSchema,
]);

const inputSchema = z.object({
  title: z.string().trim().max(160).default(""),
  body: z.string().trim().max(10000).default(""),
  platforms: z
    .array(platformSchema)
    .min(1)
    .max(5)
    .refine((a) => new Set(a).size === a.length, "Duplicate platforms"),
  variants: z
    .record(platformSchema, variantSchema)
    .default({}),
  youtube: youtubeSchema.optional().nullable().transform((v) => (v === null ? undefined : v)),
  version: z.number().int().positive().optional(),
});

export function assertEditable(status: string) {
  if (!["DRAFT", "NEEDS_REVIEW", "APPROVED"].includes(status))
    throw new ConflictException(
      "Cancel the schedule before editing this post.",
    );
}
export function validateSchedule(
  status: string,
  requiresApproval: boolean,
  at: Date,
) {
  if (!Number.isFinite(at.getTime()) || at.getTime() < Date.now() + 30000)
    throw new BadRequestException(
      "Choose a time at least 30 seconds in the future.",
    );
  if (!(status === "APPROVED" || (!requiresApproval && status === "DRAFT")))
    throw new ConflictException(
      "This post must be approved before it can be scheduled.",
    );
}
async function locked(db: DB, id: string, wid: string) {
  z.string().uuid().parse(id);
  const p = (
    await db.query(
      "SELECT * FROM content WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
      [id, wid],
    )
  ).rows[0];
  if (!p) throw new NotFoundException("Post not found in this workspace.");
  return p;
}
@WorkspaceRequired()
@Controller("content")
export class ContentController {
  @Post(":id/youtube/check")
  async checkYouTube(@Req() r: AuthedRequest, @Param("id") id: string) {
    assertPermission(r.workspace.role, "schedule");
    z.string().uuid().parse(id);
    const rows = (
      await pool.query(
        "SELECT s.* FROM scheduled_posts s JOIN social_accounts a ON a.id=s.account_id AND a.workspace_id=s.workspace_id WHERE s.content_id=$1 AND s.workspace_id=$2 AND lower(a.platform)='youtube' AND s.provider_post_id IS NOT NULL",
        [id, r.workspace.id],
      )
    ).rows;
    if (!rows.length)
      throw new NotFoundException("No YouTube upload found in this workspace.");
    for (const row of rows) await checkYouTubeRecord(row);
    return this.youtubeStatus(r, id);
  }
  @Get(":id/youtube")
  async youtubeStatus(@Req() r: AuthedRequest, @Param("id") id: string) {
    z.string().uuid().parse(id);
    const content = (
      await pool.query(
        "SELECT id FROM content WHERE id=$1 AND workspace_id=$2",
        [id, r.workspace.id],
      )
    ).rows[0];
    if (!content)
      throw new NotFoundException("Content not found in this workspace.");
    const publications = (
      await pool.query(
        'SELECT s.id,s.state,s.provider_post_id AS "videoId",s.processing_status AS "processingStatus",s.actual_visibility AS visibility,s.error_code AS error,s.publish_warning AS warning FROM scheduled_posts s JOIN social_accounts a ON a.id=s.account_id AND a.workspace_id=s.workspace_id WHERE s.content_id=$1 AND s.workspace_id=$2 AND lower(a.platform)=\'youtube\' ORDER BY s.created_at DESC',
        [id, r.workspace.id],
      )
    ).rows;
    return { publications };
  }
  @Post(":id/publish")
  async publishContent(
    @Req() r: AuthedRequest,
    @Param("id") contentId: string,
    @Body() input: unknown,
  ) {
    assertPermission(r.workspace.role, "schedule");
    const v = publishSchema.parse(input);
    const w = r.workspace.id;
    const target = (
      await pool.query(
        "SELECT platform FROM social_accounts WHERE id=$1 AND workspace_id=$2",
        [v.socialAccountId, w],
      )
    ).rows[0];
    if (String(target?.platform).toLowerCase() === "youtube")
      return publishYouTubeNow(w, r.user.id, contentId, v.socialAccountId);

    return transaction(async (db) => {
      // 1. Lock content row for update to prevent concurrent duplicate publishing
      const contentRes = await db.query(
        "SELECT * FROM content WHERE id = $1 AND workspace_id = $2 FOR UPDATE",
        [contentId, w],
      );

      if (!contentRes.rowCount) {
        throw new NotFoundException(
          "Content item not found in this workspace.",
        );
      }

      const content = contentRes.rows[0];
      if (content.status === "PUBLISHING") {
        throw new BadRequestException(
          "This post is currently being published.",
        );
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
        throw new ForbiddenException(
          "Selected social account does not belong to your active workspace.",
        );
      }

      const acc = accRes.rows[0];
      const botToken = decryptToken(acc.ciphertext, w);
      const provider = SocialProviderRegistry.getProvider(
        acc.platform as SocialProviderName,
      );

      // 3. Set content state to PUBLISHING
      await db.query(
        "UPDATE content SET status = 'PUBLISHING', updated_at = NOW(), updated_by = $1 WHERE id = $2 AND workspace_id = $3",
        [r.user.id, contentId, w],
      );

      await audit(
        db,
        w,
        r.user.id,
        "publish_started",
        "content",
        contentId,
        content.title || "Untitled Post",
        null,
        {
          platform: acc.platform,
          socialAccountId: acc.id,
        },
      );

      // 4. Extract platform-specific variant caption & media URL
      let textToPublish = content.body || "";
      let mediaUrlToPublish: string | undefined = content.media_url || undefined;

      if (content.variants) {
        try {
          const variants =
            typeof content.variants === "string"
              ? JSON.parse(content.variants)
              : content.variants;
          const platformKey = Object.keys(variants).find(
            (k) => k.toLowerCase() === acc.platform.toLowerCase(),
          );
          const variant = platformKey ? variants[platformKey] : null;

          if (variant) {
            if (typeof variant === "string") {
              textToPublish = variant;
            } else if (typeof variant === "object") {
              if (variant.caption) textToPublish = variant.caption;
              if (variant.mediaUrl) mediaUrlToPublish = variant.mediaUrl;
            }
          }
        } catch (e) {
          // Fall back to default content.body
        }
      }

      if (!mediaUrlToPublish && content.media_asset_id) {
        const assetRes = await db.query(
          "SELECT public_url FROM media_assets WHERE id = $1 AND workspace_id = $2",
          [content.media_asset_id, w],
        );
        if (assetRes.rowCount && assetRes.rows[0].public_url) {
          mediaUrlToPublish = assetRes.rows[0].public_url;
        }
      }

      // 5. Invoke Provider
      const result = await provider.publishText(
        acc.platform === "telegram"
          ? { botToken, chatId: acc.provider_id }
          : { token: botToken, author: acc.provider_id },
        {
          text: textToPublish,
          destination: acc.provider_id,
          mediaUrl: mediaUrlToPublish,
        },
      );

      if (!result.success) {
        await db.query(
          "UPDATE content SET status = 'FAILED', updated_at = NOW(), updated_by = $1 WHERE id = $2 AND workspace_id = $3",
          [r.user.id, contentId, w],
        );

        await audit(
          db,
          w,
          r.user.id,
          "publish_failed",
          "content",
          contentId,
          content.title || "Untitled Post",
          null,
          {
            platform: acc.platform,
            error: result.error,
          },
        );

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
        [
          schedId,
          w,
          contentId,
          acc.id,
          content.version,
          result.providerPostId || "N/A",
        ],
      );

      const actualSched = (
        await db.query(
          "SELECT id FROM scheduled_posts WHERE content_id = $1 AND account_id = $2 AND content_version = $3",
          [contentId, acc.id, content.version],
        )
      ).rows[0];

      const pubId = randomUUID();
      await db.query(
        "INSERT INTO published_posts(id, workspace_id, scheduled_post_id, provider_post_id, published_at) VALUES($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
        [
          pubId,
          w,
          actualSched.id,
          result.providerPostId || "N/A",
          result.publishedAt,
        ],
      );

      await audit(
        db,
        w,
        r.user.id,
        "published_content",
        "content",
        contentId,
        content.title || "Untitled Post",
        null,
        {
          platform: acc.platform,
          providerPostId: result.providerPostId,
        },
      );

      return {
        success: true,
        contentId,
        status: "PUBLISHED",
        providerPostId: result.providerPostId,
        publishedAt: result.publishedAt,
      };
    });
  }

  @Post("preview")
  async previewPublish(@Req() r: AuthedRequest, @Body() input: unknown) {
    const v = inputSchema.parse(input);
    const plans = await Promise.all(
      v.platforms.map((p) =>
        createPublishPlan(
          pool,
          { ...v, id: "preview", workspace_id: r.workspace.id },
          p as Platform,
          { isPublishing: false }
        )
      )
    );
    return { plans };
  }

  @Post() async create(@Req() r: AuthedRequest, @Body() input: unknown) {
    assertPermission(r.workspace.role, "edit");
    const v = inputSchema.parse(input);
    if (v.platforms.includes("YouTube") && v.youtube)
      await validateYouTubeInput(pool, r.workspace.id, v.youtube);
    else if (!v.body) throw new BadRequestException("Post text is required.");
    const id = randomUUID();
    return transaction(async (db) => {
      const p = (
        await db.query(
          "INSERT INTO content(id,workspace_id,title,body,platforms,variants,created_by,updated_by,youtube) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8) RETURNING *",
          [
            id,
            r.workspace.id,
            v.title,
            v.body,
            JSON.stringify(v.platforms),
            JSON.stringify(v.variants),
            r.user.id,
            v.youtube ? JSON.stringify(v.youtube) : null,
          ],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO content_versions(id,workspace_id,content_id,version,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), r.workspace.id, id, 1, JSON.stringify(v), r.user.id],
      );
      await audit(
        db,
        r.workspace.id,
        r.user.id,
        "created",
        "content",
        id,
        v.title,
        null,
        v,
      );
      return serializePost({ ...p, creator: r.user.name });
    });
  }
  @Patch(":id") async edit(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    assertPermission(r.workspace.role, "edit");
    const v = inputSchema
      .extend({ version: z.number().int().positive().optional() })
      .parse(input);
    return transaction(async (db) => {
      const old = await locked(db, id, r.workspace.id);
      if (v.platforms.includes("YouTube") && v.youtube)
        await validateYouTubeInput(db, r.workspace.id, v.youtube);
      else if (!v.body) throw new BadRequestException("Post text is required.");
      assertEditable(old.status);
      if (v.version !== undefined && old.version !== v.version)
        throw new ConflictException(
          "This post changed since you opened it. Reload before editing.",
        );
      const p = (
        await db.query(
          "UPDATE content SET title=$3,body=$4,platforms=$5,variants=$6,version=version+1,status='DRAFT',approved_by=NULL,updated_by=$7,youtube=$8,updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING *",
          [
            id,
            r.workspace.id,
            v.title,
            v.body,
            JSON.stringify(v.platforms),
            JSON.stringify(v.variants),
            r.user.id,
            v.youtube ? JSON.stringify(v.youtube) : null,
          ],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO content_versions(id,workspace_id,content_id,version,snapshot,created_by) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          r.workspace.id,
          id,
          p.version,
          JSON.stringify(v),
          r.user.id,
        ],
      );
      await audit(
        db,
        r.workspace.id,
        r.user.id,
        "edited",
        "content",
        id,
        v.title,
        old,
        p,
      );
      return serializePost({ ...p, creator: r.user.name });
    });
  }
  @Post(":id/:action") async transition(
    @Req() r: AuthedRequest,
    @Param("id") id: string,
    @Param("action") action: string,
    @Body() input: unknown,
  ) {
    if (!["review", "approve", "reject", "schedule", "cancel"].includes(action))
      throw new NotFoundException("Unknown action.");
    assertPermission(
      r.workspace.role,
      action === "approve" || action === "reject"
        ? "approve"
        : action === "schedule" || action === "cancel"
          ? "schedule"
          : "edit",
    );
    return transaction(async (db) => {
      const p = await locked(db, id, r.workspace.id);
      let status = p.status;
      if (action === "review") {
        if (p.status !== "DRAFT")
          throw new ConflictException(
            "Only drafts can be submitted for review.",
          );
        status = "NEEDS_REVIEW";
        const commentText = (input as any)?.comment ? String((input as any).comment).trim() : "";
        if (commentText) {
          await db.query(
            "INSERT INTO content_comments(id, workspace_id, content_id, author_id, comment) VALUES($1,$2,$3,$4,$5)",
            [randomUUID(), r.workspace.id, id, r.user.id, commentText]
          );
        }
        // Notify workspace approvers/admins
        const approversRes = await db.query(
          "SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND role IN ('Owner', 'Admin', 'Approver')",
          [r.workspace.id]
        );
        for (const row of approversRes.rows) {
          if (row.user_id !== r.user.id) {
            await NotificationsService.createNotification(db as any, {
              workspaceId: r.workspace.id,
              userId: row.user_id,
              type: "approval_requested",
              title: "Approval Requested",
              message: `${r.user.name} submitted "${p.title || "Content"}" for review.`,
              data: { content_id: id },
            });
          }
        }
      }
      if (action === "approve" || action === "reject") {
        if (p.status !== "NEEDS_REVIEW")
          throw new ConflictException("This post is not awaiting review.");
        status = action === "approve" ? "APPROVED" : "DRAFT";
        const commentText = (input as any)?.comment ? String((input as any).comment).trim() : "";
        await db.query(
          "INSERT INTO approvals(id,workspace_id,content_id,version,actor_id,decision) VALUES($1,$2,$3,$4,$5,$6)",
          [randomUUID(), r.workspace.id, id, p.version, r.user.id, action],
        );
        await db.query(
          "UPDATE content SET approved_by=$3 WHERE id=$1 AND workspace_id=$2",
          [id, r.workspace.id, action === "approve" ? r.user.id : null],
        );
        if (commentText) {
          await db.query(
            "INSERT INTO content_comments(id, workspace_id, content_id, author_id, comment) VALUES($1,$2,$3,$4,$5)",
            [randomUUID(), r.workspace.id, id, r.user.id, `[${action.toUpperCase()}] ${commentText}`]
          );
        }
        // Notify content creator
        if (p.created_by && p.created_by !== r.user.id) {
          await NotificationsService.createNotification(db as any, {
            workspaceId: r.workspace.id,
            userId: p.created_by,
            type: action === "approve" ? "approved" : "rejected",
            title: action === "approve" ? "Post Approved" : "Post Needs Revisions",
            message: `${r.user.name} ${action === "approve" ? "approved" : "rejected"} "${p.title || "Content"}"${commentText ? `: "${commentText}"` : "."}`,
            data: { content_id: id },
          });
        }
      }
      if (action === "schedule") {
        const v = z
          .object({
            scheduledAt: z.string().datetime({ offset: true }),
            timezone: z.string(),
          })
          .parse(input);
        validateTimezone(v.timezone);
        const at = new Date(v.scheduledAt);
        const ws = (
          await db.query(
            "SELECT require_approval FROM workspaces WHERE id=$1 FOR SHARE",
            [r.workspace.id],
          )
        ).rows[0];
        validateSchedule(p.status, ws.require_approval, at);
        for (const platform of p.platforms as string[]) {
          if (!["LinkedIn", "Telegram", "YouTube"].includes(platform))
            throw new BadRequestException(
              `${platform} publishing is not available in this MVP.`,
            );
          const body = p.variants[platform] || p.body;
          const max = platform === "Telegram" ? 4096 : 3000;
          if (platform === "YouTube")
            await validateYouTubeInput(db, r.workspace.id, p.youtube);
          if (platform !== "YouTube" && body.length > max)
            throw new BadRequestException(
              `${platform} text must be no longer than ${max} characters.`,
            );
          const account = (
            await db.query(
              "SELECT a.id FROM social_accounts a JOIN social_account_tokens t ON t.account_id=a.id WHERE a.workspace_id=$1 AND lower(a.platform)=lower($2) AND lower(a.state)='connected' AND (t.expires_at IS NULL OR t.expires_at>now() OR (lower(a.platform)='youtube' AND t.refresh_ciphertext IS NOT NULL)) FOR SHARE OF a",
              [r.workspace.id, platform],
            )
          ).rows[0];
          if (!account)
            throw new BadRequestException(
              `Connect a healthy ${platform} account before scheduling.`,
            );
          await db.query(
            "INSERT INTO scheduled_posts(id,workspace_id,content_id,account_id,content_version,execute_at,timezone) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              randomUUID(),
              r.workspace.id,
              id,
              account.id,
              p.version + 1,
              at,
              v.timezone,
            ],
          );
        }
        await db.query(
          "UPDATE content SET scheduled_at=$3,timezone=$4,scheduled_by=$5 WHERE id=$1 AND workspace_id=$2",
          [id, r.workspace.id, at, v.timezone, r.user.id],
        );
        status = "SCHEDULED";
      }
      if (action === "cancel") {
        if (p.status !== "SCHEDULED")
          throw new ConflictException("Only scheduled posts can be cancelled.");
        const claimed = await db.query(
          "SELECT 1 FROM scheduled_posts WHERE content_id=$1 AND workspace_id=$2 AND content_version=$3 AND state NOT IN ('PENDING','ENQUEUED','CANCELLED')",
          [id, r.workspace.id, p.version],
        );
        if (claimed.rowCount)
          throw new ConflictException(
            "Publishing has started and cannot be cancelled.",
          );
        await db.query(
          "UPDATE scheduled_posts SET state='CANCELLED' WHERE content_id=$1 AND workspace_id=$2 AND content_version=$3",
          [id, r.workspace.id, p.version],
        );
        await db.query(
          "UPDATE content SET scheduled_at=NULL,timezone=NULL,approved_by=NULL WHERE id=$1 AND workspace_id=$2",
          [id, r.workspace.id],
        );
        status = "DRAFT";
      }
      await db.query(
        "UPDATE content SET status=$3,version=version+1,updated_at=now(),updated_by=$4 WHERE id=$1 AND workspace_id=$2",
        [id, r.workspace.id, status, r.user.id],
      );
      await audit(
        db,
        r.workspace.id,
        r.user.id,
        action,
        "content",
        id,
        p.title,
        { status: p.status, version: p.version },
        {
          status,
          version: p.version + 1,
          ...(action === "schedule" ? (input as object) : {}),
        },
      );
      return { id, status };
    });
  }
}
