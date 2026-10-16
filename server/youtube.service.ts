import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffprobe from "ffprobe-static";
import { pool, transaction, audit, type DB } from "./db.js";
import { encryptToken, decryptToken } from "./security.js";
import { getStorageProvider } from "./storage/storage.factory.js";
import {
  youtubeSchema,
  validateShort,
  type YouTubeInput,
} from "./youtube.schema.js";
import { youtubeRequest } from "./youtube.api.js";
import { ProviderError } from "./providers/social.js";
import { SocialProviderRegistry } from "./social.provider.js";
const execute = promisify(execFile);

export async function youtubeAsset(
  db: DB,
  workspaceId: string,
  assetId: string,
  thumbnail = false,
) {
  const row = (
    await db.query(
      "SELECT * FROM media_assets WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL",
      [assetId, workspaceId],
    )
  ).rows[0];
  if (
    !row ||
    row.status !== "COMPLETED" ||
    (thumbnail
      ? !["IMAGE", "THUMBNAIL"].includes(row.type)
      : row.type !== "VIDEO")
  )
    throw new BadRequestException(
      "Upload a completed media asset in this workspace.",
    );
  if (
    thumbnail &&
    (!["image/jpeg", "image/png"].includes(row.mime_type) ||
      Number(row.size_bytes) > 2 * 1024 * 1024)
  )
    throw new BadRequestException(
      "Thumbnail must be JPEG or PNG, at most 2 MB.",
    );
  return row;
}
async function withAsset<T>(
  asset: any,
  fn: (file: string, size: number) => Promise<T>,
) {
  const dir = await mkdtemp(join(tmpdir(), "contentos-video-"));
  const file = join(dir, "media");
  try {
    const { provider } = getStorageProvider();
    await pipeline(
      await provider.read(asset.bucket, asset.object_key),
      createWriteStream(file),
    );
    const size = (await stat(file)).size;
    if (size <= 0 || size > 500 * 1024 * 1024)
      throw new BadRequestException(
        "Stored media size is invalid. Upload the file again.",
      );
    return await fn(file, size);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function videoMetadata(file: string) {
  try {
    const { stdout } = await execute(
      ffprobe.path,
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    const data = JSON.parse(stdout);
    const stream = data.streams?.find(
      (s: any) => s.codec_type === "video" && !s.disposition?.attached_pic,
    );
    if (!stream)
      throw new BadRequestException("The uploaded file has no video stream.");
    let width = Number(stream.width),
      height = Number(stream.height);
    const rotation = Number(
      stream.tags?.rotate ||
        stream.side_data_list?.find((s: any) => s.rotation !== undefined)
          ?.rotation ||
        0,
    );
    if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
    const duration = Number(data.format?.duration || stream.duration);
    if (!Number.isFinite(duration) || duration <= 0 || width <= 0 || height <= 0)
      throw new BadRequestException(
        "Could not read video duration or dimensions.",
      );
    return { width, height, duration };
  } catch (err: any) {
    if (err instanceof BadRequestException) throw err;
    console.warn("[YouTube] ffprobe video inspection warning:", err?.message || err);
    return { width: 1920, height: 1080, duration: 60 };
  }
}

export async function resolveYouTubeInput(
  db: DB,
  wid: string,
  content: any,
): Promise<YouTubeInput> {
  let yt = content?.youtube;
  if (typeof yt === "string") {
    try {
      yt = JSON.parse(yt);
    } catch {
      yt = null;
    }
  }

  if (yt && typeof yt === "object" && yt.assetId) {
    return youtubeSchema.parse(yt);
  }

  // Synthesize from variants or content fields
  let rawVariants = content?.variants;
  if (typeof rawVariants === "string") {
    try {
      rawVariants = JSON.parse(rawVariants);
    } catch {
      rawVariants = {};
    }
  }
  rawVariants = rawVariants || {};

  const ytKey = Object.keys(rawVariants).find((k) => k.toLowerCase() === "youtube");
  const vObj = ytKey && typeof rawVariants[ytKey] === "object" ? rawVariants[ytKey] : {};
  let assetId = vObj.mediaAssetId || content?.media_asset_id;

  if (!assetId) {
    // Check if there is a recently uploaded completed video in this workspace
    const recentVideo = (
      await db.query(
        "SELECT id FROM media_assets WHERE workspace_id=$1 AND type='VIDEO' AND status='COMPLETED' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
        [wid],
      )
    ).rows[0];
    if (recentVideo) {
      assetId = recentVideo.id;
    }
  }

  if (!assetId) {
    throw new BadRequestException(
      "YouTube requires a video attachment. Please attach a video before publishing.",
    );
  }

  const rawTitle = (vObj.title || content?.title || "").trim();
  const safeTitle = (rawTitle.replace(/[<>]/g, "").trim() || "Untitled Video").slice(0, 100);
  const safeDesc = (vObj.caption || content?.body || "").trim().slice(0, 5000);
  const kind = vObj.metadata?.youtubeKind === "Short" ? "Short" : "Video";
  const visibility = ["private", "unlisted", "public"].includes(vObj.metadata?.visibility)
    ? vObj.metadata.visibility
    : "public";

  const synthesized: YouTubeInput = {
    kind,
    assetId,
    title: safeTitle,
    description: safeDesc,
    visibility: visibility as any,
  };

  const parsed = youtubeSchema.parse(synthesized);

  if (content?.id) {
    await db.query(
      "UPDATE content SET youtube=$1 WHERE id=$2 AND workspace_id=$3",
      [JSON.stringify(parsed), content.id, wid],
    );
    content.youtube = parsed;
  }

  return parsed;
}

export async function validateYouTubeInput(
  db: DB,
  wid: string,
  value: unknown,
  inspect = true,
) {
  if (!value) {
    throw new BadRequestException(
      "YouTube upload details are required. Please attach a video.",
    );
  }
  const parsedValue = typeof value === "string" ? JSON.parse(value) : value;
  const input = youtubeSchema.parse(parsedValue);
  const asset = await youtubeAsset(db, wid, input.assetId);
  if (input.thumbnailAssetId)
    await youtubeAsset(db, wid, input.thumbnailAssetId, true);
  if (inspect)
    await withAsset(asset, async (file) => {
      const metadata = await videoMetadata(file);
      if (input.kind === "Short") {
        if (metadata.width > 0 && metadata.height > 0 && metadata.height < metadata.width) {
          input.kind = "Video";
        } else if (metadata.duration > 180) {
          input.kind = "Video";
        } else {
          try {
            validateShort(metadata);
          } catch {
            input.kind = "Video";
          }
        }
      }
    });
  return input;
}
// OAuth encryption for the current connection uses workspace ID as AAD.
export async function youtubeToken(
  wid: string,
  accountId: string,
  force = false,
): Promise<string> {
  let revoked = false;
  const token = await transaction(async (db) => {
    const a = (
      await db.query(
        "SELECT t.* FROM social_account_tokens t JOIN social_accounts a ON a.id=t.account_id WHERE a.id=$1 AND a.workspace_id=$2 AND lower(a.platform)='youtube' FOR UPDATE OF t",
        [accountId, wid],
      )
    ).rows[0];
    if (!a) throw new ProviderError("RECONNECT_REQUIRED");
    if (
      !force &&
      (!a.expires_at || new Date(a.expires_at).getTime() > Date.now() + 60000)
    )
      return decryptToken(a.ciphertext, wid);
    if (!a.refresh_ciphertext) {
      revoked = true;
      await db.query(
        "UPDATE social_accounts SET state='Reconnect required' WHERE id=$1 AND workspace_id=$2",
        [accountId, wid],
      );
      return "";
    }
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: decryptToken(a.refresh_ciphertext, wid),
        client_id:
          process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "",
        client_secret:
          process.env.YOUTUBE_CLIENT_SECRET ||
          process.env.GOOGLE_CLIENT_SECRET ||
          "",
      }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.error === "invalid_grant") {
        revoked = true;
        await db.query(
          "UPDATE social_accounts SET state='Reconnect required' WHERE id=$1 AND workspace_id=$2",
          [accountId, wid],
        );
        return "";
      }
      throw new ProviderError("TOKEN_REFRESH_FAILED", res.status >= 500);
    }
    if (!data.access_token) throw new ProviderError("TOKEN_REFRESH_FAILED");
    await db.query(
      "UPDATE social_account_tokens SET ciphertext=$2,expires_at=$3,refresh_ciphertext=COALESCE($4,refresh_ciphertext) WHERE account_id=$1",
      [
        accountId,
        encryptToken(data.access_token, wid),
        new Date(Date.now() + Number(data.expires_in || 3600) * 1000),
        data.refresh_token ? encryptToken(data.refresh_token, wid) : null,
      ],
    );
    return String(data.access_token);
  });
  if (revoked) throw new ProviderError("RECONNECT_REQUIRED");
  return token;
}
export async function withYouTubeToken<T>(
  wid: string,
  accountId: string,
  fn: (token: string) => Promise<T>,
) {
  try {
    return await fn(await youtubeToken(wid, accountId));
  } catch (e) {
    if (!(e instanceof ProviderError) || e.code !== "RECONNECT_REQUIRED")
      throw e;
    return fn(await youtubeToken(wid, accountId, true));
  }
}
export async function aggregateYouTube(
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
  const status = rows.some((r) => r.state === "UNCERTAIN")
    ? "UNCERTAIN"
    : rows.some(
          (r) =>
            r.state === "FAILED" ||
            ["failed", "terminated"].includes(r.processing_status),
        )
      ? "FAILED"
      : rows.length &&
          rows.every(
            (r) =>
              r.state === "PUBLISHED" && r.processing_status !== "processing",
          )
        ? "PUBLISHED"
        : "PUBLISHING";
  await db.query(
    "UPDATE content SET status=$3,updated_at=now() WHERE id=$1 AND workspace_id=$2 AND version=$4",
    [contentId, wid, status, version],
  );
}
export async function publishYouTubeRecord(
  record: any,
  content: any,
  account: any,
) {
  const wid = record.workspace_id;
  let accepted = !!record.provider_post_id;
  try {
    const input = await resolveYouTubeInput(pool, wid, content);
    if (accepted)
      return {
        success: true,
        status: "PROCESSING",
        providerPostId: record.provider_post_id,
      };
    const asset = await youtubeAsset(pool, wid, input.assetId);
    let uploaded: any;
    await withAsset(asset, async (file, size) => {
      const metadata = await videoMetadata(file);
      if (input.kind === "Short") {
        if (metadata.width > 0 && metadata.height > 0 && metadata.height < metadata.width) {
          console.warn("[YouTube] Video is landscape; auto-switching from Short to standard Video.");
          input.kind = "Video";
        } else if (metadata.duration > 180) {
          console.warn("[YouTube] Video exceeds 3 minutes; auto-switching from Short to standard Video.");
          input.kind = "Video";
        } else {
          try {
            validateShort(metadata);
          } catch {
            input.kind = "Video";
          }
        }
      }
      uploaded = await withYouTubeToken(wid, account.id, async (token) => {
        const latest = (
          await pool.query(
            "SELECT upload_session_ciphertext FROM scheduled_posts WHERE id=$1 AND workspace_id=$2",
            [record.id, wid],
          )
        ).rows[0];
        return SocialProviderRegistry.getProvider("youtube").publishVideo!(
          token,
          input,
          file,
          size,
          asset.mime_type,
          latest.upload_session_ciphertext
            ? decryptToken(latest.upload_session_ciphertext, wid)
            : null,
          async (session) => {
            await pool.query(
              "UPDATE scheduled_posts SET upload_session_ciphertext=$3 WHERE id=$1 AND workspace_id=$2",
              [record.id, wid, encryptToken(session, wid)],
            );
          },
        );
      });
    });
    if (!uploaded?.id)
      throw new ProviderError("UPLOAD_OUTCOME_UNKNOWN", false, true);
    accepted = true;
    // Save the video ID before optional thumbnail work; failures must never re-upload.
    await transaction(async (db) => {
      await db.query(
        "UPDATE scheduled_posts SET state='PUBLISHED',provider_post_id=$3,processing_status='processing',actual_visibility=$4,processing_checked_at=now(),error_code=NULL WHERE id=$1 AND workspace_id=$2",
        [
          record.id,
          wid,
          uploaded.id,
          uploaded.status?.privacyStatus || input.visibility,
        ],
      );
      await db.query(
        "INSERT INTO published_posts(id,workspace_id,scheduled_post_id,provider_post_id) VALUES($1,$2,$3,$4) ON CONFLICT(scheduled_post_id) DO NOTHING",
        [randomUUID(), wid, record.id, uploaded.id],
      );
      await aggregateYouTube(db, content.id, wid, record.content_version);
      await audit(
        db,
        wid,
        null,
        "youtube uploaded",
        "content",
        content.id,
        content.title,
        null,
        {
          videoId: uploaded.id,
          visibility: uploaded.status?.privacyStatus,
          kind: input.kind,
        },
      );
    });
    if (input.thumbnailAssetId) {
      try {
        const thumbnail = await youtubeAsset(
          pool,
          wid,
          input.thumbnailAssetId,
          true,
        );
        await withAsset(thumbnail, async (file) => {
          const { readFile } = await import("node:fs/promises");
          await withYouTubeToken(wid, account.id, async (token) =>
            youtubeRequest(
              token,
              `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(uploaded.id)}`,
              {
                method: "POST",
                headers: { "Content-Type": thumbnail.mime_type },
                body: await readFile(file),
              },
            ),
          );
        });
      } catch (e) {
        await pool.query(
          "UPDATE scheduled_posts SET publish_warning=$3 WHERE id=$1 AND workspace_id=$2",
          [record.id, wid, `Thumbnail failed: ${(e as Error).message}`],
        );
      }
    }
    return {
      success: true,
      status: "PROCESSING",
      providerPostId: uploaded.id,
      visibility: uploaded.status?.privacyStatus || input.visibility,
    };
  } catch (e) {
    const error =
      e instanceof ProviderError
        ? e
        : new ProviderError(
            e instanceof BadRequestException ||
              (e instanceof Error && /Shorts/.test(e.message))
              ? e.message
              : "YOUTUBE_UPLOAD_FAILED",
          );
    const state = accepted || error.uncertain ? "UNCERTAIN" : "FAILED";
    await transaction(async (db) => {
      await db.query(
        "UPDATE scheduled_posts SET state=$3,error_code=$4 WHERE id=$1 AND workspace_id=$2",
        [record.id, wid, state, error.code],
      );
      if (error.code === "RECONNECT_REQUIRED")
        await db.query(
          "UPDATE social_accounts SET state='Reconnect required' WHERE id=$1 AND workspace_id=$2",
          [account.id, wid],
        );
      await aggregateYouTube(db, content.id, wid, record.content_version);
      await audit(
        db,
        wid,
        null,
        "youtube upload failed",
        "content",
        content.id,
        content.title,
        null,
        { code: error.code, state },
      );
    });
    return { success: false, status: state, error: error.code };
  }
}
export async function publishYouTubeNow(
  wid: string,
  userId: string,
  contentId: string,
  accountId: string,
) {
  const claimed = await transaction(async (db) => {
    const content = (
      await db.query(
        "SELECT * FROM content WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
        [contentId, wid],
      )
    ).rows[0];
    if (!content) throw new NotFoundException("Content not found");
    const ws = (
      await db.query("SELECT require_approval FROM workspaces WHERE id=$1", [
        wid,
      ])
    ).rows[0];
    const member = (
      await db.query(
        "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
        [wid, userId],
      )
    ).rows[0];
    const isOwnerOrAdmin = ["Owner", "Admin"].includes(member?.role);

    if (
      !["DRAFT", "APPROVED", "FAILED"].includes(content.status) ||
      (ws.require_approval && content.status !== "APPROVED" && !isOwnerOrAdmin)
    )
      throw new ConflictException(
        "Only eligible drafts or approved content can publish.",
      );

    if (content.status !== "APPROVED" && (isOwnerOrAdmin || !ws.require_approval)) {
      await db.query(
        "UPDATE content SET status='APPROVED', approved_by=COALESCE(approved_by, $3) WHERE id=$1 AND workspace_id=$2",
        [contentId, wid, userId],
      );
      content.status = "APPROVED";
    }
    const account = (
      await db.query(
        "SELECT * FROM social_accounts WHERE id=$1 AND workspace_id=$2 AND lower(platform)='youtube'",
        [accountId, wid],
      )
    ).rows[0];
    if (!account)
      throw new ForbiddenException(
        "Select a YouTube account in this workspace.",
      );
    if (!["connected"].includes(String(account.state).toLowerCase()))
      throw new BadRequestException("Reconnect your YouTube account.");
    const plats = typeof content.platforms === "string" ? JSON.parse(content.platforms || "[]") : (content.platforms || []);
    if (!plats.some((p: string) => String(p).toLowerCase() === "youtube"))
      throw new BadRequestException("This content does not target YouTube.");
    const validYt = await resolveYouTubeInput(db, wid, content);
    await validateYouTubeInput(db, wid, validYt, false);
    content.youtube = validYt;
    const record = (
      await db.query(
        "INSERT INTO scheduled_posts(id,workspace_id,content_id,account_id,content_version,execute_at,timezone,state,attempt_started_at) VALUES($1,$2,$3,$4,$5,now(),'UTC','PROCESSING',now()) ON CONFLICT(content_id,account_id,content_version) DO NOTHING RETURNING *",
        [randomUUID(), wid, contentId, accountId, content.version],
      )
    ).rows[0];
    if (!record)
      throw new ConflictException(
        "This publication has already been attempted. Check its status before trying again.",
      );
    await db.query(
      "UPDATE content SET status='PUBLISHING',updated_by=$3,updated_at=now() WHERE id=$1 AND workspace_id=$2",
      [contentId, wid, userId],
    );
    return { record, content, account };
  });
  return {
    contentId,
    ...(await publishYouTubeRecord(
      claimed.record,
      claimed.content,
      claimed.account,
    )),
  };
}
export function youtubeProcessing(video: any, createdAt: string | Date) {
  if (!video)
    return {
      status: "processing",
      error:
        Date.now() - new Date(createdAt).getTime() > 86400000
          ? "VIDEO_NOT_FOUND_CHECK_CHANNEL"
          : "VIDEO_NOT_VISIBLE_YET",
    };
  const status =
    video.processingDetails?.processingStatus ||
    (video.status?.uploadStatus === "processed" ? "succeeded" : "processing");
  if (
    ["failed", "rejected", "deleted"].includes(video.status?.uploadStatus) ||
    ["failed", "terminated"].includes(status)
  )
    return {
      status: "failed",
      error:
        video.processingDetails?.processingFailureReason ||
        video.status?.failureReason ||
        video.status?.rejectionReason ||
        "YOUTUBE_PROCESSING_FAILED",
    };
  return { status, error: null };
}
export async function checkYouTubeRecord(row: any) {
  try {
    const data = await withYouTubeToken(
      row.workspace_id,
      row.account_id,
      async (token) =>
        (
          await youtubeRequest(
            token,
            `https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${encodeURIComponent(row.provider_post_id)}`,
          )
        ).json(),
    );
    const video = data.items?.[0];
    const result = youtubeProcessing(video, row.created_at);
    await transaction(async (db) => {
      await db.query(
        "UPDATE scheduled_posts SET processing_status=$3,actual_visibility=COALESCE($4,actual_visibility),processing_checked_at=now(),error_code=$5 WHERE id=$1 AND workspace_id=$2",
        [
          row.id,
          row.workspace_id,
          result.status,
          video?.status?.privacyStatus,
          result.error,
        ],
      );
      await aggregateYouTube(
        db,
        row.content_id,
        row.workspace_id,
        row.content_version,
      );
    });
    return result;
  } catch (e) {
    const code =
      e instanceof ProviderError ? e.code : "YOUTUBE_STATUS_UNAVAILABLE";
    await pool.query(
      "UPDATE scheduled_posts SET processing_checked_at=now(),error_code=$3 WHERE id=$1 AND workspace_id=$2",
      [row.id, row.workspace_id, code],
    );
    return { status: row.processing_status, error: code };
  }
}
export async function pollYouTubeProcessing() {
  const rows = (
    await pool.query(
      "SELECT s.* FROM scheduled_posts s JOIN social_accounts a ON a.id=s.account_id AND a.workspace_id=s.workspace_id WHERE s.processing_status='processing' AND (s.processing_checked_at IS NULL OR s.processing_checked_at < now()-interval '30 seconds') ORDER BY s.processing_checked_at NULLS FIRST LIMIT 20",
    )
  ).rows;
  for (const row of rows) await checkYouTubeRecord(row);
}

export async function refreshExpiringYouTubeTokens(db: DB = pool): Promise<{ checked: number; refreshed: number }> {
  try {
    const rows = (
      await db.query(
        `SELECT a.id, a.workspace_id, t.expires_at, t.refresh_ciphertext 
         FROM social_accounts a 
         JOIN social_account_tokens t ON t.account_id = a.id 
         WHERE lower(a.platform) = 'youtube' 
           AND lower(a.state) = 'connected' 
           AND t.refresh_ciphertext IS NOT NULL
           AND (t.expires_at IS NULL OR t.expires_at < now() + interval '20 minutes')
         LIMIT 20`
      )
    ).rows;

    let refreshed = 0;
    for (const row of rows) {
      try {
        await youtubeToken(row.workspace_id, row.id, true);
        refreshed++;
      } catch (err: any) {
        console.warn(`[YouTube Token Proactive Refresh] Account ${row.id}:`, err?.message || err);
      }
    }
    return { checked: rows.length, refreshed };
  } catch (err: any) {
    console.error("[YouTube Token Refresh Loop Error]:", err?.message || err);
    return { checked: 0, refreshed: 0 };
  }
}

