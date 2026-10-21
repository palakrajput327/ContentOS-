import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import pg from "pg";

// Isolated PostgreSQL fixture: never reads production credentials.
const directory = path.resolve(`.runtime/admin-user-edit-${Date.now()}`);
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
    CREATE TABLE users(id uuid PRIMARY KEY,name text,email text UNIQUE,phone_number text,phone_country_code text,
      email_verified_at timestamptz,account_status text DEFAULT 'ACTIVE',admin_note text,admin_version int DEFAULT 1,
      active_workspace_id uuid,updated_at timestamptz);
    CREATE TABLE workspaces(id uuid PRIMARY KEY,daily_posting_target int);
    CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text);
    CREATE TABLE system_admin_sessions(token_hash text,username text,revoked_at timestamptz,expires_at timestamptz);
    CREATE TABLE auth_sessions(user_id uuid,revoked_at timestamptz);
    CREATE TABLE auth_tokens(user_id uuid,used_at timestamptz);
    CREATE TABLE subscription_plans(id uuid PRIMARY KEY,code text,name text,monthly_price numeric,yearly_price numeric,daily_post_limit int);
    CREATE TABLE workspace_subscriptions(id uuid PRIMARY KEY,workspace_id uuid UNIQUE,plan_id uuid,billing_period text,status text,
      start_at timestamptz,current_period_end timestamptz,admin_override_note text,cancel_at_period_end boolean,custom_daily_limit int,updated_at timestamptz);
    CREATE TABLE workspace_trials(workspace_id uuid,started_at timestamptz,ends_at timestamptz,status text,extension_count int,daily_post_limit int,extension_reason text,updated_at timestamptz);
    CREATE TABLE subscription_events(id uuid,workspace_id uuid,subscription_id uuid,event_type text,details jsonb);
    CREATE TABLE administrative_audit_logs(id uuid,actor_username text,target_type text,target_id text,action text,before_value jsonb,after_value jsonb,reason text,ip_address text);
    CREATE TABLE system_admin_events(id uuid,username text,action text,target_user_id uuid,details jsonb,ip_address text,user_agent text);
  `);
  applicationPool = (await import("../dist-api/db.js")).pool;
  applicationPool.connect = db.connect.bind(db);
  const { hash } = await import("../dist-api/security.js");
  const { mutateAdminUser } = await import("../dist-api/admin-users.js");
  const { getWorkspaceEntitlement } = await import("../dist-api/billing/entitlement.service.js");
  const id = randomUUID(), wid = randomUUID();
  await db.query("INSERT INTO users(id,name,email,active_workspace_id,email_verified_at) VALUES($1,'Before','before@example.test',$2,now())", [id,wid]);
  await db.query("INSERT INTO users(id,email) VALUES($1,'taken@example.test')", [randomUUID()]);
  await db.query("INSERT INTO workspaces VALUES($1,3)", [wid]);
  await db.query("INSERT INTO workspace_members VALUES($1,$2,'Owner')", [wid,id]);
  await db.query("INSERT INTO system_admin_sessions VALUES($1,'admin',NULL,now()+interval '1 hour')", [hash("test-session")]);
  await db.query("INSERT INTO auth_sessions VALUES($1,NULL)", [id]);
  for (const [code, price, limit] of [["STARTER",15000,3],["GROWTH",25000,5],["SCALE",50000,10]]) {
    await db.query("INSERT INTO subscription_plans VALUES($1,$2,$2,$3,$4,$5)", [randomUUID(),code,price,price*10,limit]);
  }
  const req = { cookies: { contentos_admin_session: "test-session" }, ip: "127.0.0.1", get: () => "test" };
  const base = { name: "After", status: "ACTIVE", note: "Support", version: 1 };
  await mutateAdminUser(id, {...base,email:"After@Example.Test",phone:"9876543210",countryCode:"+91"},req);
  let user = (await db.query("SELECT * FROM users WHERE id=$1",[id])).rows[0];
  assert.equal(user.email,"after@example.test");
  assert.equal(user.email_verified_at,null);
  assert.equal(user.phone_number,"9876543210");
  assert.ok((await db.query("SELECT revoked_at FROM auth_sessions WHERE user_id=$1",[id])).rows[0].revoked_at);
  await assert.rejects(mutateAdminUser(id,{...base,version:2,email:"taken@example.test"},req),/already used/);
  await assert.rejects(mutateAdminUser(id,base,req),/changed/);
  let version = 2;
  for (const [code,limit] of [["STARTER",3],["GROWTH",5],["SCALE",10]]) {
    await mutateAdminUser(id,{...base,version:version++,subscription:{status:"ACTIVE",planCode:code,billingPeriod:"MONTHLY",expiresAt:new Date(Date.now()+86400000).toISOString()}},req);
    const entitlement = await getWorkspaceEntitlement(wid,db);
    assert.equal(entitlement.effectiveState,"PAID_ACTIVE");
    assert.equal(entitlement.plan.code,code);
    assert.equal(entitlement.dailyPostingLimit,limit);
  }
  await assert.rejects(mutateAdminUser(id,{...base,version,subscription:{status:"ACTIVE",planCode:"SCALE",billingPeriod:"MONTHLY",expiresAt:"2020-01-01T00:00:00Z"}},req),/future expiry/);
  await db.query("UPDATE workspace_subscriptions SET current_period_end=now()-interval '1 second'");
  assert.equal((await getWorkspaceEntitlement(wid,db)).isLocked,true);
  await mutateAdminUser(id,{...base,version:version++,subscription:{status:"INACTIVE",planCode:"SCALE",billingPeriod:"MONTHLY"}},req);
  assert.equal((await getWorkspaceEntitlement(wid,db)).effectiveState,"SUSPENDED");
  await mutateAdminUser(id,{...base,version:version++,subscription:{status:"ACTIVE",planCode:"GROWTH",billingPeriod:"YEARLY",expiresAt:new Date(Date.now()+86400000).toISOString()}},req);
  assert.equal((await getWorkspaceEntitlement(wid,db)).isLocked,false);
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM subscription_events")).rows[0].n,5);
  const future = new Date(Date.now()+86400000).toISOString();
  await mutateAdminUser(id,{...base,version:version++,subscription:{status:"ACTIVE",planCode:"SCALE",billingPeriod:"MONTHLY",expiresAt:future,complimentary:true,customDailyLimit:17}},req);
  assert.equal((await getWorkspaceEntitlement(wid,db)).effectiveState,"ADMIN_GRANTED");
  assert.equal((await getWorkspaceEntitlement(wid,db)).dailyPostingLimit,17);
  await db.query("UPDATE workspace_subscriptions SET current_period_end=now()-interval '1 second'");
  assert.equal((await getWorkspaceEntitlement(wid,db)).isLocked,true);
  await assert.rejects(mutateAdminUser(id,{...base,name:"Must roll back",version,subscription:{status:"EXTEND",planCode:"SCALE",billingPeriod:"MONTHLY",extensionDays:5}},req),/reason are required/);
  assert.equal((await db.query("SELECT name FROM users WHERE id=$1",[id])).rows[0].name,"After");
  await mutateAdminUser(id,{...base,version:version++,subscription:{status:"EXTEND",planCode:"SCALE",billingPeriod:"MONTHLY",extensionDays:5,extensionReason:"Courtesy extension"}},req);
  assert.equal((await getWorkspaceEntitlement(wid,db)).isLocked,false);
  assert.equal((await getWorkspaceEntitlement(wid,db)).dailyPostingLimit,17);
  await db.query("INSERT INTO workspace_trials(workspace_id,started_at,ends_at,status,extension_count,daily_post_limit) VALUES($1,now()-interval '6 days',now()-interval '1 day','EXPIRED',0,3)",[wid]);
  await db.query("UPDATE workspace_subscriptions SET status='TRIALING',current_period_end=now()-interval '1 day'");
  await mutateAdminUser(id,{...base,version:version++,subscription:{status:"EXTEND",planCode:"SCALE",billingPeriod:"MONTHLY",extensionDays:3,extensionReason:"Trial support"}},req);
  assert.equal((await getWorkspaceEntitlement(wid,db)).effectiveState,"TRIAL_ACTIVE");
  assert.equal((await db.query("SELECT extension_count FROM workspace_trials")).rows[0].extension_count,1);
  await assert.rejects(mutateAdminUser(id,{...base,version,subscription:{status:"ACTIVE",planCode:"SCALE",billingPeriod:"MONTHLY",expiresAt:future,customDailyLimit:51}},req));
  await mutateAdminUser(id,{...base,status:"SUSPENDED",version:version++},req);
  assert.equal((await db.query("SELECT account_status FROM users WHERE id=$1",[id])).rows[0].account_status,"SUSPENDED");
  await assert.rejects(mutateAdminUser(id,{...base,version}, {...req,cookies:{contentos_admin_session:"forged"}}),/session expired/);
  console.log("PASS: profile/email updates, duplicate/stale protection, session revocation, three plan limits, paid/complimentary expiry, custom quota, manual inactive/reactivation, paid/trial extensions, rollback, validation, audit and admin authorization.");
} finally {
  await db?.end();
  await applicationPool?.end();
  if (child) {
    await promisify(execFile)(path.join(bin,"pg_ctl.exe"),["-D",directory,"stop","-m","immediate"],{windowsHide:true}).catch(()=>child.kill());
  }
}
