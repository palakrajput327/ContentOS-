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
const taskDir = path.resolve(
  `.runtime/knowledge-automation-test-${Date.now()}`,
);
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
  const { KnowledgeAutomationService, topicHash, groupKnowledge } =
    await import("../dist-api/knowledge/automation.service.js");
  await database.query(`
    CREATE TABLE users(id uuid PRIMARY KEY);
    CREATE TABLE workspaces(id uuid PRIMARY KEY,name text,timezone text,daily_posting_target integer DEFAULT 3,festival_automation_enabled boolean DEFAULT false,festival_region text DEFAULT 'ALL');
    CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text);
    CREATE TABLE documents(id uuid PRIMARY KEY,workspace_id uuid,original_filename text,status text);
    CREATE TABLE document_knowledge(id uuid PRIMARY KEY,workspace_id uuid,document_id uuid,knowledge_type text,knowledge_key text,value jsonb,page_start integer,page_end integer,source_excerpt text,status text,created_at timestamptz DEFAULT now());
    CREATE TABLE content(id uuid PRIMARY KEY,workspace_id uuid,title text,body text,platforms jsonb,variants jsonb,status text,created_by uuid,updated_by uuid,timezone text,version integer DEFAULT 1,updated_at timestamptz DEFAULT now(),UNIQUE(id,workspace_id));
    CREATE TABLE content_versions(id uuid,workspace_id uuid,content_id uuid,version integer,snapshot jsonb,created_by uuid);
    CREATE TABLE scheduled_posts(id uuid PRIMARY KEY,workspace_id uuid,content_id uuid,execute_at timestamptz,state text);
    CREATE TABLE posting_slots(id uuid PRIMARY KEY,workspace_id uuid,day_of_week integer,time_of_day text,platform text,enabled boolean);
    CREATE TABLE social_accounts(id uuid,workspace_id uuid,platform text,state text,name text);
    CREATE TABLE brand_kits(workspace_id uuid,data jsonb);
    CREATE TABLE activity_logs(id uuid,workspace_id uuid,actor_id uuid,action text,entity_type text,entity_id text,entity text,previous_value jsonb,new_value jsonb);
  `);
  await database.query(
    await readFile(
      new URL(
        "../server/migrations/017_knowledge_automation.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const ws = randomUUID(),
    other = randomUUID(),
    user = randomUUID(),
    document = randomUUID();
  await database.query("INSERT INTO users VALUES($1)", [user]);
  await database.query(
    "INSERT INTO workspaces(id,timezone) VALUES($1,'Asia/Kolkata'),($2,'America/New_York')",
    [ws, other],
  );
  await database.query("INSERT INTO workspace_members VALUES($1,$2,'Owner')", [
    ws,
    user,
  ]);
  await database.query(
    "INSERT INTO documents VALUES($1,$2,'Business.pdf','READY')",
    [document, ws],
  );
  await database.query(
    "INSERT INTO social_accounts VALUES($1,$2,'LinkedIn','Connected','Business')",
    [randomUUID(), ws],
  );
  await database.query(
    "INSERT INTO knowledge_automation_settings(workspace_id,actor_id,enabled) VALUES($1,$2,true)",
    [ws, user],
  );
  const seed = async (value, status = "CONFIRMED") => {
    const id = randomUUID();
    await database.query(
      "INSERT INTO document_knowledge(id,workspace_id,document_id,knowledge_type,knowledge_key,value,page_start,page_end,source_excerpt,status) VALUES($1,$2,$3,'SERVICE',$4,$5,2,2,$4,$6)",
      [id, ws, document, value, JSON.stringify(value), status],
    );
    return id;
  };
  const k1 = await seed("We offer design services"),
    k2 = await seed("We offer training");
  await seed("  We offer DESIGN services  ");
  await seed("An unconfirmed claim", "EXTRACTED");
  assert.equal(
    topicHash({ knowledge_type: "SERVICE", value: { b: "  Test ", a: "X" } }),
    topicHash({ knowledge_type: "SERVICE", value: { a: "x", b: "test" } }),
  );
  const rows = (
    await database.query(
      "SELECT k.*,d.original_filename FROM document_knowledge k JOIN documents d ON d.id=k.document_id",
    )
  ).rows;
  assert.equal(
    groupKnowledge(rows).length,
    3,
    "Duplicate uploads collapse while source mappings remain",
  );
  assert.equal(
    groupKnowledge(rows).find((t) => t.key === "We offer design services")
      .sources.length,
    2,
  );
  let calls = 0;
  const generator = async (topic, platforms) => {
    calls++;
    assert.ok(JSON.parse(topic).evidence.length);
    return {
      title: "Source-backed content",
      variants: Object.fromEntries(
        platforms.map((p) => [p, "Learn about our business services."]),
      ),
    };
  };
  const service = new KnowledgeAutomationService(database, generator);
  await Promise.all([service.run(ws), service.run(ws)]);
  const plans = (await database.query("SELECT * FROM knowledge_content_plans"))
    .rows;
  assert.equal(plans.length, 2, "Concurrent runs do not duplicate topics");
  assert.equal(calls, 2, "Unconfirmed facts are never generated");
  assert.notEqual(
    plans[0].proposed_at.toISOString(),
    plans[1].proposed_at.toISOString(),
    "Concurrent proposals use distinct slots",
  );
  assert.equal(
    (await database.query("SELECT * FROM content WHERE status='NEEDS_REVIEW'"))
      .rowCount,
    2,
  );
  assert.equal(
    (await database.query("SELECT * FROM scheduled_posts")).rowCount,
    0,
    "Review proposals never become publishing jobs",
  );
  assert.equal(
    (
      await database.query("SELECT * FROM content WHERE workspace_id=$1", [
        other,
      ])
    ).rowCount,
    0,
    "Workspace isolation",
  );
  const saved = (await database.query("SELECT variants FROM content LIMIT 1"))
    .rows[0].variants.LinkedIn.metadata.sourceEvidence[0];
  assert.equal(saved.documentId, document);
  assert.equal(saved.pageStart, 2);
  assert.ok(saved.excerpt);
  await service.run(ws);
  assert.equal(calls, 2, "Reruns preserve existing proposals");
  await database.query(
    "UPDATE knowledge_automation_settings SET enabled=false WHERE workspace_id=$1",
    [ws],
  );
  await seed("New source while paused");
  await service.run(ws);
  assert.equal(calls, 2, "Pause stops generation");
  await database.query(
    "UPDATE knowledge_automation_settings SET enabled=true WHERE workspace_id=$1",
    [ws],
  );
  const pauseDuring = new KnowledgeAutomationService(
    database,
    async (...args) => {
      await database.query(
        "UPDATE knowledge_automation_settings SET enabled=false WHERE workspace_id=$1",
        [ws],
      );
      return generator(...args);
    },
  );
  await pauseDuring.run(ws);
  assert.equal(
    (await database.query("SELECT * FROM content")).rowCount,
    2,
    "Pause during network generation prevents content commit",
  );
  await database.query(
    "UPDATE knowledge_automation_settings SET enabled=true WHERE workspace_id=$1",
    [ws],
  );
  const newKnowledge = await seed("Source requiring generation failure");
  const failure = new KnowledgeAutomationService(database, async () => {
    throw new Error("Provider unavailable");
  });
  await failure.run(ws);
  assert.ok(
    (
      await database.query(
        "SELECT * FROM knowledge_content_plans WHERE state='FAILED' AND error_message='Provider unavailable'",
      )
    ).rowCount,
  );
  assert.equal(
    (await database.query("SELECT * FROM content")).rowCount,
    2,
    "AI failures do not create partial content",
  );
  await database.query(
    "UPDATE workspace_members SET role='Viewer' WHERE workspace_id=$1",
    [ws],
  );
  await seed("Knowledge after permission revocation");
  await service.run(ws);
  assert.equal(
    (
      await database.query(
        "SELECT enabled FROM knowledge_automation_settings WHERE workspace_id=$1",
        [ws],
      )
    ).rows[0].enabled,
    false,
    "Permission revocation pauses automation",
  );
  assert.equal(
    (await database.query("SELECT * FROM scheduled_posts")).rowCount,
    0,
  );
  await database.query(
    "UPDATE workspace_members SET role='Owner' WHERE workspace_id=$1",
    [ws],
  );
  await database.query(
    "UPDATE knowledge_automation_settings SET enabled=true WHERE workspace_id=$1",
    [ws],
  );
  const changedSource = new KnowledgeAutomationService(
    database,
    async (topic, platforms) => {
      const knowledgeId = JSON.parse(topic).evidence[0].knowledgeId;
      await database.query(
        "UPDATE document_knowledge SET value=$2 WHERE id=$1",
        [knowledgeId, JSON.stringify(`Changed after generation began ${randomUUID()}`)],
      );
      return generator(topic, platforms);
    },
  );
  await changedSource.run(ws);
  assert.equal(
    (await database.query("SELECT * FROM content")).rowCount,
    2,
    "Changed source facts prevent stale generation commit",
  );
  const { KnowledgeAutomationController, automationSettingsSchema } =
    await import("../dist-api/knowledge/automation.controller.js");
  const { pool } = await import("../dist-api/db.js");
  const originalQuery = pool.query,
    originalConnect = pool.connect;
  pool.query = database.query.bind(database);
  pool.connect = database.connect.bind(database);
  try {
    const controller = new KnowledgeAutomationController();
    const req = { workspace: { id: ws, role: "Owner" }, user: { id: user } };
    const otherReq = { ...req, workspace: { id: other, role: "Owner" } };
    assert.equal(
      (await controller.overview(otherReq)).topics.length,
      0,
      "Foreign workspace cannot see source pool",
    );
    assert.equal(
      (await controller.overview(otherReq)).plans.length,
      0,
      "Foreign workspace cannot see plans",
    );
    await assert.rejects(
      controller.settings(
        { ...req, workspace: { id: ws, role: "Viewer" } },
        {
          enabled: true,
          horizonDays: 14,
          cooldownDays: 90,
          platforms: ["LinkedIn"],
        },
      ),
      /does not allow/,
    );
    assert.equal(
      automationSettingsSchema.safeParse({
        enabled: true,
        horizonDays: 30,
        cooldownDays: 90,
        platforms: ["LinkedIn"],
      }).success,
      false,
    );
    assert.equal(
      automationSettingsSchema.safeParse({
        enabled: true,
        horizonDays: 14,
        cooldownDays: 90,
        platforms: ["LinkedIn"],
        mode: "FULL_AUTO",
      }).success,
      false,
      "Full auto cannot be activated through this endpoint",
    );
    await controller.settings(req, {
      enabled: false,
      horizonDays: 7,
      cooldownDays: 60,
      platforms: ["LinkedIn"],
    });
    assert.equal(
      (await controller.overview(req)).settings.horizon_days,
      7,
      "Settings persist",
    );
    await assert.rejects(controller.run(req), /Enable and save/);
    await assert.rejects(
      controller.retry(otherReq, plans[0].id),
      /only for failed/,
    );
    await assert.rejects(
      controller.dismiss(otherReq, plans[0].id),
      /Only unapproved/,
    );
    const failed = (
      await database.query(
        "SELECT id FROM knowledge_content_plans WHERE state='FAILED' LIMIT 1",
      )
    ).rows[0];
    await controller.retry(req, failed.id);
    await controller.dismiss(req, plans[0].id);
    assert.equal(
      (
        await database.query(
          "SELECT state FROM knowledge_content_plans WHERE id=$1",
          [plans[0].id],
        )
      ).rows[0].state,
      "DISMISSED",
    );
    assert.equal(
      (await database.query("SELECT * FROM content")).rowCount,
      2,
      "Dismissal preserves content",
    );
    await database.query(`
      ALTER TABLE workspaces ADD COLUMN require_approval boolean DEFAULT true;
      ALTER TABLE content ADD COLUMN approved_by uuid, ADD COLUMN scheduled_by uuid, ADD COLUMN scheduled_at timestamptz;
      ALTER TABLE scheduled_posts ADD COLUMN account_id uuid, ADD COLUMN content_version integer, ADD COLUMN timezone text;
      CREATE TABLE approvals(id uuid,workspace_id uuid,content_id uuid,version integer,actor_id uuid,decision text);
      CREATE TABLE social_account_tokens(account_id uuid,ciphertext text,expires_at timestamptz);
    `);
    const { CalendarController } = await import('../dist-api/calendar/calendar.controller.js');
    const calendar = new CalendarController();
    const proposal = (await database.query("SELECT * FROM knowledge_content_plans WHERE state='REVIEW' AND content_id IS NOT NULL LIMIT 1")).rows[0];
    assert.ok(proposal, 'A second proposal remains available');
    const content = (await database.query('SELECT * FROM content WHERE id=$1',[proposal.content_id])).rows[0];
    const proposalBody = {approve:true,version:content.version};
    await assert.rejects(calendar.scheduleProposal({...req,workspace:{id:ws,role:'Content Manager'}},content.id,proposalBody), /does not allow/);
    await assert.rejects(calendar.scheduleProposal(otherReq,content.id,proposalBody), /not found/);
    await assert.rejects(calendar.scheduleProposal(req,content.id,{...proposalBody,version:content.version+1}), /changed/);
    await assert.rejects(calendar.scheduleProposal(req,content.id,proposalBody), /healthy publishing accounts/);
    assert.equal((await database.query('SELECT status FROM content WHERE id=$1',[content.id])).rows[0].status,'NEEDS_REVIEW','Failed scheduling rolls back approval');
    assert.equal((await database.query('SELECT * FROM approvals')).rowCount,0);
    await database.query("UPDATE social_accounts SET platform=lower(platform) WHERE workspace_id=$1",[ws]);
    await database.query("INSERT INTO social_account_tokens SELECT id,'test-only-token',now()+interval '1 day' FROM social_accounts WHERE workspace_id=$1",[ws]);
    const result = await calendar.scheduleProposal(req,content.id,proposalBody);
    assert.equal(result.status,'SCHEDULED');
    assert.equal(result.scheduledAt,new Date(proposal.proposed_at).toISOString(),'Uses exact proposed timestamp');
    assert.equal((await database.query('SELECT * FROM approvals')).rowCount,1);
    assert.ok((await database.query('SELECT * FROM scheduled_posts WHERE content_id=$1 AND content_version=$2',[content.id,content.version+1])).rowCount > 0,'Creates versioned durable publishing jobs');
    await assert.rejects(calendar.scheduleProposal(req,content.id,proposalBody), /changed/);
    console.log('PASS: atomic proposal approval/scheduling, stale version, role/tenant isolation, account case normalization, rollback, and durable outbox.');
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
  console.log(
    "PASS: source dedup, citations, confirmed-only selection, concurrent idempotency, preferred slots, review-only drafts, pause, changed-source guard, provider failure, permission revocation, persisted controls, retry/dismiss, and tenant isolation.",
  );
} finally {
  await database?.end();
  await engine.stop();
  const { pool } = await import("../dist-api/db.js");
  await pool.end();
}
