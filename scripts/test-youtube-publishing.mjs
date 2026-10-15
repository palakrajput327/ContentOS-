import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "ffmpeg-static";
import { youtubeSchema, validateShort } from "../dist-api/youtube.schema.js";
import {
  uploadYouTubeVideo,
  youtubeError,
  trustedUploadSession,
  youtubeRequest,
} from "../dist-api/youtube.api.js";
import {
  youtubeToken,
  videoMetadata,
  youtubeAsset,
  publishYouTubeNow,
  aggregateYouTube,
  youtubeProcessing,
} from "../dist-api/youtube.service.js";
import { ContentController } from "../dist-api/content.controller.js";
import { pool } from "../dist-api/db.js";
import { encryptToken, decryptToken } from "../dist-api/security.js";
const originalFetch = globalThis.fetch,
  originalQuery = pool.query,
  originalConnect = pool.connect;
const dir = await mkdtemp(join(tmpdir(), "yt-tests-"));
const file = join(dir, "tiny.bin");
await writeFile(file, Buffer.alloc(100));
const wid = "11111111-1111-4111-8111-111111111111",
  assetId = "22222222-2222-4222-8222-222222222222",
  accountId = "33333333-3333-4333-8333-333333333333";
const input = {
  kind: "Short",
  assetId,
  title: "Test",
  description: "",
  visibility: "private",
};
process.env.TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
after(async () => {
  globalThis.fetch = originalFetch;
  pool.query = originalQuery;
  pool.connect = originalConnect;
  await rm(dir, { recursive: true, force: true });
  await pool.end();
});
test("Short bounds, regular videos, and UTF-8 metadata limits", () => {
  validateShort({ width: 720, height: 1280, duration: 180 });
  validateShort({ width: 720, height: 720, duration: 1 });
  assert.throws(() =>
    validateShort({ width: 1280, height: 720, duration: 10 }),
  );
  assert.throws(() =>
    validateShort({ width: 720, height: 1280, duration: 180.01 }),
  );
  assert.throws(() =>
    validateShort({ width: 720, height: 1280, duration: NaN }),
  );
  assert.equal(youtubeSchema.parse(input).visibility, "private");
  assert.throws(() =>
    youtubeSchema.parse({ ...input, title: "x".repeat(101) }),
  );
  assert.throws(() =>
    youtubeSchema.parse({ ...input, description: "😀".repeat(1500) }),
  );
  assert.throws(() =>
    youtubeSchema.parse({ ...input, thumbnailAssetId: assetId }),
  );
  assert.equal(
    youtubeSchema.parse({ ...input, kind: "Video", thumbnailAssetId: assetId })
      .kind,
    "Video",
  );
});
test("resumable upload saves session before bytes and returns video ID", async () => {
  let saved = false,
    calls = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(init.headers.Authorization, "Bearer token");
    assert.equal(init.redirect, "manual");
    calls++;
    if (calls === 1) {
      assert.match(url, /videos\?uploadType=resumable/);
      assert.equal(JSON.parse(init.body).status.privacyStatus, "private");
      return new Response(null, {
        status: 200,
        headers: {
          location:
            "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=test",
        },
      });
    }
    assert(saved);
    if (calls === 2) return new Response(null, { status: 308 });
    assert.equal(init.headers["Content-Range"], "bytes 0-99/100");
    return Response.json({
      id: "private-video",
      status: { privacyStatus: "private" },
    });
  };
  const result = await uploadYouTubeVideo(
    "token",
    input,
    file,
    100,
    "video/mp4",
    null,
    async () => {
      saved = true;
    },
  );
  assert.equal(result.id, "private-video");
  assert.equal(calls, 3);
});
test("ambiguous final upload is resolved by querying same session without duplicate insert", async () => {
  let calls = 0,
    inserts = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (init.method === "POST") inserts++;
    if (calls === 1)
      return new Response(null, {
        status: 200,
        headers: {
          location:
            "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=test",
        },
      });
    if (calls === 2) return new Response(null, { status: 308 });
    if (calls === 3) throw new Error("connection lost");
    return Response.json({ id: "accepted-once" });
  };
  assert.equal(
    (
      await uploadYouTubeVideo(
        "token",
        input,
        file,
        100,
        "video/mp4",
        null,
        async () => {},
      )
    ).id,
    "accepted-once",
  );
  assert.equal(inserts, 1);
});
test("existing completed session is recovered without sending media again", async () => {
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.headers["Content-Length"], "0");
    return Response.json({ id: "existing" });
  };
  assert.equal(
    (
      await uploadYouTubeVideo(
        "token",
        input,
        file,
        100,
        "video/mp4",
        "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=test",
        async () => assert.fail(),
      )
    ).id,
    "existing",
  );
  assert.throws(() => trustedUploadSession("https://evil.example/upload"));
});
test("quota, revoked access and retryable errors are classified", () => {
  assert.equal(
    youtubeError(403, { error: { errors: [{ reason: "quotaExceeded" }] } })
      .code,
    "YOUTUBE_QUOTA_EXCEEDED",
  );
  assert.equal(youtubeError(401, {}).code, "RECONNECT_REQUIRED");
  assert.equal(youtubeError(403, {}).code, "YOUTUBE_PERMISSION_DENIED");
  assert.equal(youtubeError(503, {}).retryable, true);
});
test("refresh preserves encrypted credentials and workspace scope; revoked token commits reconnect state", async () => {
  let updated,
    revoked = false;
  pool.connect = async () => ({
    release() {},
    query: async (sql, args) => {
      if (sql.startsWith("SELECT t.")) {
        assert.deepEqual(args, [accountId, wid]);
        return {
          rows: [
            {
              ciphertext: encryptToken("old", wid),
              refresh_ciphertext: encryptToken("refresh", wid),
              expires_at: new Date(0),
            },
          ],
        };
      }
      if (sql.startsWith("UPDATE social_account_tokens")) updated = args;
      if (sql.startsWith("UPDATE social_accounts")) revoked = true;
      return { rows: [] };
    },
  });
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.body.get("refresh_token"), "refresh");
    return Response.json({ access_token: "new", expires_in: 3600 });
  };
  assert.equal(await youtubeToken(wid, accountId), "new");
  assert.equal(decryptToken(updated[1], wid), "new");
  globalThis.fetch = async () =>
    Response.json({ error: "invalid_grant" }, { status: 400 });
  await assert.rejects(youtubeToken(wid, accountId), /RECONNECT_REQUIRED/);
  assert(revoked);
});
test("foreign or incomplete assets and thumbnail limits are rejected", async () => {
  const db = {
    query: async (_sql, args) => {
      assert.equal(args[1], wid);
      return { rows: [] };
    },
  };
  await assert.rejects(youtubeAsset(db, wid, assetId), /workspace/);
  await assert.rejects(
    youtubeAsset(
      {
        query: async () => ({
          rows: [
            {
              type: "THUMBNAIL",
              status: "COMPLETED",
              mime_type: "image/png",
              size_bytes: 3 * 1024 * 1024,
            },
          ],
        }),
      },
      wid,
      assetId,
      true,
    ),
    /2 MB/,
  );
});
test("RBAC and approval gate reject unauthorized immediate publishing", async () => {
  await assert.rejects(
    new ContentController().publishContent(
      { workspace: { id: wid, role: "Editor" }, user: { id: "u" } },
      assetId,
      { socialAccountId: accountId },
    ),
    /role does not allow/i,
  );
  pool.connect = async () => ({
    release() {},
    query: async (sql) => ({
      rows: sql.startsWith("SELECT * FROM content")
        ? [{ status: "DRAFT" }]
        : sql.startsWith("SELECT require_approval")
          ? [{ require_approval: true }]
          : [],
    }),
  });
  await assert.rejects(
    publishYouTubeNow(wid, "u", assetId, accountId),
    /approved/,
  );
});
test("processing completion and failure aggregate to content without calling upload", async () => {
  for (const [processing, status] of [
    ["processing", "PUBLISHING"],
    ["succeeded", "PUBLISHED"],
    ["failed", "FAILED"],
  ]) {
    let actual;
    await aggregateYouTube(
      {
        query: async (sql, args) => {
          if (sql.startsWith("SELECT"))
            return {
              rows: [{ state: "PUBLISHED", processing_status: processing }],
            };
          actual = args[2];
          return { rows: [] };
        },
      },
      assetId,
      wid,
      1,
    );
    assert.equal(actual, status);
  }
});
test("actual video inspection uses ffprobe, not browser-supplied dimensions", async () => {
  const video = join(dir, "test.mp4");
  await promisify(execFile)(ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x240:d=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    video,
  ]);
  const metadata = await videoMetadata(video);
  assert.equal(metadata.width, 160);
  assert.equal(metadata.height, 240);
  validateShort(metadata);
});

