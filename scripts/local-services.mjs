import { readFile, writeFile, mkdir, access, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import pg from "pg";
import { Redis } from "ioredis";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
process.loadEnvFile(path.join(root, ".env"));
const runtime = path.join(root, ".runtime");
await mkdir(runtime, { recursive: true });
if (process.platform !== "win32")
  throw new Error(
    "Use Docker Compose for Linux/macOS; this portable launcher is for Windows.",
  );
const children = [];
async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
function launch(exe, args, options = {}) {
  const p = spawn(exe, args, {
    windowsHide: true,
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  children.push(p);
  p.stdout.on("data", () => {});
  p.stderr.on("data", (d) => {
    const s = d.toString();
    if (/FATAL|PANIC|error/i.test(s))
      console.error(
        s.replaceAll(new URL(process.env.DATABASE_URL).password, "[redacted]"),
      );
  });
  p.on("error", (e) => console.error(e.code || "Process failed"));
  return p;
}
async function archive(url, digest, target) {
  if (await exists(path.join(target, ".installed"))) return;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download failed: ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== digest)
    throw new Error("Archive checksum mismatch");
  await mkdir(target, { recursive: true });
  for (const [name, data] of Object.entries(unzipSync(bytes))) {
    const resolved = path.resolve(target, name);
    if (!resolved.startsWith(path.resolve(target) + path.sep))
      throw new Error("Unsafe archive path");
    if (name.endsWith("/")) await mkdir(resolved, { recursive: true });
    else {
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, data);
    }
  }
  await writeFile(path.join(target, ".installed"), "verified");
}
await Promise.all([
  archive(
    "https://github.com/redis-windows/redis-windows/releases/download/8.10.2/Redis-8.10.2-Windows-x64-msys2.zip",
    "7c8cebd50347eaa1d9e784da842ed47a4f33394637835531d6614777b950ee85",
    path.join(runtime, "redis"),
  ),
]);
async function find(dir, name) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.name === name) return p;
    if (entry.isDirectory()) {
      const result = await find(p, name);
      if (result) return result;
    }
  }
}
const dburl = new URL(process.env.DATABASE_URL);
const isLocalPostgres = dburl.hostname === "127.0.0.1" || dburl.hostname === "localhost";
if (isLocalPostgres) {
  const bin = path.join(
    root,
    "node_modules/@embedded-postgres/windows-x64/native/bin",
  );
  const pgdata = path.join(runtime, "postgres");
  await mkdir(pgdata,{recursive:true});
  const port = dburl.port || "5432";
  const password = decodeURIComponent(dburl.password || "");
  if (!(await exists(path.join(pgdata, "PG_VERSION")))) {
    const pw = path.join(runtime, "init-password");
    await writeFile(pw, password + "\n", { mode: 0o600 });
    try {
      const p = launch(path.join(bin, "initdb.exe"), [
        "-D",
        pgdata,
        "--username=" + (dburl.username || "postgres"),
        "--auth=scram-sha-256",
        "--pwfile=" + pw,
        "--encoding=UTF8",
        "--locale=C",
      ]);
      await new Promise((resolve, reject) => {
        p.on("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new Error("PostgreSQL initialization failed")),
        );
        p.on("error", reject);
      });
    } finally {
      const { unlink } = await import("node:fs/promises");
      await unlink(pw);
    }
  }
  launch(path.join(bin, "postgres.exe"), [
    "-D",
    pgdata,
    "-p",
    port,
    "-h",
    "127.0.0.1",
  ]);
}
const redisUrl = new URL(process.env.REDIS_URL);
const redisExe = await find(path.join(runtime, "redis"), "redis-server.exe");
if (!redisExe) throw new Error("Redis executable missing");
const redisConfig = path.join(path.dirname(redisExe), "redis-local.conf");
const requirePassLine = redisUrl.password ? `requirepass ${decodeURIComponent(redisUrl.password)}\n` : "";
await writeFile(
  redisConfig,
  `bind 127.0.0.1\nport ${redisUrl.port || "6379"}\nprotected-mode no\n${requirePassLine}appendonly yes\nmaxmemory-policy noeviction\n`,
  { mode: 0o600 },
);
launch(redisExe, ["redis-local.conf"], { cwd: path.dirname(redisExe) });
let client;
for (let i = 0; i < 30; i++) {
  try {
    client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    break;
  } catch {
    await client?.end().catch(() => {});
    client = null;
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!client) throw new Error("PostgreSQL did not become ready");
if (isLocalPostgres) {
  const found = await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [
    "contentos",
  ]);
  if (!found.rowCount) await client.query("CREATE DATABASE contentos");
}
await client.end();
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3 });
for (let i = 0; i < 15; i++) {
  try {
    await redis.ping();
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
await redis.quit();
console.log(
  JSON.stringify({
    status: "ready",
    postgres: isLocalPostgres ? ("127.0.0.1:" + (dburl.port || "5432")) : dburl.host,
    database: dburl.pathname.replace(/^\//, ""),
    redis: "127.0.0.1:" + (redisUrl.port || "6379"),
    persistent: true,
  }),
);
async function shutdown() {
  for (const child of children) if (child.exitCode === null) child.kill();
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
