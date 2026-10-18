import { SocialProviderRegistry } from './social.provider.js';
import { randomUUID } from "node:crypto";
import { pool, transaction, audit, type DB } from "./db.js";
import { decryptToken } from "./security.js";
import { socialProvider, ProviderError } from "./providers/social.js";
import {
  publishYouTubeRecord,
  pollYouTubeProcessing,
} from "./youtube.service.js";
import { createPublishPlan } from "./publish-planner.js";
import { PLATFORM_CAPABILITIES, type Platform } from "./platform-capabilities.js";

export async function aggregate(
  db: DB,
  contentId: string,
  wid: string,
  version: number,
) {
  const rows = (
    await db.query(
      "SELECT state,processing_status FROM scheduled_posts WHERE content_id=$1 AND workspace_id=$2 AND content_version=$3",
      [contentId, wid, version],
    )
  ).rows;
  const states = rows.map((r) => r.state);
  if (!states.length) return;
  const status =
    states.every((s) => s === "PUBLISHED") &&
    rows.every((r) => r.processing_status !== "processing")
      ? "PUBLISHED"
      : states.includes("UNCERTAIN")
        ? "UNCERTAIN"
        : states.includes("FAILED")
          ? "FAILED"
          : "PUBLISHING";
  await db.query(
    "UPDATE content SET status=$3,updated_at=now() WHERE id=$1 AND workspace_id=$2",
    [contentId, wid, status],
  );
}

