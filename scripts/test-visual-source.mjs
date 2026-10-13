import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
const exec = promisify(execFile),
  dir = path.resolve(`.runtime/visual-source-test-${Date.now()}`),
  port = 31000 + Math.floor(Math.random() * 3000),
  bin = path.resolve("node_modules/@embedded-postgres/windows-x64/native/bin");
let child, db, pool, app;
process.env.STORAGE_LOCAL_DIR = path.join(dir, "media");
process.env.STORAGE_ENDPOINT = "";
try {
  await exec(
    path.join(bin, "initdb.exe"),
    [
      "-D",
      dir,
      "--username=postgres",
      "--auth=trust",
      "--locale=C",
      "--encoding=UTF8",
    ],
    { windowsHide: true },
  );
  await new Promise((resolve, reject) => {
    let log = "";
    child = spawn(
      path.join(bin, "postgres.exe"),
      ["-D", dir, "-p", String(port), "-h", "127.0.0.1"],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    child.on("error", reject);
    child.on("exit", (c) => reject(new Error(`Postgres exited ${c}: ${log}`)));
    child.stderr.on("data", (d) => {
      log += d;
      if (log.includes("ready to accept connections")) resolve();
    });
  });
  db = new pg.Pool({
    host: "127.0.0.1",
    port,
    user: "postgres",
    database: "postgres",
  });
  for (const file of [
    "001_auth.sql",
    "002_codes_workspaces.sql",
    "005_media_assets.sql",
    "006_documents.sql",
    "007_ai_knowledge.sql",
    "018_document_source_media.sql",
    "019_storage_efficiency.sql",
    "020_visual_source_knowledge.sql",
  ])
    await db.query(
      await readFile(
        new URL(`../server/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  pool = (await import("../dist-api/db.js")).pool;
  pool.query = db.query.bind(db);
  pool.connect = db.connect.bind(db);
  const { VisualKnowledgeService } =
    await import("../dist-api/documents/visual-knowledge.service.js");
  const {
    SourcePosterService,
    sourcePosterSchema,
    renderSourcePoster,
    approveSourceReuse,
  } = await import("../dist-api/documents/source-poster.js");
  const { sourceReference } =
    await import("../dist-api/documents/source-original.js");
  const { assertSourceMediaPublication } =
    await import("../dist-api/documents/source-publishing-guard.js");
  const { validVisualKnowledgeRows } =
    await import("../dist-api/documents/visual-evidence.js");
  const { VisualMediaController } =
    await import("../dist-api/documents/visual-media.controller.js");
  const { OpenAICompatibleProvider } =
    await import("../dist-api/ai/openai-compatible.provider.js");
  const { z } = await import("zod");
  const ws = randomUUID(),
    other = randomUUID(),
    user = randomUUID(),
    doc = randomUUID(),
    media = randomUUID(),
    sourceAsset = randomUUID(),
    sourceId = randomUUID();
  await db.query(
    "INSERT INTO users(id,email,name,password_hash,terms_accepted_at) VALUES($1,'fixture@example.com','Tester','fixture',now())",
    [user],
  );
  await db.query(
    "INSERT INTO workspaces(id,name,timezone) VALUES($1,'Test studio','Asia/Kolkata'),($2,'Other studio','Asia/Kolkata')",
    [ws, other],
  );
  await db.query("INSERT INTO workspace_members VALUES($1,$2,'Owner')", [
    ws,
    user,
  ]);
  await db.query("INSERT INTO brand_kits VALUES($1,$2)", [
    ws,
    JSON.stringify({ name: "Hindustan Studio", cta: "Explore our catalogue" }),
  ]);
  const canvas = createCanvas(1000, 800),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(0, 0, 1000, 800);
  ctx.fillStyle = "#704bd6";
  ctx.fillRect(160, 100, 680, 600);
  const image = canvas.toBuffer("image/png");
  const pdfDoc = await PDFDocument.create(),
    pdfImage = await pdfDoc.embedPng(image);
  pdfDoc.addPage([500, 500]).drawImage(pdfImage, { width: 500, height: 500 });
  pdfDoc.addPage([500, 500]).drawImage(pdfImage, { width: 500, height: 500 });
  const pdfBuffer = Buffer.from(await pdfDoc.save());
  const { extractSourceImages } =
    await import("../dist-api/documents/extraction/source-images.js");
  let reconstructed;
  await extractSourceImages(
    pdfBuffer,
    async (image) => {
      reconstructed = image.data;
    },
    {
      pageNumber: 2,
      imageIndex: 0,
      kind: "EMBEDDED_IMAGE",
      includeFiltered: true,
    },
  );
  const sourceChecksum = createHash("sha256")
    .update(reconstructed)
    .digest("hex");
  const { LocalStorageProvider } =
    await import("../dist-api/storage/local-storage.provider.js");
  await new LocalStorageProvider().upload({
    bucket: "test",
    objectKey: "original.pdf",
    body: pdfBuffer,
    mimeType: "application/pdf",
  });
  for (const [id, type, key, mime, meta] of [
    [media, "DOCUMENT", "original.pdf", "application/pdf", {}],
    [
      sourceAsset,
      "THUMBNAIL",
      "preview.webp",
      "image/webp",
      { origin: "PDF_SOURCE", reuseEligibility: "UNREVIEWED" },
    ],
  ])
    await db.query(
      `INSERT INTO media_assets(id,workspace_id,type,bucket,object_key,mime_type,size_bytes,original_filename,status,metadata,checksum) VALUES($1,$2,$3,'test',$4,$5,1,$4,'COMPLETED',$6,$7)`,
      [id, ws, type, key, mime, JSON.stringify(meta), sourceChecksum],
    );
  await db.query(
    "INSERT INTO documents(id,workspace_id,media_asset_id,original_filename,status) VALUES($1,$2,$3,'Catalogue.pdf','READY')",
    [doc, ws, media],
  );
  await db.query(
    "INSERT INTO document_source_media VALUES($1,$2,$3,$4,2,0,'EMBEDDED_IMAGE',now())",
    [sourceId, ws, doc, sourceAsset],
  );
  console.log("Visual source fixtures ready");
  let ocrCalls = 0,
    visionCalls = 0;
  const service = new VisualKnowledgeService(
    async () => {
      ocrCalls++;
      return {
        text: "Product catalogue: practical design services.",
        confidence: 0.8,
        provider: "fixture",
      };
    },
    async () => {
      visionCalls++;
      return {
        observations: [
          {
            text: "A violet product illustration is shown on a light background.",
            confidence: 0.9,
          },
        ],
        provider: "fixture",
        model: "fixture-vision",
      };
    },
    async () => image,
  );
  await service.analyze(ws, doc, sourceId, user, true);
  let facts = (
    await db.query("SELECT * FROM document_knowledge WHERE document_id=$1", [
      doc,
    ])
  ).rows;
  assert.equal(facts.length, 2);
  assert.ok(facts.every((k) => k.status === "EXTRACTED"));
  assert.deepEqual(
    new Set(facts.map((k) => k.knowledge_type)),
    new Set(["OCR_TEXT", "VISUAL_INSIGHT"]),
  );
  assert.ok(
    facts.every(
      (k) =>
        k.page_start === 2 && k.metadata.sourceMediaAssetId === sourceAsset,
    ),
  );
  assert.equal((await validVisualKnowledgeRows(db, ws, facts)).length, 2);
  await db.query("UPDATE media_assets SET checksum='changed' WHERE id=$1", [
    sourceAsset,
  ]);
  assert.equal(
    (await validVisualKnowledgeRows(db, ws, facts)).length,
    0,
    "Stale source facts cannot feed automation",
  );
  await db.query("UPDATE media_assets SET checksum=$2 WHERE id=$1", [
    sourceAsset,
    sourceChecksum,
  ]);
  const fact = facts[0];
  await db.query(
    "UPDATE document_knowledge SET value='\"Reviewed correction\"',status='CONFIRMED' WHERE id=$1",
    [fact.id],
  );
  await service.analyze(ws, doc, sourceId, user, true);
  assert.equal(ocrCalls, 1);
  assert.equal(visionCalls, 1);
  assert.equal(
    (
      await db.query("SELECT * FROM document_knowledge WHERE document_id=$1", [
        doc,
      ])
    ).rowCount,
    2,
  );
  assert.equal(
    (
      await db.query(
        "SELECT value,status FROM document_knowledge WHERE id=$1",
        [fact.id],
      )
    ).rows[0].value,
    "Reviewed correction",
  );
  await assert.rejects(
    service.analyze(other, doc, sourceId, user, false),
    /not found/,
  );
  await db.query(
    "UPDATE source_media_analysis SET lease_until=now()+interval '5 minutes' WHERE workspace_id=$1 AND media_asset_id=$2",
    [ws, sourceAsset],
  );
  await assert.rejects(
    service.analyze(ws, doc, sourceId, user, false),
    /already being analyzed/,
  );
  await db.query(
    "UPDATE source_media_analysis SET lease_until=NULL WHERE workspace_id=$1",
    [ws],
  );
  await db.query(
    "UPDATE source_media_analysis SET vision_status='FAILED' WHERE workspace_id=$1",
    [ws],
  );
  const failedVision = new VisualKnowledgeService(
    async () => {
      throw new Error("OCR should be cached");
    },
    async () => {
      throw new Error("Vision unavailable");
    },
    async () => image,
  );
  const partial = await failedVision.analyze(ws, doc, sourceId, user, true);
  assert.equal(partial.ocrStatus, "READY");
  assert.equal(partial.visionStatus, "FAILED");
  assert.ok(partial.error.includes("Vision unavailable"));
  assert.equal(
    (
      await db.query("SELECT * FROM document_knowledge WHERE document_id=$1", [
        doc,
      ])
    ).rowCount,
    2,
  );
  const request = { workspace: { id: ws, role: "Viewer" }, user: { id: user } };
  await assert.rejects(
    new VisualMediaController().reuse(request, doc, sourceId, {
      allowed: true,
      rightsConfirmed: true,
    }),
    (error) => error.getStatus?.() === 403,
  );
  await assert.rejects(
    new VisualMediaController().reuse(
      { ...request, workspace: { id: ws, role: "Editor" } },
      doc,
      sourceId,
      { allowed: true },
    ),
    /Confirm that/,
  );
  const posterService = new SourcePosterService(async () => image),
    input = sourcePosterSchema.parse({
      headline: "Design that tells your story",
      subtitle: "Practical services for your business",
      cta: "Explore our catalogue",
    });
  await assert.rejects(
    posterService.create(ws, doc, sourceId, user, input),
    /Approve this source image/,
  );
  const source = await sourceReference(db, ws, doc, sourceId);
  await approveSourceReuse(db, ws, source, user, true);
  const poster = await posterService.create(ws, doc, sourceId, user, input),
    repeat = await posterService.create(ws, doc, sourceId, user, input);
  assert.equal(poster.assetId, repeat.assetId);
  const asset = (
    await db.query("SELECT * FROM media_assets WHERE id=$1", [poster.assetId])
  ).rows[0];
  assert.equal(asset.metadata.sourceMediaAssetId, sourceAsset);
  assert.equal(asset.metadata.pageNumber, 2);
  assert.equal(asset.mime_type, "image/jpeg");
  const jpeg = await readFile(
    path.join(process.env.STORAGE_LOCAL_DIR, asset.bucket, asset.object_key),
  );
  assert.equal(jpeg[0], 255);
  assert.equal(jpeg[1], 216);
  const decoded = await loadImage(jpeg);
  assert.equal(decoded.width, 1080);
  assert.equal(decoded.height, 1080);
  await mkdir(".runtime/visual-qa", { recursive: true });
  await (
    await import("node:fs/promises")
  ).writeFile(".runtime/visual-qa/source-poster.jpg", jpeg);
  const approved = { status: "APPROVED", approved_by: user };
  await assertSourceMediaPublication(db, ws, poster.assetId, approved);
  await assert.rejects(
    assertSourceMediaPublication(db, ws, poster.assetId, { status: "DRAFT" }),
    /require approval/,
  );
  await assert.rejects(
    assertSourceMediaPublication(db, ws, sourceAsset, approved),
    /preview cannot be published/,
  );
  await approveSourceReuse(db, ws, source, user, false);
  await assert.rejects(
    assertSourceMediaPublication(db, ws, poster.assetId, approved),
    /reuse approval/,
  );
  await approveSourceReuse(db, ws, source, user, true);
  await assert.rejects(
    assertSourceMediaPublication(db, ws, poster.assetId, approved),
    /reuse approval/,
  );
  const refreshed = await posterService.create(ws, doc, sourceId, user, input);
  assert.notEqual(refreshed.assetId, poster.assetId);
  await assertSourceMediaPublication(db, ws, refreshed.assetId, approved);
  for (const format of ["portrait", "landscape"]) {
    const result = await renderSourcePoster(
      image,
      sourcePosterSchema.parse({ headline: "Business design", format }),
      { name: "Hindustan Studio" },
    );
    const dimensions = await loadImage(result.buffer);
    assert.equal(dimensions.height, format === "portrait" ? 1350 : 628);
  }
  await assert.rejects(
    posterService.create(other, doc, sourceId, user, input),
    /not found/,
  );
  const usage = Number(
    (
      await db.query(
        "SELECT SUM(size_bytes) AS bytes FROM media_assets WHERE workspace_id=$1",
        [ws],
      )
    ).rows[0].bytes,
  );
  await db.query("UPDATE workspaces SET storage_limit_bytes=$2 WHERE id=$1", [
    ws,
    usage,
  ]);
  await assert.rejects(
    posterService.create(ws, doc, sourceId, user, {
      ...input,
      headline: "Another design",
    }),
    /storage quota/,
  );
  let payload;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' } }],
      }),
    };
  };
  try {
    const provider = new OpenAICompatibleProvider({
      apiKey: "fixture",
      baseUrl: "https://example.com/v1",
      model: "fixture",
      maxRetries: 0,
    });
    await provider.generateStructured({
      messages: [
        {
          role: "user",
          content: "Return JSON",
          images: ["data:image/png;base64,fixture"],
        },
      ],
      schema: z.object({ ok: z.boolean() }),
    });
    assert.equal(payload.messages[0].content[1].type, "image_url");
    assert.equal(payload.messages[0].content[0].text, "Return JSON");
  } finally {
    globalThis.fetch = savedFetch;
  }
  await db.query(
    "UPDATE workspaces SET storage_limit_bytes=1073741824 WHERE id=$1",
    [ws],
  );
  const { NestFactory } = await import("@nestjs/core"),
    { Module } = await import("@nestjs/common");
  class FixtureModule {}
  Module({ controllers: [VisualMediaController] })(FixtureModule);
  app = await NestFactory.create(FixtureModule, { logger: false });
  app.use((req, _res, next) => {
    req.user = { id: user, name: "Fixture user" };
    req.workspace = {
      id: req.headers["x-fixture-workspace"] || ws,
      role: req.headers["x-fixture-role"] || "Owner",
    };
    next();
  });
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl(),
    endpoint = `${base}/documents/${doc}/source-media/${sourceId}`;
  const denied = await fetch(endpoint + "/reuse", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-fixture-role": "Viewer" },
    body: JSON.stringify({ allowed: true, rightsConfirmed: true }),
  });
  assert.equal(denied.status, 403);
  const foreignResponse = await fetch(endpoint + "/poster", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-fixture-workspace": other,
    },
    body: JSON.stringify(input),
  });
  assert.equal(foreignResponse.status, 404);
  const renderedResponse = await fetch(endpoint + "/poster", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  assert.equal(renderedResponse.status, 201);
  assert.ok((await renderedResponse.json()).assetId);
  console.log(
    "PASS: OCR/vision separation, review preservation, cached analysis, leases, tenant/role isolation, partial failure, reuse consent, poster render/dedup/lineage, approval/revocation publishing guards, quotas and multimodal adapter.",
  );
} finally {
  if (app) await app.close();
  if (db) await db.end();
  if (pool) await pool.end();
  if (child && child.exitCode === null)
    await exec(
      path.join(bin, "pg_ctl.exe"),
      ["-D", dir, "stop", "-m", "fast"],
      { windowsHide: true },
    );
}
