import assert from "node:assert/strict";
import {
  publishMeta,
  publicMetaUrl,
  waitMetaReady,
} from "../dist-api/meta.publishing.js";
import {
  metaMediaTicket,
  readMetaMediaTicket,
  resolveMetaMedia,
} from "../dist-api/meta.media.js";
import { metaFrontendUrl } from "../dist-api/social.oauth.js";
const savedFetch = globalThis.fetch;
const saved = {
  key: process.env.TOKEN_ENCRYPTION_KEY,
  redirect: process.env.FACEBOOK_REDIRECT_URI,
  base: process.env.META_MEDIA_PUBLIC_BASE_URL,
  app: process.env.APP_URL,
};
const calls = [];
let responses = [];
globalThis.fetch = async (url, options) => {
  calls.push({ url: String(url), options });
  const response = responses.shift();
  assert.ok(response, "Unexpected Meta API request");
  if (response instanceof Error) throw response;
  return { ok: true, json: async () => response };
};
try {
  process.env.TOKEN_ENCRYPTION_KEY = "ab".repeat(32);
  const photo = {
    destination: "123",
    text: "Caption",
    mediaType: "image",
    mediaUrl: "https://cdn.example.com/photo.jpg",
  };
  responses = [{ id: "c" }, { status_code: "FINISHED" }, { id: "ig" }];
  assert.equal(await publishMeta("instagram", "test", photo), "ig");
  responses = [{ id: "c" }, { status_code: "FINISHED" }, { id: "reel" }];
  assert.equal(
    await publishMeta("instagram", "test", {
      ...photo,
      mediaType: "video",
      metadata: { shareToFeed: false },
    }),
    "reel",
  );
  assert.equal(calls.at(-3).options.body.get("media_type"), "REELS");
  assert.equal(calls.at(-3).options.body.get("share_to_feed"), "false");
  responses = [{ id: "p" }];
  assert.equal(
    await publishMeta("facebook", "test", {
      destination: "123",
      text: "Text",
      mediaType: "text",
    }),
    "p",
  );
  assert.match(calls.at(-1).url, /\/feed$/);
  responses = [{ id: "p" }];
  assert.equal(await publishMeta("facebook", "test", photo), "p");
  responses = [{ id: "v" }, { status: { video_status: "ready" } }];
  assert.equal(
    await publishMeta("facebook", "test", { ...photo, mediaType: "video" }),
    "v",
  );
  assert.match(calls.at(-2).url, /graph-video.facebook.com/);
  responses = [
    { video_id: "r" },
    { success: true },
    { status: { uploading_phase: { status: "complete" } } },
    { success: true },
    { status: { publishing_phase: { status: "complete" } } },
  ];
  assert.equal(
    await publishMeta("facebook", "test", {
      ...photo,
      mediaType: "video",
      metadata: { publishAs: "reel" },
    }),
    "r",
  );
  assert.match(calls.at(-4).url, /^https:\/\/rupload.facebook.com/);
  assert.equal(calls.at(-4).options.headers.Authorization, "OAuth test");
  responses = [{ id: "c" }, { status_code: "ERROR" }];
  await assert.rejects(
    publishMeta("instagram", "test", photo),
    (e) => /processing failed/.test(e.message) && !e.uncertain,
  );
  responses = [
    { id: "c" },
    { status_code: "FINISHED" },
    new Error("network timeout"),
  ];
  await assert.rejects(
    publishMeta("instagram", "test", photo),
    (e) => e.uncertain === true,
  );
  responses = [{ status_code: "IN_PROGRESS" }, { status_code: "FINISHED" }];
  await waitMetaReady("c", "test", "instagram", false, 2, 0);
  responses = [{ status: { video_status: "processing" } }];
  await assert.rejects(
    waitMetaReady("v", "test", "facebook", true, 1, 0),
    (e) => e.uncertain === true,
  );
  for (const url of [
    "http://localhost/a",
    "http://127.0.0.1/a",
    "http://10.0.0.2/a",
    "file:///x",
    "/api/private",
  ])
    assert.throws(() => publicMetaUrl(url));
  await assert.rejects(
    publishMeta("instagram", "test", { destination: "1", text: "Only text" }),
    /requires an image or video/,
  );
  await assert.rejects(
    publishMeta("facebook", "test", { ...photo, mediaType: "document" }),
    /documents/,
  );
  const ticket = metaMediaTicket("workspace", "asset");
  assert.equal(readMetaMediaTicket(ticket).assetId, "asset");
  assert.throws(() => readMetaMediaTicket(ticket + "bad"));
  process.env.FACEBOOK_REDIRECT_URI =
    "https://example.com/api/v1/social/facebook/callback";
  process.env.APP_URL = "http://localhost:5173";
  assert.equal(metaFrontendUrl(), "https://example.com");
  process.env.FACEBOOK_REDIRECT_URI =
    "http://localhost:3001/api/v1/social/facebook/callback";
  assert.equal(metaFrontendUrl(), "http://localhost:5173");
  process.env.META_MEDIA_PUBLIC_BASE_URL = "https://example.com";
  const db = {
    query: async (sql, params) => {
      assert.deepEqual(params, ["asset", "workspace"]);
      return {
        rows: [
          { mime_type: "video/mp4", bucket: "bucket", object_key: "video.mp4" },
        ],
      };
    },
  };
  const media = await resolveMetaMedia(db, "workspace", "asset");
  assert.equal(media.type, "video");
  assert.match(
    media.url,
    /https:\/\/example.com\/api\/v1\/social\/meta\/media\//,
  );
  assert.equal(
    readMetaMediaTicket(media.url.split("/").at(-1)).workspaceId,
    "workspace",
  );
  await assert.rejects(
    resolveMetaMedia({ query: async () => ({ rows: [] }) }, "other", "asset"),
    /missing or incomplete/,
  );
  console.log(
    "Meta image, feed video, Reels, processing failures, uncertain outcomes, local redirects and scoped media links passed.",
  );
} finally {
  globalThis.fetch = savedFetch;
  for (const [key, value] of Object.entries({
    TOKEN_ENCRYPTION_KEY: saved.key,
    FACEBOOK_REDIRECT_URI: saved.redirect,
    META_MEDIA_PUBLIC_BASE_URL: saved.base,
    APP_URL: saved.app,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