export async function claim(id: string, now: Date = new Date()) {
  return transaction(async (db) => {
    const raw = (
      await db.query(
        "SELECT content_id,workspace_id FROM scheduled_posts WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!raw) return null;
    const content = (
      await db.query(
        "SELECT * FROM content WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [raw.content_id, raw.workspace_id],
      )
    ).rows[0];
    const job = (
      await db.query("SELECT * FROM scheduled_posts WHERE id=$1 FOR UPDATE", [
        id,
      ])
    ).rows[0];
    if (["CANCELLED", "PUBLISHED", "FAILED", "UNCERTAIN"].includes(job.state))
      return null;
    const sub = (
      await db.query(
        "SELECT status, current_period_end FROM workspace_subscriptions WHERE workspace_id = $1",
        [raw.workspace_id],
      )
    ).rows[0];
    if (
      sub &&
      (sub.status === "SUSPENDED" ||
        sub.status === "EXPIRED" ||
        (sub.status === "TRIALING" &&
          new Date(sub.current_period_end).getTime() <= now.getTime()))
    ) {
      // Do not dispatch post while subscription is expired; preserve scheduled record safely
      return null;
    }
    if (
      content.version !== job.content_version ||
      !["SCHEDULED", "PUBLISHING", "FAILED", "UNCERTAIN"].includes(
        content.status,
      )
    ) {
      await db.query(
        "UPDATE scheduled_posts SET state='CANCELLED' WHERE id=$1",
        [id],
      );
      return null;
    }
    if (job.state === "PROCESSING") {
      // Duplicate queue delivery must not change an attempt still in flight.
      if (job.attempt_started_at && now.getTime() - new Date(job.attempt_started_at).getTime() < 10 * 60 * 1000) return null;
      await db.query(
        "UPDATE scheduled_posts SET state='UNCERTAIN',error_code='INTERRUPTED_ATTEMPT' WHERE id=$1",
        [id],
      );
      await aggregate(db, content.id, job.workspace_id, job.content_version);
      await audit(
        db,
        job.workspace_id,
        null,
        "publishing requires verification",
        "content",
        content.id,
        content.title,
      );
      return null;
    }
    if (new Date(job.execute_at).getTime() > now.getTime())
      throw new Error("Job arrived before execution time");
    const account = (
      await db.query(
        "SELECT a.*,t.ciphertext,t.expires_at FROM social_accounts a LEFT JOIN social_account_tokens t ON t.account_id=a.id WHERE a.id=$1 AND a.workspace_id=$2 FOR SHARE OF a",
        [job.account_id, job.workspace_id],
      )
    ).rows[0];
    if (
      !account?.ciphertext ||
      String(account.state).toLowerCase() !== "connected" ||
      (String(account.platform).toLowerCase() !== "youtube" &&
        account.expires_at &&
        new Date(account.expires_at).getTime() <= now.getTime())
    ) {
      await db.query(
        "UPDATE scheduled_posts SET state='FAILED',error_code='RECONNECT_REQUIRED' WHERE id=$1",
        [id],
      );
      await aggregate(db, content.id, job.workspace_id, job.content_version);
      await audit(
        db,
        job.workspace_id,
        null,
        "publishing failed: reconnect required",
        "content",
        content.id,
        content.title,
      );
      return null;
    }
    await db.query(
      "UPDATE scheduled_posts SET state='PROCESSING',attempt_started_at=now() WHERE id=$1",
      [id],
    );
    await db.query(
      "UPDATE content SET status='PUBLISHING' WHERE id=$1 AND workspace_id=$2",
      [content.id, job.workspace_id],
    );
    return { job, content, account };
  });
}

export async function executePublishRecord(
  id: string,
  options?: { now?: Date; attemptsMade?: number; maxAttempts?: number },
): Promise<{ success: boolean; state: string; error?: string; retry?: boolean; providerPostId?: string }> {
  const now = options?.now || new Date();
  const attemptsMade = options?.attemptsMade ?? 0;
  const maxAttempts = options?.maxAttempts ?? 1;

  const c = await claim(id, now);
  if (!c) return { success: false, state: "SKIPPED_OR_TERMINAL" };
  const { account, content, job: record } = c;
  if (String(account.platform).toLowerCase() === "youtube") {
    await publishYouTubeRecord(record, content, account);
    return { success: true, state: "PUBLISHED" };
  }
  let providerId: string;
  let dispatchStarted = false;
  try {
    const metaPlatform = String(account.platform).toLowerCase();
    const plan = await createPublishPlan(
      pool,
      content,
      (Object.keys(PLATFORM_CAPABILITIES).find((p) => p.toLowerCase() === metaPlatform) || account.platform) as Platform,
      { isPublishing: true },
    );
    if (
      ["facebook", "instagram", "telegram"].includes(metaPlatform) ||
      (metaPlatform === "linkedin" && plan.mediaType !== "video")
    ) {
      let token: string;
      try {
        token = decryptToken(account.ciphertext, record.workspace_id);
      } catch {
        token = decryptToken(account.ciphertext, `${record.workspace_id}:${account.id}`);
      }
      dispatchStarted = true;
      const result = await SocialProviderRegistry.getProvider(metaPlatform as any).publishText(
        metaPlatform === "telegram" ? { botToken: token, chatId: account.provider_id } : { token, author: account.provider_id },
        { destination: account.provider_id, text: plan.caption, mediaUrl: plan.mediaUrl, mediaType: plan.mediaType, metadata: plan.metadata },
      );
      if (!result.success || !result.providerPostId)
        throw new ProviderError(result.error || "META_PUBLISH_FAILED", false, Boolean(result.uncertain));
      providerId = result.providerPostId;
    } else {
      const provider = socialProvider(account.platform);
      const conn = {
        token: decryptToken(
          account.ciphertext,
          `${record.workspace_id}:${account.id}`,
        ),
        providerId: account.provider_id,
      };

      dispatchStarted = true;
      if (plan.mediaUrl && plan.mediaType === "video") {
        providerId = await provider.publishVideo(conn, plan.mediaUrl);
      } else if (plan.mediaUrl) {
        providerId = await provider.publishMedia(conn, plan.mediaUrl);
      } else {
        providerId = await provider.publishText(conn, plan.caption);
      }
    }
  } catch (error) {
    const e =
      error instanceof ProviderError
        ? error
        : new ProviderError(dispatchStarted ? "PROVIDER_OUTCOME_UNKNOWN" : "PUBLISHING_PREFLIGHT_FAILED", false, dispatchStarted);
    const retry = e.retryable && !e.uncertain && attemptsMade + 1 < maxAttempts;
    await transaction(async (db) => {
      await db.query("SELECT id FROM content WHERE id=$1 FOR UPDATE", [
        content.id,
      ]);
      await db.query(
        "UPDATE scheduled_posts SET state=$2,error_code=$3 WHERE id=$1",
        [
          record.id,
          retry ? "ENQUEUED" : e.uncertain ? "UNCERTAIN" : "FAILED",
          e.code,
        ],
      );
      if (e.code === "RECONNECT_REQUIRED")
        await db.query(
          "UPDATE social_accounts SET state='Reconnect required' WHERE id=$1",
          [account.id],
        );
      await aggregate(
        db,
        content.id,
        record.workspace_id,
        record.content_version,
      );
      await audit(
        db,
        record.workspace_id,
        null,
        retry
          ? "publishing retry queued"
          : e.uncertain
            ? "publishing requires verification"
            : "publishing failed",
        "content",
        content.id,
        content.title,
        null,
        { code: e.code, platform: account.platform },
      );
      // Notify only on confirmed terminal failure — not on retries or uncertain states.
      if (!retry && !e.uncertain) {
        await db.query(
          `INSERT INTO notifications(id, workspace_id, type, title, message, data)
           VALUES($1, $2, 'publish_failed', $3, $4, $5)`,
          [
            randomUUID(),
            record.workspace_id,
            `Publishing Failed on ${account.platform}`,
            `Post "${content.title.slice(0, 50)}" failed to publish on ${account.platform}: ${e.code}`,
            JSON.stringify({ contentId: content.id, platform: account.platform, error: e.code }),
          ],
        );
      }
    });
    return {
      success: false,
      state: retry ? "ENQUEUED" : e.uncertain ? "UNCERTAIN" : "FAILED",
      error: e.code,
      retry,
    };
  }

  await transaction(async (db) => {
    await db.query("SELECT id FROM content WHERE id=$1 FOR UPDATE", [
      content.id,
    ]);
    await db.query(
      "UPDATE scheduled_posts SET state='PUBLISHED',provider_post_id=$2,error_code=NULL WHERE id=$1",
      [record.id, providerId],
    );
    await db.query(
      "INSERT INTO published_posts(id,workspace_id,scheduled_post_id,provider_post_id) VALUES($1,$2,$3,$4) ON CONFLICT(scheduled_post_id) DO NOTHING",
      [randomUUID(), record.workspace_id, record.id, providerId],
    );
    await aggregate(
      db,
      content.id,
      record.workspace_id,
      record.content_version,
    );
    await audit(
      db,
      record.workspace_id,
      null,
      "published",
      "content",
      content.id,
      content.title,
      null,
      { platform: account.platform, providerPostId: providerId },
    );
    // Notify only after the published_posts row is durably committed.
    await db.query(
      `INSERT INTO notifications(id, workspace_id, type, title, message, data)
       VALUES($1, $2, 'published', $3, $4, $5)`,
      [
        randomUUID(),
        record.workspace_id,
        `Post Published on ${account.platform}`,
        `Your post "${content.title.slice(0, 50)}" was successfully published on ${account.platform}.`,
        JSON.stringify({ contentId: content.id, platform: account.platform, providerPostId: providerId }),
      ],
    );
  });
  return { success: true, state: "PUBLISHED", providerPostId: providerId };
}

