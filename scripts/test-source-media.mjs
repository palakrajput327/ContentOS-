import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import pg from "pg";
import { PDFDocument, rgb } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
const exec = promisify(execFile),
  dir = path.resolve(`.runtime/source-media-test-${Date.now()}`),
  port = 26000 + Math.floor(Math.random() * 5000);
const bin = path.resolve(
  "node_modules/@embedded-postgres/windows-x64/native/bin",
);
let child, db, appPool;
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
  console.log("Starting temporary PostgreSQL");
  await new Promise((resolve, reject) => {
    let log = "";
    child = spawn(
      path.join(bin, "postgres.exe"),
      ["-D", dir, "-p", String(port), "-h", "127.0.0.1"],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    child.on("error", reject);
    child.stderr.on("data", (d) => {
      log += d;
      if (log.includes("ready to accept connections")) resolve();
    });
    child.on("exit", (c) => reject(new Error(`Postgres exit ${c}: ${log}`)));
  });
  console.log("Temporary PostgreSQL ready");
  db = new pg.Pool({
    host: "127.0.0.1",
    port,
    user: "postgres",
    database: "postgres",
  });
  await db.query(
    "CREATE TABLE users(id uuid PRIMARY KEY); CREATE TABLE workspaces(id uuid PRIMARY KEY);",
  );
  for (const migration of [
    "005_media_assets.sql",
    "006_documents.sql",
    "018_document_source_media.sql",
    "019_storage_efficiency.sql",
  ])
    await db.query(
      await readFile(
        new URL(`../server/migrations/${migration}`, import.meta.url),
        "utf8",
      ),
    );
  appPool = (await import("../dist-api/db.js")).pool;
  appPool.query = db.query.bind(db);
  appPool.connect = db.connect.bind(db);
  const { persistDocumentImages } =
    await import("../dist-api/documents/source-media.service.js");
  const { extractSourceImages } =
    await import("../dist-api/documents/extraction/source-images.js");
  const { sourceThumbnail, usefulImageDimensions } =
    await import("../dist-api/documents/extraction/source-thumbnail.js");
  const { storageUsage } =
    await import("../dist-api/storage/storage-budget.js");
  const { uploadManagedMedia } =
    await import("../dist-api/storage/managed-media.js");
  const { sourceRetentionCandidates } =
    await import("../dist-api/storage/source-retention.js");
  const {S3StorageProvider}=await import('../dist-api/storage/s3-storage.provider.js');
  const signer=new S3StorageProvider({endpoint:'https://storage.example.com',region:'us-east-1',accessKeyId:'test-key',secretAccessKey:'test-secret',forcePathStyle:true});
  const signed=await signer.getSignedUploadUrl({bucket:'test',objectKey:'example.pdf',mimeType:'application/pdf',sizeBytes:1234});
  assert.ok(new URL(signed.uploadUrl).searchParams.get('X-Amz-SignedHeaders').includes('content-length'),'S3 upload signature binds reserved file length');
  await db.query(
    "CREATE TABLE content(id uuid,workspace_id uuid,variants jsonb); CREATE TABLE content_versions(workspace_id uuid,snapshot jsonb); CREATE TABLE document_knowledge(id uuid,workspace_id uuid,document_id uuid,metadata jsonb);",
  );
  const ws = randomUUID(),
    other = randomUUID(),
    doc = randomUUID(),
    doc2 = randomUUID(),
    foreign = randomUUID();
  await db.query("INSERT INTO workspaces VALUES($1),($2)", [ws, other]);
  for (const [id, w] of [
    [doc, ws],
    [doc2, ws],
    [foreign, other],
  ]) {
    const media = randomUUID();
    await db.query(
      "INSERT INTO media_assets(id,workspace_id,bucket,object_key,mime_type,size_bytes,original_filename,status) VALUES($1,$2,'test','source.pdf','application/pdf',1,'source.pdf','COMPLETED')",
      [media, w],
    );
    await db.query(
      "INSERT INTO documents(id,workspace_id,media_asset_id,original_filename) VALUES($1,$2,$3,'source.pdf')",
      [id, w, media],
    );
  }
  console.log("Schema and fixtures ready");
  const pdf = await PDFDocument.create();
  const canvas = createCanvas(1200, 900);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#7c3aed";
  ctx.fillRect(0, 0, 1200, 900);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(100, 100, 500, 500);
  ctx.fillStyle = "#202536";
  ctx.fillRect(700, 100, 300, 500);
  const png = canvas.toBuffer("image/png");
  const image = await pdf.embedPng(png);
  for (let i = 0; i < 2; i++)
    pdf
      .addPage([300, 300])
      .drawImage(image, { x: 20, y: 20, width: 240, height: 240 });
  pdf.addPage([300, 300]).drawRectangle({
    x: 10,
    y: 10,
    width: 200,
    height: 200,
    color: rgb(0.5, 0.2, 0.8),
  });
  const buffer = Buffer.from(await pdf.save()),
    found = [];
  console.log("Extracting fixture");
  await extractSourceImages(buffer, async (i) => {
    found.push(i);
  });
  console.log("Found", found.length);
  assert.equal(found.length, 3);
  assert.deepEqual(
    found.map((i) => i.pageNumber),
    [1, 2, 3],
  );
  assert.equal(found[2].kind, "PAGE_RENDER");
  assert.equal(found[0].data.subarray(1, 4).toString(), "PNG");
  const thumb = await sourceThumbnail(found[0]);
  assert.ok(thumb.width <= 512);
  assert.ok(thumb.height <= 512);
  assert.ok(thumb.data.length <= 96 * 1024);
  assert.equal(thumb.data.subarray(8, 12).toString(), "WEBP");
  assert.equal(usefulImageDimensions(32, 32), false);
  assert.equal(
    await sourceThumbnail({ ...found[0], width: 32, height: 32 }),
    null,
  );
  const blank = createCanvas(300, 300);
  blank.getContext("2d").fillRect(0, 0, 300, 300);
  assert.equal(
    await sourceThumbnail({
      ...found[0],
      data: blank.toBuffer("image/png"),
      width: 300,
      height: 300,
    }),
    null,
  );
  let original;
  await extractSourceImages(
    buffer,
    async (image) => {
      original = image;
    },
    {
      pageNumber: 2,
      imageIndex: 0,
      kind: "EMBEDDED_IMAGE",
      includeFiltered: true,
    },
  );
  assert.deepEqual(original.data, found[1].data);
  console.log("Image extraction verified; persisting assets");
  await Promise.all([
    persistDocumentImages(doc, ws, buffer),
    persistDocumentImages(doc2, ws, buffer),
  ]);
  let assets = await db.query(
    "SELECT id FROM media_assets WHERE workspace_id=$1 AND metadata->>'origin'='PDF_SOURCE'",
    [ws],
  );
  assert.equal(assets.rowCount, 2);
  const previews = await db.query(
    "SELECT * FROM media_assets WHERE workspace_id=$1 AND metadata->>'origin'='PDF_SOURCE'",
    [ws],
  );
  assert.ok(
    previews.rows.every(
      (a) =>
        a.mime_type === "image/webp" &&
        a.type === "THUMBNAIL" &&
        a.metadata.originalStored === false,
    ),
  );
  for (const asset of previews.rows) {
    const bytes = await readFile(
      path.join(process.env.STORAGE_LOCAL_DIR, asset.bucket, asset.object_key),
    );
    assert.equal(bytes.length, Number(asset.size_bytes));
  }
  const knowledgeId = randomUUID();
  await db.query("INSERT INTO document_knowledge VALUES($1,$2,$3,'{}')", [
    knowledgeId,
    ws,
    doc,
  ]);
  const originalIds = assets.rows.map((x) => x.id).sort();
  await persistDocumentImages(doc, ws, buffer);
  assets = await db.query(
    "SELECT id FROM media_assets WHERE workspace_id=$1 AND metadata->>'origin'='PDF_SOURCE'",
    [ws],
  );
  assert.deepEqual(assets.rows.map((x) => x.id).sort(), originalIds);
  assert.equal(
    (
      await db.query("SELECT * FROM document_knowledge WHERE id=$1", [
        knowledgeId,
      ])
    ).rowCount,
    1,
  );
  const usage = await storageUsage(db, ws);
  assert.equal(
    usage.sourceMediaBytes,
    previews.rows.reduce((total, a) => total + Number(a.size_bytes), 0),
  );
  await db.query("UPDATE workspaces SET storage_limit_bytes=$2 WHERE id=$1", [
    ws,
    usage.usedBytes + 200,
  ]);
  let writes = 0;
  const fakeProvider = {
    upload: async () => {
      writes++;
    },
  };
  const results = await Promise.allSettled(
    [1, 2].map((n) =>
      uploadManagedMedia({
        workspaceId: ws,
        bucket: "test",
        objectKey: `quota/${n}`,
        body: Buffer.alloc(150),
        mimeType: "image/png",
        filename: "quota.png",
        type: "IMAGE",
        provider: fakeProvider,
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(writes, 1);
  assert.ok(
    results
      .find((r) => r.status === "rejected")
      .reason.message.includes("storage quota"),
  );
  await assert.rejects(
    db.query(
      "INSERT INTO media_assets(id,workspace_id,bucket,object_key,mime_type,size_bytes,original_filename,status) VALUES($1,$2,'test','pending','image/png',100,'pending.png','PENDING')",
      [randomUUID(), ws],
    ),
    /storage quota/,
  );
  await db.query(
    "UPDATE workspaces SET storage_limit_bytes=1073741824 WHERE id=$1",
    [ws],
  );
  assert.equal(
    (
      await db.query(
        "SELECT * FROM document_source_media WHERE document_id=$1",
        [doc],
      )
    ).rowCount,
    3,
  );
  await persistDocumentImages(foreign, other, buffer);
  const foreignAssets = await db.query(
    "SELECT id FROM media_assets WHERE workspace_id=$1 AND metadata->>'origin'='PDF_SOURCE'",
    [other],
  );
  assert.equal(foreignAssets.rowCount, 2);
  assert.ok(foreignAssets.rows.every((x) => !originalIds.includes(x.id)));
  await persistDocumentImages(doc, other, buffer);
  assert.equal(
    (
      await db.query(
        "SELECT * FROM document_source_media WHERE document_id=$1 AND workspace_id=$2",
        [doc, other],
      )
    ).rowCount,
    0,
  );
  await persistDocumentImages(doc, ws, Buffer.from("invalid pdf"));
  assert.equal(
    (
      await db.query(
        "SELECT media_extraction_status FROM documents WHERE id=$1",
        [doc],
      )
    ).rows[0].media_extraction_status,
    "FAILED",
  );
  assert.equal(
    (
      await db.query(
        "SELECT * FROM document_source_media WHERE document_id=$1",
        [doc],
      )
    ).rowCount,
    3,
  );
  await db.query("DELETE FROM documents WHERE id=$1", [doc]);
  assert.equal((await sourceRetentionCandidates(db, ws)).assets.length, 0);
  await db.query("DELETE FROM documents WHERE id=$1", [doc2]);
  assert.equal(
    (await sourceRetentionCandidates(db, ws)).assets.length,
    0,
    "Newly unreferenced previews have a 30-day grace period",
  );
  await db.query(
    "UPDATE media_assets SET source_last_referenced_at=now()-interval '31 days' WHERE id=ANY($1::uuid[])",
    [originalIds],
  );
  assert.equal((await sourceRetentionCandidates(db, ws)).assets.length, 2);
  await db.query("INSERT INTO content VALUES($1,$2,$3)", [
    randomUUID(),
    ws,
    JSON.stringify({ LinkedIn: { mediaAssetId: originalIds[0] } }),
  ]);
  assert.equal(
    (await sourceRetentionCandidates(db, ws)).assets.length,
    1,
    "Referenced content is excluded from cleanup candidates",
  );
  assert.equal(
    (
      await db.query(
        "SELECT * FROM document_source_media WHERE document_id=$1",
        [doc],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT * FROM document_source_media WHERE document_id=$1",
        [doc2],
      )
    ).rowCount,
    0,
  );
  console.log(
    "PASS: thumbnails, useful-image filtering, on-demand originals, concurrent dedup and quotas, rerun identity, knowledge preservation, tenant isolation, failure retention and read-only retention candidates.",
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  if (db) await db.end();
  if (appPool) await appPool.end();
  if (child && child.exitCode === null)
    await exec(
      path.join(bin, "pg_ctl.exe"),
      ["-D", dir, "stop", "-m", "fast"],
      { windowsHide: true },
    );
}
