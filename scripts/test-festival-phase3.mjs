import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import pg from "pg";
import {
  dailyCapacity,
  getDailyCapacity,
  assertDailySlot,
} from "../dist-api/calendar/daily-posting.js";

assert.deepEqual(dailyCapacity(3, 1, 1, 0), {
  target: 3,
  scheduled: 1,
  reserved: 1,
  remaining: 1,
  overTarget: 0,
});
assert.equal(dailyCapacity(3, 3, 1, 1).remaining, 0);
assert.equal(dailyCapacity(3, 4, 1, 1).overTarget, 1);
const taskDir = path.resolve(`.runtime/phase3-test-${Date.now()}`);
const taskPort = 16000 + Math.floor(Math.random() * 10000);
const bin = path.resolve(
  "node_modules/@embedded-postgres/windows-x64/native/bin",
);
const exec = promisify(execFile);
let child;
const engine = {
  initialise: () =>
    exec(
      path.join(bin, "initdb.exe"),
      [
        "-D",
        taskDir,
        "--username=postgres",
        "--auth=trust",
        "--locale=C",
        "--encoding=UTF8",
      ],
      { windowsHide: true },
    ),
  start: () =>
    new Promise((resolve, reject) => {
      let log = "";
      child = spawn(
        path.join(bin, "postgres.exe"),
        ["-D", taskDir, "-p", String(taskPort), "-h", "127.0.0.1"],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      child.on("error", reject);
      child.on("exit", (code) =>
        reject(new Error("Postgres exited: " + code + " " + log)),
      );
      child.stderr.on("data", (data) => {
        log += data.toString();
        if (log.includes("ready to accept connections")) resolve();
      });
    }),
  stop: async () => {
    if (child && child.exitCode === null)
      await exec(
        path.join(bin, "pg_ctl.exe"),
        ["-D", taskDir, "stop", "-m", "fast"],
        { windowsHide: true },
      );
  },
};
let database;
try {
  await engine.initialise();
  await engine.start();
  database = new pg.Pool({
    host: "127.0.0.1",
    port: taskPort,
    user: "postgres",
    password: "password",
    database: "postgres",
  });
  await database.query(`CREATE TABLE workspaces(id uuid PRIMARY KEY,name text,timezone text,festival_automation_enabled boolean DEFAULT false,festival_region text DEFAULT 'ALL');
    CREATE TABLE content(id uuid PRIMARY KEY,workspace_id uuid,variants jsonb DEFAULT '{}');
    CREATE TABLE scheduled_posts(id uuid PRIMARY KEY,workspace_id uuid,content_id uuid,execute_at timestamptz,state text);`);
  await database.query(
    await readFile(
      new URL("../server/migrations/016_daily_posting.sql", import.meta.url),
      "utf8",
    ),
  );
  await database.query(
    await readFile(
      new URL(
        "../server/migrations/014_festival_automation.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await database.query(
    await readFile(
      new URL(
        "../server/migrations/015_festival_auto_publish.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await database.query(`ALTER TABLE content ADD COLUMN title text, ADD COLUMN status text DEFAULT 'NEEDS_REVIEW', ADD COLUMN scheduled_at timestamptz;
    ALTER TABLE scheduled_posts ADD COLUMN account_id uuid, ADD COLUMN error_code text, ADD COLUMN provider_post_id text, ADD COLUMN attempt_started_at timestamptz;
    CREATE TABLE social_accounts(id uuid PRIMARY KEY,workspace_id uuid,name text,platform text,state text,provider_id text DEFAULT 'test');
    CREATE TABLE social_account_tokens(account_id uuid PRIMARY KEY,expires_at timestamptz);
    CREATE TABLE brand_kits(workspace_id uuid PRIMARY KEY,data jsonb);
    ALTER TABLE content ADD COLUMN version integer DEFAULT 1, ADD COLUMN approved_by uuid, ADD COLUMN scheduled_by uuid, ADD COLUMN timezone text, ADD COLUMN platforms jsonb DEFAULT '[]', ADD COLUMN updated_at timestamptz;
    ALTER TABLE scheduled_posts ADD COLUMN content_version integer DEFAULT 1, ADD COLUMN timezone text, ADD CONSTRAINT schedule_unique UNIQUE(content_id,account_id,content_version);
    CREATE TABLE approvals(id uuid,workspace_id uuid,content_id uuid,version integer,actor_id uuid,decision text);
    CREATE TABLE activity_logs(id uuid,workspace_id uuid,actor_id uuid,action text,entity_type text,entity_id text,entity text,previous_value jsonb,new_value jsonb);`);
  const ws = randomUUID(),
    other = randomUUID(),
    post = randomUUID(),
    festival = randomUUID();
  await database.query(
    `INSERT INTO workspaces(id,timezone,festival_automation_enabled) VALUES($1,'Asia/Kolkata',true),($2,'Asia/Kolkata',false)`,
    [ws, other],
  );
  assert.equal(
    (await getDailyCapacity(database, ws, "2026-10-20")).reserved,
    1,
  );
  assert.equal(
    (await getDailyCapacity(database, other, "2026-10-20")).reserved,
    0,
  );
  await database.query(
    `INSERT INTO content(id,workspace_id,variants) VALUES($1,$2,'{}'),($3,$2,'{"metadata":{"content_source":"INDIAN_FESTIVAL_ENGINE"}}')`,
    [post, ws, festival],
  );
  for (let i = 0; i < 2; i++)
    await database.query(
      `INSERT INTO scheduled_posts(id,workspace_id,content_id,execute_at,state) VALUES($1,$2,$3,'2026-10-20T03:30Z','PENDING')`,
      [randomUUID(), ws, post],
    );
  assert.equal(
    (await getDailyCapacity(database, ws, "2026-10-20")).scheduled,
    1,
    "Multiple accounts consume one daily slot",
  );
  assert.equal(
    (await getDailyCapacity(database, other, "2026-10-20")).scheduled,
    0,
    "Workspace isolation",
  );
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await assert.rejects(
      assertDailySlot(
        client,
        ws,
        { id: randomUUID(), variants: {} },
        new Date("2026-10-20T03:35Z"),
      ),
      /occupies/,
    );
    await client.query("ROLLBACK");
    await database.query(
      `UPDATE workspaces SET daily_posting_target=2 WHERE id=$1`,
      [ws],
    );
    await client.query("BEGIN");
    await assert.rejects(
      assertDailySlot(
        client,
        ws,
        { id: randomUUID(), variants: {} },
        new Date("2026-10-20T06:30Z"),
      ),
      /reserved/,
    );
    await client.query("ROLLBACK");
    assert.equal(
      (
        await database.query(
          "SELECT execute_at FROM scheduled_posts WHERE content_id=$1",
          [post],
        )
      ).rows[0].execute_at.toISOString(),
      "2026-10-20T03:30:00.000Z",
      "Approved schedules preserved",
    );
    await database.query(
      `INSERT INTO scheduled_posts(id,workspace_id,content_id,execute_at,state) VALUES($1,$2,$3,'2026-10-20T06:30Z','PUBLISHED')`,
      [randomUUID(), ws, festival],
    );
    assert.equal(
      (await getDailyCapacity(database, ws, "2026-10-20")).reserved,
      0,
      "Festival publication consumes its reserved slot",
    );
    assert.equal(
      (await getDailyCapacity(database, ws, "2026-10-20")).scheduled,
      2,
    );
    await database.query(
      `UPDATE scheduled_posts SET state='CANCELLED' WHERE content_id=$1`,
      [post],
    );
    assert.equal(
      (await getDailyCapacity(database, ws, "2026-10-20")).remaining,
      1,
    );
    await assert.rejects(
      database.query(
        "UPDATE workspaces SET daily_posting_target=0 WHERE id=$1",
        [ws],
      ),
      /check constraint/,
    );
  } finally {
    client.release();
  }
  const { pool } = await import("../dist-api/db.js");
  pool.query = database.query.bind(database);
  pool.connect = database.connect.bind(database);
  const { FestivalController } =
    await import("../dist-api/calendar/festival.controller.js");
  const controller = new FestivalController();
  const req = {
    workspace: { id: ws, role: "Owner" },
    user: { id: randomUUID() },
  };
  const account = randomUUID();
  await database.query(
    `INSERT INTO social_accounts(id,workspace_id,name,platform,state) VALUES($1,$2,'Test LinkedIn','LinkedIn','Connected')`,
    [account, ws],
  );
  await database.query(
    `INSERT INTO brand_kits VALUES($1,'{"name":"Test Brand"}')`,
    [ws],
  );
  await database.query(`INSERT INTO social_account_tokens VALUES($1,NULL)`, [
    account,
  ]);
  await controller.updateSettings(req, {
    festival_automation_enabled: true,
    festival_auto_publish_enabled: true,
    festival_social_account_ids: [account],
    daily_posting_target: 5,
    festival_post_time: "10:30",
  });
  assert.equal((await controller.getSettings(req)).daily_posting_target, 5);
  assert.equal(
    (await controller.getSettings(req)).festival_auto_publish_enabled,
    true,
  );
  assert.equal(
    (await controller.getSettings({ workspace: { id: other } }))
      .festival_auto_publish_enabled,
    false,
  );
  await assert.rejects(
    controller.updateSettings(
      { ...req, workspace: { id: ws, role: "Viewer" } },
      { daily_posting_target: 10 },
    ),
  );
  await assert.rejects(
    controller.updateSettings(req, { festival_post_time: "29:00" }),
  );
  await assert.rejects(
    controller.updateSettings(req, {
      festival_social_account_ids: [randomUUID()],
    }),
    /connected/,
  );
  await database.query(
    `INSERT INTO scheduled_festival_posts(id,workspace_id,festival_id,festival_date,content_id) VALUES($1,$2,'dussehra','2026-10-20',$3)`,
    [randomUUID(), ws, festival],
  );
  assert.equal((await controller.monitor(req)).posts.length, 1);
  assert.equal(
    (await controller.monitor({ workspace: { id: other } })).posts.length,
    0,
  );
  assert.equal((await controller.monitor(req)).hasBrand, true);
  const uncertain = randomUUID();
  await database.query(
    `INSERT INTO scheduled_posts(id,workspace_id,content_id,execute_at,state,account_id,error_code) VALUES($1,$2,$3,'2026-10-20T06:30Z','UNCERTAIN',$4,'VERIFY_REQUIRED')`,
    [uncertain, ws, festival, account],
  );
  const live = await controller.monitor(req);
  assert.equal(live.posts[0].jobs[0].state, "UNCERTAIN");
  await assert.rejects(controller.retry(req, uncertain), /confirmed failed/);
  await assert.rejects(
    controller.retry(
      { workspace: { id: other, role: "Owner" }, user: req.user },
      uncertain,
    ),
    /confirmed failed/,
  );
  await assert.rejects(controller.retry(req, randomUUID()), /confirmed failed/);
  const manual=randomUUID();
  const manualAt=new Date(Date.now()+7*86400000).toISOString();
  await database.query(`INSERT INTO content(id,workspace_id,title,variants) VALUES($1,$2,'Manual Festival','{"metadata":{"content_source":"INDIAN_FESTIVAL_ENGINE"}}')`,[manual,ws]);
  await database.query(`INSERT INTO scheduled_festival_posts(id,workspace_id,festival_id,festival_date,content_id) VALUES($1,$2,'manual-test',$3,$4)`,[randomUUID(),ws,manualAt.slice(0,10),manual]);
  await assert.rejects(controller.approveSchedule({workspace:{id:other,role:'Owner'},user:req.user},manual,{scheduledAt:manualAt}),/awaiting approval/);
  await controller.approveSchedule(req,manual,{scheduledAt:manualAt});
  assert.equal((await database.query('SELECT status FROM content WHERE id=$1',[manual])).rows[0].status,'SCHEDULED');
  assert.equal((await database.query('SELECT count(*)::int AS count FROM scheduled_posts WHERE content_id=$1',[manual])).rows[0].count,1);
  await assert.rejects(controller.approveSchedule(req,manual,{scheduledAt:manualAt}),/awaiting approval/);
  const preview=await controller.previewFestivalPoster(req,'dussehra',{year:2026,language:'EN'});
  assert.equal(preview.date,'2026-10-20');
  assert.ok(preview.svg.includes('Test Brand'));
  console.log('PASS: Manual approval schedules once, rejects cross-workspace and duplicate actions; branded preview retains the correct festival date.');
  const failedGeneration=randomUUID();
  await database.query(`INSERT INTO scheduled_festival_posts(id,workspace_id,festival_id,festival_date,status) VALUES($1,$2,'generation-failure','2026-10-20','FAILED')`,[failedGeneration,ws]);
  await assert.rejects(controller.retryGeneration({workspace:{id:other,role:'Owner'},user:req.user},failedGeneration),/failed generation/);
  await controller.retryGeneration(req,failedGeneration);
  await assert.rejects(controller.retryGeneration(req,failedGeneration),/failed generation/);
  await pool.end();
  console.log(
    "PASS: Settings persist and reload, OFF defaults, account authorization, viewer rejection, input validation, monitoring and workspace isolation.",
  );
  await database.query(
    "UPDATE workspaces SET daily_posting_target=1 WHERE id=$1",
    [other],
  );
  const allocate = async () => {
    const connection = await database.connect();
    const id = randomUUID();
    try {
      await connection.query("BEGIN");
      await assertDailySlot(
        connection,
        other,
        { id, variants: {} },
        new Date("2026-10-21T05:00Z"),
      );
      await connection.query(
        `INSERT INTO content(id,workspace_id) VALUES($1,$2)`,
        [id, other],
      );
      await connection.query(
        `INSERT INTO scheduled_posts(id,workspace_id,content_id,execute_at,state) VALUES($1,$2,$3,'2026-10-21T05:00Z','PENDING')`,
        [randomUUID(), other, id],
      );
      await connection.query("COMMIT");
      return true;
    } catch (error) {
      await connection.query("ROLLBACK");
      if (!/target reached|occupies/.test(error.message)) throw error;
      return false;
    } finally {
      connection.release();
    }
  };
  const concurrent = await Promise.all([allocate(), allocate()]);
  assert.equal(
    concurrent.filter(Boolean).length,
    1,
    "Concurrent scheduling must allocate exactly one final slot",
  );
  console.log(
    "PASS: Concurrent PostgreSQL scheduling cannot overbook the final daily slot.",
  );
  console.log(
    "PASS: PostgreSQL daily allocation, festival reservation, timezone, account deduplication, workspace isolation, conflicts, schedule preservation, cancellation and target validation.",
  );
} finally {
  await database?.end();
  await engine.stop();
}
