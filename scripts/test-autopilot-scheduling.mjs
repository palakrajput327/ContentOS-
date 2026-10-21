import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import pg from "pg";

// Isolated PostgreSQL fixture: never reads production credentials.
const directory = path.resolve(`.runtime/autopilot-scheduling-${Date.now()}`);
const bin = path.resolve("node_modules/@embedded-postgres/windows-x64/native/bin");
const port = 35000 + Math.floor(Math.random() * 5000);
let child, db, applicationPool;
try {
  await promisify(execFile)(path.join(bin, "initdb.exe"), ["-D", directory, "--username=postgres", "--auth=trust", "--locale=C", "--encoding=UTF8"], { windowsHide: true });
  await new Promise((resolve, reject) => {
    let log = "";
    child = spawn(path.join(bin, "postgres.exe"), ["-D", directory, "-p", String(port), "-h", "127.0.0.1"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.on("error", reject);
    child.on("exit", code => reject(new Error(`Postgres exited ${code}: ${log}`)));
    child.stderr.on("data", data => { log += data; if (log.includes("ready to accept connections")) resolve(); });
  });
  db = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", database: "postgres" });
  await db.query(`
    CREATE TABLE users(id uuid PRIMARY KEY);
    CREATE TABLE workspaces(id uuid PRIMARY KEY,name text,timezone text,daily_posting_target int DEFAULT 3,festival_automation_enabled boolean DEFAULT false,festival_region text DEFAULT 'ALL');
    CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text);
    CREATE TABLE documents(id uuid PRIMARY KEY,workspace_id uuid,original_filename text,status text);
    CREATE TABLE document_knowledge(id uuid PRIMARY KEY,workspace_id uuid,document_id uuid,knowledge_type text,knowledge_key text,value jsonb,page_start int,page_end int,source_excerpt text,status text,metadata jsonb,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE content(id uuid PRIMARY KEY,workspace_id uuid,title text,body text,platforms jsonb,variants jsonb,status text,scheduled_at timestamptz,created_by uuid,updated_by uuid,timezone text,version int DEFAULT 1,updated_at timestamptz DEFAULT now(),UNIQUE(id,workspace_id));
    CREATE TABLE content_versions(id uuid,workspace_id uuid,content_id uuid,version int,snapshot jsonb,created_by uuid);
    CREATE TABLE social_accounts(id uuid,workspace_id uuid,platform text,state text,name text,UNIQUE(id,workspace_id));
    CREATE TABLE scheduled_posts(id uuid PRIMARY KEY,workspace_id uuid,content_id uuid,account_id uuid,content_version int,execute_at timestamptz,timezone text,state text,FOREIGN KEY(content_id,workspace_id) REFERENCES content(id,workspace_id),FOREIGN KEY(account_id,workspace_id) REFERENCES social_accounts(id,workspace_id));
    CREATE TABLE posting_slots(id uuid PRIMARY KEY,workspace_id uuid,day_of_week int,time_of_day text,platform text,enabled boolean,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE brand_kits(workspace_id uuid,data jsonb);
    CREATE TABLE activity_logs(id uuid,workspace_id uuid,actor_id uuid,action text,entity_type text,entity_id text,entity text,previous_value jsonb,new_value jsonb);
    CREATE TABLE subscription_plans(id uuid,daily_post_limit int);
    CREATE TABLE workspace_subscriptions(workspace_id uuid,plan_id uuid,custom_daily_limit int);
    CREATE TABLE workspace_trials(workspace_id uuid,daily_post_limit int);
    CREATE TABLE media_assets(id uuid,bucket text,object_key text,deleted_at timestamptz);
    CREATE TABLE document_source_media(document_id uuid,workspace_id uuid,media_asset_id uuid,page_number int);
  `);
  const {readFile}=await import('node:fs/promises');
  for(const migration of ['017_knowledge_automation.sql','025_autopilot_posting_time.sql','026_autopilot_mode.sql']) await db.query(await readFile(new URL('../server/migrations/'+migration,import.meta.url),'utf8'));
  const {KnowledgeAutomationService}=await import('../dist-api/knowledge/automation.service.js');
  const workspace=randomUUID(),user=randomUUID(),document=randomUUID();
  await db.query('INSERT INTO users VALUES($1)',[user]);
  await db.query("INSERT INTO workspaces(id,timezone) VALUES($1,'Asia/Kolkata')",[workspace]);
  await db.query("INSERT INTO workspace_members VALUES($1,$2,'Owner')",[workspace,user]);
  await db.query("INSERT INTO documents VALUES($1,$2,'Business.pdf','READY')",[document,workspace]);
  const platforms=['Facebook','Instagram','Telegram','LinkedIn'];
  for(const platform of platforms)await db.query("INSERT INTO social_accounts VALUES($1,$2,$3,'Connected','Test')",[randomUUID(),workspace,platform]);
  const next=new Date(Date.now()+5*60000);
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:false}).format(next);
  await db.query("INSERT INTO knowledge_automation_settings(workspace_id,actor_id,enabled,autopilot_enabled,platforms,posting_time) VALUES($1,$2,true,true,$3,$4)",[workspace,user,JSON.stringify(platforms),time]);
  // Disable custom slots so the configured-time fallback is exercised.
  await db.query("INSERT INTO posting_slots(id,workspace_id,day_of_week,time_of_day,enabled) VALUES($1,$2,0,'00:00',false)",[randomUUID(),workspace]);
  for(let index=0;index<30;index++)await db.query("INSERT INTO document_knowledge(id,workspace_id,document_id,knowledge_type,knowledge_key,value,page_start,page_end,source_excerpt,status) VALUES($1,$2,$3,'SERVICE',$4,$5,1,1,$4,'EXTRACTED')",[randomUUID(),workspace,document,'Service '+index,JSON.stringify('Service '+index)]);
  let calls=0;
  const generator=async(_topic,requested)=>{calls++;return {title:'Business service '+calls,variants:Object.fromEntries(requested.map(p=>[p,'Learn about this source-backed service.']))};};
  let visuals=0;
  const visualGenerator=async()=>{visuals++;return {assetId:randomUUID(),url:'https://example.test/generated-poster-'+visuals+'.jpg'};};
  const service=new KnowledgeAutomationService(db,generator,visualGenerator);
  const result=await service.run(workspace,30);
  if(result.generated!==30)console.log((await db.query('SELECT state,error_message FROM knowledge_content_plans')).rows);
  assert.equal(result.generated,30,'Bulk generation stores all thirty posts');
  assert.equal(visuals,30,'Every autopilot post generates a stored visual');
  assert.equal((await db.query('SELECT count(*)::int n FROM content')).rows[0].n,30);
  assert.equal((await db.query('SELECT count(*)::int n FROM scheduled_posts')).rows[0].n,120,'Each stored post has all four platform jobs');
  const days=(await db.query("SELECT (execute_at AT TIME ZONE 'Asia/Kolkata')::date AS posting_day,count(DISTINCT content_id)::int n FROM scheduled_posts GROUP BY posting_day ORDER BY posting_day")).rows;
  assert.deepEqual(days.map(day=>day.n),Array(10).fill(3),'Daily capacity is respected across all platform variants');
  const first=(await db.query('SELECT MIN(execute_at) first FROM scheduled_posts')).rows[0].first;
  assert.ok(first.getTime()>Date.now() && first.getTime()<Date.now()+7*60000,'Today is scheduled when configured time is still ahead');
  for(const row of (await db.query('SELECT variants FROM content')).rows)for(const platform of platforms){assert.ok(row.variants[platform].caption);assert.ok(row.variants[platform].mediaAssetId);assert.ok(row.variants[platform].mediaUrl);}
  assert.equal((await service.run(workspace,30)).generated,0,'Reruns do not duplicate posts or platform jobs');
  assert.equal((await db.query('SELECT count(*)::int n FROM scheduled_posts')).rows[0].n,120);
  await db.query('UPDATE knowledge_automation_settings SET enabled=false');
  assert.equal((await service.run(workspace,30)).generated,0,'Pausing stops generation');
  console.log('PASS: thirty bulk stored posts and images, 120 real FK-backed platform schedules, same-day configured time, 3/day capacity, variants, idempotency and pause.');
} finally {
  await db?.end();
  await applicationPool?.end();
  if (child) {
    await promisify(execFile)(path.join(bin,"pg_ctl.exe"),["-D",directory,"stop","-m","immediate"],{windowsHide:true}).catch(()=>child.kill());
  }
}

