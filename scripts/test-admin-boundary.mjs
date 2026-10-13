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
  dir = path.resolve(`.runtime/admin-boundary-test-${Date.now()}`),
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
  for (const file of ["001_auth.sql", "002_codes_workspaces.sql", "021_super_admin_sessions.sql", "022_admin_user_management.sql"])
    await db.query(await readFile(new URL(`../server/migrations/${file}`, import.meta.url), "utf8"));
  pool = (await import("../dist-api/db.js")).pool;
  pool.query = db.query.bind(db);
  pool.connect = db.connect.bind(db);
  const { AdminController, AdminGuard } = await import("../dist-api/admin.controller.js");
  const { NestFactory } = await import("@nestjs/core");
  const { Module } = await import("@nestjs/common");
  const cookieParser = (await import("cookie-parser")).default;
  class Fixture {}
  Module({ controllers: [AdminController], providers: [AdminGuard] })(Fixture);
  async function start() {
    app = await NestFactory.create(Fixture, { logger: false });
    app.use(cookieParser());
    await app.listen(0,"127.0.0.1");
    return await app.getUrl();
  }
  let base = await start();
  let cookie = "";
  const call = (route, body, token=cookie) => fetch(`${base}/admin/${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Cookie: token },
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  delete process.env.SYSTEM_ADMIN_USERNAME;
  delete process.env.SYSTEM_ADMIN_PASSWORD;
  assert.equal((await call("login",{username:"ADMIN",password:"ADMIN@123"})).status,403);
  process.env.SYSTEM_ADMIN_USERNAME="admin1";
  process.env.SYSTEM_ADMIN_PASSWORD="admin@123";
  assert.equal((await call("users",undefined,"contentos_session=workspace-owner")).status,403);
  assert.equal((await call("users",undefined,"contentos_admin_session=forged")).status,403);
  assert.equal((await call("login",{username:"admin1",password:"wrong"})).status,401);
  const login = await call("login",{username:"admin1",password:"admin@123"});
  assert.equal(login.status,201);
  cookie = login.headers.get("set-cookie").split(";")[0];
  const stored = (await db.query("SELECT token_hash FROM system_admin_sessions")).rows[0];
  assert.notEqual(stored.token_hash,cookie.split("=")[1]);
  assert.equal(stored.token_hash.length,64);
  assert.equal((await call("me")).status,200);
  const id = randomUUID();
  await db.query("INSERT INTO users(id,name,email,password_hash,terms_accepted_at) VALUES($1,'Test user','fixture@example.test','unused',now())",[id]);
  await db.query("INSERT INTO auth_events(id,user_id,action) VALUES($1,$2,'USER_LOGIN')",[randomUUID(),id]);
  const users = await (await call("users")).json();
  assert.equal(users.users.length,1);
  assert.ok(users.users[0].lastLoginAt);
  const workspace=randomUUID(),post=randomUUID();
  await db.query("INSERT INTO workspaces(id,name,timezone) VALUES($1,'Admin fixture','Asia/Kolkata')",[workspace]);
  await db.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'Owner')",[workspace,id]);
  await db.query("INSERT INTO content(id,workspace_id,title,body,platforms,created_by,updated_by) VALUES($1,$2,'Fixture post','Source body','[\"LinkedIn\",\"Instagram\"]',$3,$3)",[post,workspace,id]);
  const analytics=await (await call('analytics')).json();
  assert.equal(analytics.users.total,1);
  assert.equal(analytics.users.logged_in,1);
  assert.equal(analytics.statuses[0].count,1);
  assert.equal(analytics.platforms.length,2);
  assert.equal(analytics.daily.length,14);
  const posts=await (await call('posts?search=Fixture&status=DRAFT')).json();
  assert.equal(posts.total,1);assert.equal(posts.posts[0].body,'Source body');
  assert.equal((await (await call('posts?status=PUBLISHED')).json()).total,0);
  const events=await (await call('events?kind=login')).json();
  assert.equal(events.total,1);assert.equal(events.events[0].actor,'fixture@example.test');
  assert.equal((await (await call('workspaces')).json()).workspaces.length,1);
  const mutate=(id,body,method='PATCH')=>fetch(`${base}/admin/users/${id}`,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const {hashPassword}=await import('../dist-api/security.js');
  const {PhaseAuthController}=await import('../dist-api/phase-auth.controller.js');
  await db.query('UPDATE users SET password_hash=$2,email_verified_at=now() WHERE id=$1',[id,await hashPassword('fixture-password-123')]);
  const phaseAuth=new PhaseAuthController();
  const capturedCookies={};
  const response={cookie(name,value){capturedCookies[name]=value},clearCookie(){}};
  const loginResult=await phaseAuth.login({email:'fixture@example.test',password:'fixture-password-123'},{requestId:'fixture'},response);
  assert.ok(loginResult.user);
  const session=(await db.query('SELECT * FROM auth_sessions WHERE user_id=$1',[id])).rows[0];
  const suspended=await mutate(id,{name:'Edited user',status:'SUSPENDED',note:'Support review',version:1});
  assert.equal(suspended.status,200);
  assert.ok((await db.query('SELECT revoked_at FROM auth_sessions WHERE id=$1',[session.id])).rows[0].revoked_at);
  await assert.rejects(()=>phaseAuth.login({email:'fixture@example.test',password:'fixture-password-123'},{requestId:'fixture'},response),e=>e.getStatus()===403);
  await assert.rejects(()=>phaseAuth.refresh({cookies:{contentos_refresh:capturedCookies.contentos_refresh},requestId:'fixture'},response),e=>e.getStatus()===401);
  assert.equal((await mutate(id,{name:'Stale user',status:'ACTIVE',note:'',version:1})).status,409);
  assert.equal((await mutate(id,{name:'Edited user',status:'ACTIVE',note:'Restored',version:2})).status,200);
  assert.ok((await db.query('SELECT revoked_at FROM auth_sessions WHERE id=$1',[session.id])).rows[0].revoked_at,'reactivation does not revive revoked sessions');
  assert.equal((await mutate(id,{confirmation:'fixture@example.test',version:3},'DELETE')).status,200,'Super Admin can delete the last owner');
  assert.equal((await (await call('workspaces')).json()).workspaces[0].owner,'admin1');
  const unused=randomUUID();
  await db.query("INSERT INTO users(id,name,email,password_hash,terms_accepted_at) VALUES($1,'Unused user','unused@example.test','unused',now())",[unused]);
  const impact=await (await call(`users/${unused}/impact`)).json();
  assert.equal(impact.canDelete,true);
  assert.equal((await mutate(unused,{confirmation:'wrong@example.test',version:1},'DELETE')).status,400);
  assert.equal((await mutate(unused,{confirmation:'unused@example.test',version:1},'DELETE')).status,200);
  assert.equal((await db.query('SELECT account_status FROM users WHERE id=$1',[unused])).rows[0].account_status,'DELETED');
  assert.equal((await mutate(unused,{name:'Restore',status:'ACTIVE',note:'',version:2})).status,409);
  assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM content WHERE id=$1',[post])).rows[0].count,1);
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM system_admin_events WHERE target_user_id IS NOT NULL")).rows[0].count,4);
  await app.close(); app=null;
  base=await start();
  assert.equal((await call("me")).status,200,"sessions survive application restart");
  assert.equal((await call("logout",{})).status,201);
  assert.equal((await call("users")).status,403);
  const login2=await call("login",{username:"admin1",password:"admin@123"});
  cookie=login2.headers.get("set-cookie").split(";")[0];
  await db.query("UPDATE system_admin_sessions SET expires_at=now()-interval '1 second'");
  assert.equal((await call("users")).status,403);
  for(let i=0;i<9;i++) assert.equal((await call("login",{username:"admin1",password:"wrong"})).status,401);
  assert.equal((await call("login",{username:"admin1",password:"admin@123"})).status,429);
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM system_admin_events WHERE action='LOGOUT'")).rows[0].count,1);
  console.log("PASS: admin access isolation, persistent sessions, user/analytics counts, profile edits, suspension/login and refresh denial, revocation, stale versions, deletion confirmation, ownership protection, retained content, audit records and login throttling.");
} finally {
  if(app) await app.close();
  if(db) await db.end();
  if(pool) await pool.end();
  if(child && child.exitCode===null) await exec(path.join(bin,"pg_ctl.exe"),["-D",dir,"stop","-m","fast"],{windowsHide:true});
}