test("real HTTP 308 remains an upload status rather than a redirect failure", async () => {
  const { createServer } = await import("node:http");
  const server = createServer((_req, res) => {
    res.writeHead(308, { Range: "bytes=0-99" });
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  globalThis.fetch = originalFetch;
  try {
    const response = await youtubeRequest(
      "test",
      `http://127.0.0.1:${server.address().port}/session`,
      { method: "PUT", headers: { "Content-Length": "0" } },
    );
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("range"), "bytes=0-99");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test("processing distinguishes temporary invisibility, successful processing, and concrete rejection reasons", () => {
  assert.deepEqual(youtubeProcessing(undefined, new Date()), {
    status: "processing",
    error: "VIDEO_NOT_VISIBLE_YET",
  });
  assert.equal(
    youtubeProcessing({ status: { uploadStatus: "processed" } }, new Date())
      .status,
    "succeeded",
  );
  assert.equal(
    youtubeProcessing(
      { status: { uploadStatus: "failed", failureReason: "invalidFile" } },
      new Date(),
    ).error,
    "invalidFile",
  );
  assert.equal(
    youtubeProcessing(
      { status: { uploadStatus: "rejected", rejectionReason: "duplicate" } },
      new Date(),
    ).error,
    "duplicate",
  );
});
test("scheduler preserves workspace, selected account, version and execution time", async () => {
  let queued;
  const plain = { ...input, kind: "Video" };
  // Use a real fixture for scheduler validation, just as the API does.
  const { LocalStorageProvider } =
    await import("../dist-api/storage/local-storage.provider.js");
  const originalRead = LocalStorageProvider.prototype.read;
  const { createReadStream } = await import("node:fs");
  LocalStorageProvider.prototype.read = async () =>
    createReadStream(join(dir, "test.mp4"));
  const { stat } = await import("node:fs/promises");
  const size = (await stat(join(dir, "test.mp4"))).size;
  pool.connect = async () => ({
    release() {},
    query: async (sql, args) => {
      if (sql.startsWith("SELECT * FROM content"))
        return {
          rows: [
            {
              id: assetId,
              workspace_id: wid,
              title: "Scheduled Short",
              workspace_id: wid,
              status: "APPROVED",
              version: 3,
              platforms: ["YouTube"],
              variants: {},
              body: "Scheduled video regression test",
              youtube: plain,
            },
          ],
        };
      if (sql.startsWith("SELECT require_approval"))
        return { rows: [{ require_approval: true }] };
      if (sql.startsWith("SELECT timezone"))
        return { rows: [{ timezone: "Asia/Calcutta", daily_posting_target: 10, festival_automation_enabled: false }] };
      if (sql.includes("media_assets") && !sql.includes("document_source_media")) {
        if (args && args.length > 1) assert.equal(args[1], wid);
        return {
          rows: [
            {
              id: args ? args[0] : assetId,
              type: "VIDEO",
              status: "COMPLETED",
              size_bytes: size,
              bucket: "test",
              object_key: "test.mp4",
              mime_type: "video/mp4",
            },
          ],
        };
      }
      if (sql.startsWith("SELECT a.id")) return { rows: [{ id: accountId }] };
      if (sql.startsWith("INSERT INTO scheduled_posts")) queued = args;
      return { rows: [] };
    },
  });
  try {
    const at = new Date(Date.now() + 120000).toISOString();
    const result = await new ContentController().transition(
      { workspace: { id: wid, role: "Owner" }, user: { id: "u" } },
      assetId,
      "schedule",
      { scheduledAt: at, timezone: "Asia/Calcutta" },
    );
    assert.equal(result.status, "SCHEDULED");
    assert.equal(queued[1], wid);
    assert.equal(queued[3], accountId);
    assert.equal(queued[4], 4);
    assert.equal(queued[5].toISOString(), at);
  } finally {
    LocalStorageProvider.prototype.read = originalRead;
  }
});
