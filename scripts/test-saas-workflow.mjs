import 'reflect-metadata';
import assert from 'node:assert/strict';
import {test,before,after,mock} from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import net from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import EmbeddedPostgres from 'embedded-postgres';
import {createCanvas} from '@napi-rs/canvas';

// Never load .env or use an inherited database. Every provider is replaced before imports.
const original=process.cwd(),dir=await mkdtemp(join(process.cwd(),'.saas-test-'));
const realFetch=globalThis.fetch;
let googleNonce="";
let cluster,pool,app,base,cookie,adminCookie,wid,userId,accountId,calls=0,outcome='success';
mock.module('google-auth-library',{namedExports:{OAuth2Client:class{
  async generateCodeVerifierAsync(){return {codeVerifier:'fixture-verifier-'+ 'x'.repeat(40),codeChallenge:'fixture-challenge'};}
  generateAuthUrl(options){return 'https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams(options);}
  async getToken(options){assert.ok(options.codeVerifier.startsWith('fixture-verifier'));return {tokens:{id_token:options.code}};}
  async verifyIdToken({idToken}){if(idToken==='bad')throw Error('Invalid signature');return {getPayload:()=>({sub:'google-fixture-sub',email:'google-fixture@gmail.com',email_verified:true,name:'Google Fixture',nonce:googleNonce})};}
}}});
mock.module('nodemailer',{defaultExport:{createTransport:()=>({sendMail:async()=>({accepted:['fixture@example.test']}),close(){}})}});
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function api(path,method='GET',body,session=cookie,workspace=wid){
  const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(session?{Cookie:session}:{}),...(workspace?{'X-Workspace-Id':workspace}:{})},...(body && method!=='GET'?{body:JSON.stringify(body)}:{})});
  const json=await res.json();return {status:res.status,data:json.data,error:json.message,cookie:res.headers.get('set-cookie')};
}
async function content(title='Fixture',platforms=['Telegram']){const r=await api('/content','POST',{title,body:'Fixture publication',platforms,variants:{}});assert.equal(r.status,201,JSON.stringify(r));return r.data.id;}
async function resetQuota(){await pool.query('DELETE FROM published_posts WHERE workspace_id=$1',[wid]);await pool.query('DELETE FROM scheduled_posts WHERE workspace_id=$1',[wid]);await pool.query('DELETE FROM publication_quota WHERE workspace_id=$1',[wid]);}

before(async()=>{
  const pgPort=await port();
  cluster=new EmbeddedPostgres({databaseDir:join(dir,'database'),port:pgPort,user:'saas_test',password:'local-fixture-only',persistent:true,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1'],onLog(){},onError(){}});
  await cluster.initialise().catch(e=>{console.error('ISOLATED INIT FAILED',e);throw e;});await cluster.start().catch(e=>{console.error('ISOLATED START FAILED',e);throw e;});await cluster.createDatabase('contentos_saas_test');
  Object.assign(process.env,{DATABASE_URL:`postgresql://saas_test:local-fixture-only@127.0.0.1:${pgPort}/contentos_saas_test`,QUEUE_BACKEND:'postgres',NODE_ENV:'test',APP_ENV:'test',LLM_PROVIDER:'openai-compatible',LLM_API_KEY:'',LLM_FALLBACK_PROVIDERS:'',APP_URL:'http://localhost:5173',APP_ORIGIN:'http://localhost:5173',PORT:String(await port()),ENCRYPTION_KEY:'ab'.repeat(32),TOKEN_ENCRYPTION_KEY:'ab'.repeat(32),MAIL_HOST:'fixture.example.test',MAIL_PORT:'587',MAIL_FROM_ADDRESS:'fixture@example.test',MAIL_USERNAME:'fixture',MAIL_PASSWORD:'fixture',STORAGE_PROVIDER:'local',STORAGE_BUCKET:'test',LOCAL_STORAGE_ROOT:join(dir,'uploads'),SYSTEM_ADMIN_USERNAME:'fixture-admin',SYSTEM_ADMIN_PASSWORD:'Fixture-admin-123!'});
  delete process.env.REDIS_URL;delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.STORAGE_ENDPOINT;delete process.env.STORAGE_ACCESS_KEY;delete process.env.STORAGE_SECRET_KEY;
  process.env.IMAGE_PROVIDER='flux';process.env.POLLINATIONS_API_KEY='';
  const canvas=createCanvas(128,128);canvas.getContext('2d').fillRect(0,0,128,128);const png=canvas.toBuffer('image/png');
  globalThis.fetch=async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.toString():input.url;
    if(/^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(url))return realFetch(input,init);
    if(/^https:\/\/(image|gen)\.pollinations\.ai\//.test(url))return new Response(png,{status:200,headers:{'Content-Type':'image/png'}});
    throw Error('External network blocked by isolated fixture');
  };
  process.chdir(dir);
  ({pool}=await import('../dist-api/db.js'));
  const {migrate}=await import('../dist-api/migrate.js');await migrate();
  const {SocialProviderRegistry}=await import('../dist-api/social.provider.js');
  SocialProviderRegistry.getProvider=()=>({async publishText(){calls++;if(outcome==='uncertain')return {success:false,uncertain:true,error:'unknown'};if(outcome==='failure')return {success:false,error:'definite failure'};return {success:true,providerPostId:'fixture-'+calls};}});
  const {bootstrap}=await import('../dist-api/phase-main.js');app=await bootstrap();base=`http://127.0.0.1:${process.env.PORT}/api/v1`;
});
after(async()=>{console.log('Closing isolated API');if(app){app.getHttpServer().closeAllConnections();await app.close();}console.log('Closing isolated pool');if(pool)await pool.end();console.log('Stopping isolated database');if(cluster){if(process.platform==='win32'){const {pg_ctl}=await import('@embedded-postgres/windows-x64');await promisify(execFile)(pg_ctl,['-D',join(dir,'database'),'-m','immediate','-w','stop'],{timeout:15000});cluster.process=undefined;}else await cluster.stop();}process.chdir(original);await rm(dir,{recursive:true,force:true});console.log('Isolated cleanup complete',process.getActiveResourcesInfo());});

test('real signup, encrypted OTP, verification and login provision exact five-day trial',async()=>{
  const email='saas-user@example.test',password='Fixture-password-123!';
  let r=await api('/auth/register','POST',{name:'SaaS Fixture',email,password,passwordConfirmation:password,phone:'+919876543210',phoneCountryCode:'+91',termsAccepted:true,privacy_policy_accepted:true},'',null);
  assert.equal(r.status,201,JSON.stringify(r));
  const mail=(await pool.query('SELECT id,encrypted_body FROM email_outbox WHERE recipient=$1 ORDER BY created_at DESC LIMIT 1',[email])).rows[0];
  const {decryptToken}=await import('../dist-api/security.js');const code=decryptToken(mail.encrypted_body,`mail:${mail.id}`).match(/\b\d{6}\b/)[0];
  r=await api('/auth/email/verify','POST',{email,code},'',null);assert.equal(r.status,201,JSON.stringify(r));wid=r.data.workspaceId;userId=r.data.user.id;
  r=await api('/auth/login','POST',{email,password},'',null);assert.equal(r.status,201,JSON.stringify(r));cookie='contentos_session='+r.cookie.match(/contentos_session=([^;]+)/)[1];
  const trial=(await pool.query('SELECT EXTRACT(EPOCH FROM ends_at-started_at)::int AS duration FROM workspace_trials WHERE workspace_id=$1',[wid])).rows[0];assert.equal(trial.duration,432000);
  r=await api('/billing/current');assert.equal(r.data.entitlement.effectiveState,'TRIAL_ACTIVE');assert.equal(r.data.usage.dailyLimit,3);
  accountId=randomUUID();const {encryptToken}=await import('../dist-api/security.js');
  await pool.query("INSERT INTO social_accounts(id,workspace_id,platform,provider_id,name,state) VALUES($1,$2,'telegram','fixture','Fixture','Connected')",[accountId,wid]);
  await pool.query('INSERT INTO social_account_tokens(account_id,ciphertext) VALUES($1,$2)',[accountId,encryptToken('fixture',wid)]);
  await pool.query('UPDATE workspaces SET require_approval=false WHERE id=$1',[wid]);
});

test('expiry locks protected APIs while billing remains accessible; dummy submission stays pending',async()=>{
  await pool.query("UPDATE workspace_trials SET ends_at=now()-interval '1 hour',status='EXPIRED' WHERE workspace_id=$1",[wid]);
  assert.equal((await api('/content','POST',{title:'Blocked',body:'No',platforms:['Telegram'],variants:{}})).status,402);
  assert.equal((await api('/billing/current')).status,200);
  const r=await api('/billing/payment-request','POST',{planCode:'GROWTH',billingPeriod:'MONTHLY'});assert.equal(r.status,201,JSON.stringify(r));assert.equal(r.data.payment.status,'PENDING');
  assert.equal((await api('/billing/current')).data.entitlement.isLocked,true);
});

test('platform admin separation and real approval activate quota without verified revenue',async()=>{
  const payment=(await pool.query('SELECT id FROM subscription_payments WHERE workspace_id=$1',[wid])).rows[0].id;
  assert.equal((await api(`/admin/payments/${payment}/verify`,'POST',{note:'No privilege'})).status,403);
  let r=await api('/admin/login','POST',{username:'fixture-admin',password:'Fixture-admin-123!'},'',null);assert.equal(r.status,201,JSON.stringify(r));adminCookie='contentos_admin_session='+r.cookie.match(/contentos_admin_session=([^;]+)/)[1];
  await pool.query("UPDATE workspace_subscriptions SET custom_daily_limit=3,custom_limit_source='TRIAL' WHERE workspace_id=$1",[wid]);
  r=await api(`/admin/payments/${payment}/verify`,'POST',{note:'Approve simulation'},adminCookie);assert.equal(r.status,201,JSON.stringify(r));
  const current=await api('/billing/current');assert.equal(current.data.entitlement.dailyPostingLimit,5);assert.equal(current.data.entitlement.effectiveState,'PAID_ACTIVE');
  assert.equal((await pool.query('SELECT status FROM subscription_payments WHERE id=$1',[payment])).rows[0].status,'APPROVED');
  assert.equal((await api(`/admin/payments/${payment}/reject`,'POST',{reason:'Must conflict'},adminCookie)).status,409);
  assert.equal((await api(`/admin/payments/${payment}/verify`,'POST',{note:'Repeat'},adminCookie)).status,409);
  const summary=await api('/admin/summary','GET',null,adminCookie);assert.equal(summary.status,200,JSON.stringify(summary));assert.equal(Number(summary.data.metrics.totalVerifiedRevenue),0);
});

test('direct publishing requires approval and rejects cross-workspace account access',async()=>{
  const id=await content();await pool.query('UPDATE workspaces SET require_approval=true WHERE id=$1',[wid]);const start=calls;
  assert.equal((await api(`/content/${id}/publish`,'POST',{socialAccountId:accountId})).status,409);assert.equal(calls,start);
  await pool.query("UPDATE content SET status='APPROVED',approved_by=$2 WHERE id=$1",[id,userId]);
  const r=await api(`/content/${id}/publish`,'POST',{socialAccountId:accountId});assert.equal(r.status,201,JSON.stringify(r));assert.equal(r.data.success,true);
  assert.equal((await api(`/content/${id}/publish`,'POST',{socialAccountId:accountId})).status,409);assert.equal(calls,start+1);
  assert.equal((await api(`/content/${id}/publish`,'POST',{socialAccountId:randomUUID()})).status,404);
  await pool.query('UPDATE workspaces SET require_approval=false WHERE id=$1',[wid]);
});

test('concurrent direct publishing never exceeds daily successful platform quota',async()=>{
  await resetQuota();await pool.query('UPDATE workspace_subscriptions SET custom_daily_limit=3 WHERE workspace_id=$1',[wid]);
  const ids=await Promise.all(Array.from({length:8},()=>content()));const start=calls;
  const results=await Promise.all(ids.map(id=>api(`/content/${id}/publish`,'POST',{socialAccountId:accountId})));
  assert.equal(results.filter(r=>r.status===201&&r.data.success).length,3,JSON.stringify(results));assert.equal(calls-start,3);
  const usage=(await api('/billing/current')).data.usage;assert.equal(usage.postsUsedToday,3);assert.equal(usage.postsRemainingToday,0);
  const success=(await pool.query("SELECT id FROM scheduled_posts WHERE workspace_id=$1 AND state='PUBLISHED' LIMIT 1",[wid])).rows[0];await pool.query('DELETE FROM published_posts WHERE scheduled_post_id=$1',[success.id]);await pool.query('DELETE FROM scheduled_posts WHERE id=$1',[success.id]);
  assert.equal((await api('/billing/current')).data.usage.postsUsedToday,3,'deletion cannot reset usage');
});

test('definite failure releases capacity; retry is idempotent; uncertain result holds reservation',async()=>{
  await resetQuota();await pool.query('UPDATE workspace_subscriptions SET custom_daily_limit=1 WHERE workspace_id=$1',[wid]);
  const id=await content();outcome='failure';let r=await api(`/content/${id}/publish`,'POST',{socialAccountId:accountId});assert.equal(r.data.success,false);
  assert.equal((await api('/billing/current')).data.usage.postsRemainingToday,1);
  outcome='success';r=await api(`/content/${id}/publish`,'POST',{socialAccountId:accountId});assert.equal(r.data.success,true,JSON.stringify(r));assert.equal((await api('/billing/current')).data.usage.postsUsedToday,1);
  await resetQuota();outcome='uncertain';const uncertain=await content();r=await api(`/content/${uncertain}/publish`,'POST',{socialAccountId:accountId});assert.equal(r.data.state,'UNCERTAIN');
  const other=await content();assert.equal((await api(`/content/${other}/publish`,'POST',{socialAccountId:accountId})).status,409);
  outcome='success';
});

test('scheduled multi-platform reservations, expiry and downgrade are enforced at worker claim',async()=>{
  await resetQuota();await pool.query('UPDATE workspace_subscriptions SET custom_daily_limit=3 WHERE workspace_id=$1',[wid]);
  const id=await content();const date=new Date(Date.now()+120000).toISOString();let r=await api(`/content/${id}/schedule`,'POST',{scheduledAt:date,timezone:'Asia/Kolkata'});assert.equal(r.status,201,JSON.stringify(r));
  const job=(await pool.query('SELECT id FROM scheduled_posts WHERE content_id=$1',[id])).rows[0];await pool.query("UPDATE scheduled_posts SET execute_at=now()-interval '1 second' WHERE id=$1",[job.id]);
  await pool.query("UPDATE workspace_subscriptions SET current_period_end=now()-interval '1 second' WHERE workspace_id=$1",[wid]);
  const {executePublishRecord}=await import('../dist-api/publishing.js');const start=calls;assert.equal((await executePublishRecord(job.id)).success,false);assert.equal(calls,start);
  await pool.query("UPDATE workspace_subscriptions SET current_period_end=now()+interval '1 month',custom_daily_limit=3 WHERE workspace_id=$1",[wid]);
  assert.equal((await executePublishRecord(job.id)).success,true);
});

test('batch endpoints require membership and explicit confirmation, then process actual SQL',async()=>{
  await resetQuota();await pool.query('UPDATE workspace_subscriptions SET custom_daily_limit=10 WHERE workspace_id=$1',[wid]);
  assert.equal((await api('/batch/bulk-save','POST',{items:[{title:'Batch',body:'Body',platforms:['Telegram']}]})).status,400);
  assert.equal((await api('/batch','GET',null,cookie,randomUUID())).status,403);
  let r=await api('/batch/bulk-save','POST',{confirm:true,items:[{title:'Batch',body:'Body',platforms:['Telegram']}]});assert.equal(r.status,201,JSON.stringify(r));
  const {processBatch}=await import('../dist-api/batch/batch-processing.js');await processBatch({data:{batchId:r.data.id||r.data.batchId,workspaceId:wid}});
  const saved=(await pool.query("SELECT id FROM content WHERE workspace_id=$1 AND title='Batch'",[wid])).rows[0];assert.ok(saved);
  r=await api('/batch/bulk-publish','POST',{confirm:true,contentIds:[saved.id]});assert.equal(r.status,201,JSON.stringify(r));await processBatch({data:{batchId:r.data.id||r.data.batchId,workspaceId:wid}});
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM scheduled_posts WHERE content_id=$1',[saved.id])).rows[0].n,1);
});

test('new workspaces share original trial window; carousel reads/edits/publishing deny other tenants',async()=>{
  const r=await api('/workspaces','POST',{name:'Second workspace',timezone:'Asia/Kolkata'});assert.equal(r.status,201,JSON.stringify(r));const other=r.data.id;
  const trials=(await pool.query('SELECT started_at,ends_at FROM workspace_trials WHERE workspace_id=ANY($1::uuid[]) ORDER BY started_at',[[wid,other]])).rows;assert.equal(trials.length,2);assert.equal(+trials[0].started_at,+trials[1].started_at);
  const carousel=randomUUID();await pool.query("INSERT INTO instagram_carousels(id,workspace_id,title,caption) VALUES($1,$2,'Private','Private')",[carousel,other]);const start=calls;
  for(const path of [`/instagram-studio/carousels/${carousel}`,`/instagram-studio/carousels/${carousel}/publish`,`/instagram-studio/carousels/${carousel}/render-all`])assert.equal((await api(path,path.endsWith(carousel)?'GET':'POST',{})).status,404,path);
  assert.equal(calls,start);
});

test('calendar anniversaries and admin subscription reporting use effective dates and real quota',async()=>{
  const {billingPeriodEnd}=await import('../dist-api/billing/lifecycle.js');assert.equal(billingPeriodEnd(new Date('2026-01-31T12:00:00Z'),'MONTHLY').toISOString(),'2026-02-28T12:00:00.000Z');
  const r=await api('/admin/subscriptions','GET',null,adminCookie);assert.equal(r.status,200,JSON.stringify(r));assert.ok(r.data.subscriptions.find(s=>s.workspaceId===wid).postsRemainingToday>=0);
  assert.equal((await api('/billing/usage')).data.history.length,7);
});

test('Google signup binds state to browser, verifies identity, provisions trial and rejects replay',async()=>{
  Object.assign(process.env,{GOOGLE_AUTH_CLIENT_ID:'fixture-google-client',GOOGLE_AUTH_CLIENT_SECRET:'fixture-only',GOOGLE_AUTH_REDIRECT_URI:base+'/auth/google/callback'});
  assert.equal((await api('/auth/google/start','POST',{termsAccepted:false},'',null)).status,400);
  const started=await api('/auth/google/start','POST',{termsAccepted:true},'',null);assert.equal(started.status,201,JSON.stringify(started));
  const url=new URL(started.data.url),state=url.searchParams.get('state');assert.ok(url.searchParams.get('code_challenge'));assert.ok(!url.searchParams.has('client_secret'));
  googleNonce=(await pool.query('SELECT nonce FROM auth_oauth_states ORDER BY created_at DESC LIMIT 1')).rows[0].nonce;
  const bad=await fetch(base+'/auth/google/callback?code=fixture&state='+state,{redirect:'manual'});assert.ok(bad.headers.get('location').includes('google_failed'));
  const oauthCookie='contentos_google_state='+started.cookie.match(/contentos_google_state=([^;]+)/)[1];
  const callback=await fetch(base+'/auth/google/callback?code=fixture&state='+state,{redirect:'manual',headers:{Cookie:oauthCookie}});assert.equal(callback.status,302);assert.equal(new URL(callback.headers.get('location')).pathname,'/app');assert.ok(callback.headers.get('set-cookie').includes('contentos_session='));
  const user=(await pool.query("SELECT id FROM users WHERE google_id='google-fixture-sub'")).rows[0];assert.ok(user);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM user_consents WHERE user_id=$1',[user.id])).rows[0].n,1);
  const trial=(await pool.query('SELECT ends_at-started_at AS duration FROM workspace_trials t JOIN workspace_members m ON m.workspace_id=t.workspace_id WHERE m.user_id=$1',[user.id])).rows[0];assert.ok(trial);
  const replay=await fetch(base+'/auth/google/callback?code=fixture&state='+state,{redirect:'manual',headers:{Cookie:oauthCookie}});assert.ok(replay.headers.get('location').includes('google_failed'));
});

test('post-image captions are distinct, prompt-specific and tenant/subscription protected',async()=>{
  const asset=randomUUID();await pool.query("INSERT INTO media_assets(id,workspace_id,type,bucket,object_key,mime_type,size_bytes,original_filename,status,metadata,created_by) VALUES($1,$2,'GENERATED_ASSET','fixture','fixture/owl.png','image/png',100,'owl.png','COMPLETED',$3,$4)",[asset,wid,JSON.stringify({prompt:'Snowy owl with amber eyes in a pine forest'}),userId]);
  const r=await api('/ai/image-captions','POST',{assetId:asset,platform:'Instagram'});assert.equal(r.status,201,JSON.stringify(r));assert.equal(r.data.options.length,3);assert.equal(new Set(r.data.options.map(o=>o.caption)).size,3);
  for(const option of r.data.options){assert.ok(/owl/i.test(option.caption));assert.ok(option.hashtags.length>0);}
  assert.equal((await api('/ai/image-captions','POST',{assetId:randomUUID(),platform:'Instagram'})).status,404);
  await pool.query("UPDATE workspace_subscriptions SET status='SUSPENDED' WHERE workspace_id=$1",[wid]);assert.equal((await api('/ai/image-captions','POST',{assetId:asset,platform:'Instagram'})).status,403);
  await pool.query("UPDATE workspace_subscriptions SET status='ACTIVE' WHERE workspace_id=$1",[wid]);
});

test('ignored duplicate inserts do not reserve capacity and successful identities survive deletion',async()=>{
  await resetQuota();await pool.query('UPDATE workspace_subscriptions SET custom_daily_limit=5 WHERE workspace_id=$1',[wid]);
  const id=await content();const schedule=randomUUID();
  await pool.query("INSERT INTO scheduled_posts(id,workspace_id,content_id,account_id,content_version,execute_at,timezone) VALUES($1,$2,$3,$4,1,now(),'UTC')",[schedule,wid,id,accountId]);
  await pool.query("INSERT INTO scheduled_posts(id,workspace_id,content_id,account_id,content_version,execute_at,timezone) VALUES($1,$2,$3,$4,1,now(),'UTC') ON CONFLICT(content_id,account_id,content_version) DO NOTHING",[randomUUID(),wid,id,accountId]);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM publication_quota WHERE workspace_id=$1 AND state='RESERVED'",[wid])).rows[0].n,1);
  await pool.query("UPDATE scheduled_posts SET state='PUBLISHED' WHERE id=$1",[schedule]);await pool.query('DELETE FROM scheduled_posts WHERE id=$1',[schedule]);
  await assert.rejects(pool.query("INSERT INTO scheduled_posts(id,workspace_id,content_id,account_id,content_version,execute_at,timezone) VALUES($1,$2,$3,$4,1,now(),'UTC')",[randomUUID(),wid,id,accountId]),/publication_quota_identity/);
});

test('workspace roles, admin extensions, cancellation, and plan changes retain intended access',async()=>{
  await resetQuota();
  await pool.query("UPDATE workspace_members SET role='Viewer' WHERE workspace_id=$1 AND user_id=$2",[wid,userId]);
  assert.equal((await api('/content','POST',{title:'Denied',body:'Denied',platforms:['Telegram'],variants:{}})).status,403);
  await pool.query("UPDATE workspace_members SET role='Owner' WHERE workspace_id=$1 AND user_id=$2",[wid,userId]);
  const sub=(await pool.query('SELECT * FROM workspace_subscriptions WHERE workspace_id=$1',[wid])).rows[0];
  const trialBefore=(await pool.query('SELECT ends_at,extension_count FROM workspace_trials WHERE workspace_id=$1',[wid])).rows[0];
  let r=await api(`/admin/subscriptions/${sub.id}/extend`,'POST',{days:5,reason:'Paid extension fixture'},adminCookie);assert.equal(r.status,201,JSON.stringify(r));
  const trialAfter=(await pool.query('SELECT ends_at,extension_count FROM workspace_trials WHERE workspace_id=$1',[wid])).rows[0];assert.equal(+trialAfter.ends_at,+trialBefore.ends_at);assert.equal(trialAfter.extension_count,trialBefore.extension_count);
  r=await api('/billing/cancel','POST',{});assert.equal(r.status,201);assert.equal((await api('/billing/current')).data.entitlement.isLocked,false);
  await pool.query("UPDATE workspace_subscriptions SET current_period_end=now()-interval '1 second' WHERE workspace_id=$1",[wid]);assert.equal((await api('/billing/current')).data.entitlement.isLocked,true);
  r=await api(`/admin/subscriptions/${sub.id}/activate`,'POST',{planCode:'SCALE',billingPeriod:'MONTHLY',note:'Change plan fixture'},adminCookie);assert.equal(r.status,201,JSON.stringify(r));
  const billing=(await api('/billing/current')).data;assert.equal(billing.entitlement.dailyPostingLimit,10);assert.equal(billing.entitlement.plan.monthlyPrice,50000);assert.equal(billing.entitlement.subscription.cancelAtPeriodEnd,false);
  r=await api(`/admin/subscriptions/${sub.id}`,'PATCH',{customDailyLimit:4,cancelAtPeriodEnd:true,adminOverrideNote:'Override fixture'},adminCookie);assert.equal(r.status,200,JSON.stringify(r));assert.equal((await api('/billing/current')).data.entitlement.dailyPostingLimit,4);
});

test('each platform reserves a slot and a downgrade cannot dispatch already scheduled work over quota',async()=>{
  await resetQuota();await pool.query('UPDATE workspace_subscriptions SET custom_daily_limit=3 WHERE workspace_id=$1',[wid]);
  const linkedin=randomUUID();const {encryptToken}=await import('../dist-api/security.js');
  await pool.query("INSERT INTO social_accounts(id,workspace_id,platform,provider_id,name,state) VALUES($1,$2,'linkedin','fixture','LinkedIn Fixture','Connected')",[linkedin,wid]);
  await pool.query('INSERT INTO social_account_tokens(account_id,ciphertext) VALUES($1,$2)',[linkedin,encryptToken('fixture-token',wid)]);
  const id=await content('Two platform fixture',['Telegram','LinkedIn']);
  let r=await api(`/content/${id}/schedule`,'POST',{scheduledAt:new Date(Date.now()+180000).toISOString(),timezone:'Asia/Kolkata'});assert.equal(r.status,201,JSON.stringify(r));
  assert.equal((await api('/billing/current')).data.usage.postsReservedToday,2);
  const jobs=(await pool.query('SELECT id FROM scheduled_posts WHERE content_id=$1',[id])).rows;
  await pool.query("UPDATE scheduled_posts SET execute_at=now()-interval '1 second' WHERE content_id=$1",[id]);
  await pool.query('UPDATE workspace_subscriptions SET custom_daily_limit=1 WHERE workspace_id=$1',[wid]);
  const {executePublishRecord}=await import('../dist-api/publishing.js');const start=calls;
  await assert.rejects(executePublishRecord(jobs[0].id),/quota reached/);assert.equal(calls,start);
  await pool.query('UPDATE workspace_subscriptions SET custom_daily_limit=3 WHERE workspace_id=$1',[wid]);
  for(const job of jobs)assert.equal((await executePublishRecord(job.id)).success,true);
  const usage=(await api('/billing/current')).data.usage;assert.equal(usage.postsUsedToday,2);assert.equal(usage.postsReservedToday,0);assert.equal(usage.postsRemainingToday,1);
});

test('expired trial extension and actual purchase conversion use a single billing lifecycle',async()=>{
  const second=await api('/workspaces','POST',{name:'Trial extension fixture',timezone:'Asia/Kolkata'});assert.equal(second.status,201);const workspace=second.data.id;
  const sub=(await pool.query('SELECT * FROM workspace_subscriptions WHERE workspace_id=$1',[workspace])).rows[0];
  let r=await api(`/admin/subscriptions/${sub.id}/extend`,'POST',{days:5,reason:'Extend trial fixture'},adminCookie);assert.equal(r.status,201,JSON.stringify(r));
  const trial=await api('/billing/current','GET',null,cookie,workspace);assert.equal(trial.data.entitlement.effectiveState,'TRIAL_ACTIVE');assert.equal(trial.data.entitlement.subscription.currentPeriodEnd,trial.data.entitlement.trial.endsAt);
  r=await api('/billing/payment-request','POST',{planCode:'GROWTH',billingPeriod:'MONTHLY'},cookie,workspace);assert.equal(r.status,201);const payment=r.data.payment.paymentId;
  assert.equal((await api(`/admin/payments/${payment}/verify`,'POST',{note:'Convert extended trial'},adminCookie)).status,201);
  const paid=(await api('/billing/current','GET',null,cookie,workspace)).data.entitlement;assert.equal(paid.effectiveState,'PAID_ACTIVE');assert.equal(paid.dailyPostingLimit,5);
  const oldEnd=paid.subscription.currentPeriodEnd;
  r=await api('/billing/payment-request','POST',{planCode:'GROWTH',billingPeriod:'MONTHLY'},cookie,workspace);
  assert.equal((await api(`/admin/payments/${r.data.payment.paymentId}/verify`,'POST',{note:'Renew same plan'},adminCookie)).status,201);
  const renewed=(await api('/billing/current','GET',null,cookie,workspace)).data.entitlement;
  const {billingPeriodEnd}=await import('../dist-api/billing/lifecycle.js');assert.equal(renewed.subscription.currentPeriodEnd,billingPeriodEnd(new Date(oldEnd),'MONTHLY').toISOString());
  assert.equal((await api('/admin/subscriptions/'+sub.id,'PATCH',{customDailyLimit:4,adminOverrideNote:'Explicit administrator override'},adminCookie)).status,200);
  r=await api('/billing/payment-request','POST',{planCode:'SCALE',billingPeriod:'MONTHLY'},cookie,workspace);
  assert.equal((await api('/admin/payments/'+r.data.payment.paymentId+'/verify','POST',{note:'Upgrade while preserving explicit override'},adminCookie)).status,201);
  assert.equal((await api('/billing/current','GET',null,cookie,workspace)).data.entitlement.dailyPostingLimit,4);
});

test('carousels publish through durable claims and PDF dispatch never reports failed work as published',async()=>{
  await resetQuota();await pool.query('UPDATE workspace_subscriptions SET custom_daily_limit=10 WHERE workspace_id=$1',[wid]);
  const instagram=randomUUID(),carousel=randomUUID();const {encryptToken}=await import('../dist-api/security.js');
  await pool.query("INSERT INTO social_accounts(id,workspace_id,platform,provider_id,name,state) VALUES($1,$2,'instagram','fixture','Instagram Fixture','Connected')",[instagram,wid]);
  await pool.query('INSERT INTO social_account_tokens(account_id,ciphertext) VALUES($1,$2)',[instagram,encryptToken('fixture-token',wid)]);
  await pool.query("INSERT INTO instagram_carousels(id,workspace_id,title,caption) VALUES($1,$2,'Carousel fixture','A fixture caption #Fixture')",[carousel,wid]);
  for(let index=1;index<=2;index++)await pool.query("INSERT INTO instagram_carousel_slides(id,carousel_id,slide_index,slide_type,headline,image_url) VALUES($1,$2,$3,'CONTENT','Fixture',$4)",[randomUUID(),carousel,index,`https://fixture.example.test/slide-${index}.jpg`]);
  let r=await api(`/instagram-studio/carousels/${carousel}/save-draft`,'POST',{});assert.equal(r.status,201,JSON.stringify(r));const contentId=r.data.contentId;
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM scheduled_posts WHERE content_id=$1',[contentId])).rows[0].n,0,'saving a draft must not secretly schedule it');
  await pool.query('UPDATE workspaces SET require_approval=true WHERE id=$1',[wid]);const start=calls;
  assert.equal((await api(`/instagram-studio/carousels/${carousel}/publish`,'POST',{})).status,409);assert.equal(calls,start);
  await pool.query("UPDATE content SET status='APPROVED',approved_by=$2 WHERE id=$1",[contentId,userId]);
  r=await api(`/instagram-studio/carousels/${carousel}/publish`,'POST',{});assert.equal(r.status,201,JSON.stringify(r));assert.equal(r.data.success,true,JSON.stringify(r));
  assert.equal((await api(`/instagram-studio/carousels/${carousel}/publish`,'POST',{})).status,409);assert.equal(calls,start+1);
  await pool.query('UPDATE workspaces SET require_approval=false WHERE id=$1',[wid]);
  const asset=randomUUID(),document=randomUUID(),concept=randomUUID();
  await pool.query("INSERT INTO media_assets(id,workspace_id,type,bucket,object_key,mime_type,size_bytes,original_filename,status,created_by) VALUES($1,$2,'GENERATED_ASSET','fixture','fixture/image.jpg','image/jpeg',100,'image.jpg','COMPLETED',$3)",[asset,wid,userId]);
  await pool.query("INSERT INTO documents(id,workspace_id,media_asset_id,original_filename,status,created_by) VALUES($1,$2,$3,'fixture.pdf','READY',$4)",[document,wid,asset,userId]);
  await pool.query("INSERT INTO document_visual_concepts(id,document_id,workspace_id,concept_title,prompt,caption,asset_id,image_url) VALUES($1,$2,$3,'PDF fixture','Fixture image prompt','Fixture caption #Fixture',$4,'https://fixture.example.test/image.jpg')",[concept,document,wid,asset]);
  outcome='failure';r=await api(`/documents/${document}/visual-concepts/${concept}/dispatch`,'POST',{channels:['telegram']});assert.equal(r.status,201,JSON.stringify(r));assert.equal(r.data.success,false,JSON.stringify(r));
  const record=(await pool.query('SELECT content_id,status FROM document_visual_concepts WHERE id=$1',[concept])).rows[0];assert.notEqual(record.status,'DISPATCHED');assert.notEqual((await pool.query('SELECT status FROM content WHERE id=$1',[record.content_id])).rows[0].status,'PUBLISHED');
  outcome='success';r=await api(`/documents/${document}/visual-concepts/${concept}/dispatch`,'POST',{channels:['telegram']});assert.equal(r.data.success,true,JSON.stringify(r));assert.equal(r.data.publishedCount,1);
  assert.equal((await pool.query('SELECT status FROM document_visual_concepts WHERE id=$1',[concept])).rows[0].status,'DISPATCHED');
});

test('generated image -> prompt captions -> edited Library draft -> publishing stays connected',async()=>{
  await resetQuota();await pool.query('UPDATE workspaces SET require_approval=false WHERE id=$1',[wid]);
  const image=await api('/clipdrop/generate-image','POST',{prompt:'An amber owl resting in a snowy pine forest',engine:'flux',aspectRatio:'1:1',enableOverlay:false});assert.equal(image.status,201,JSON.stringify(image));assert.ok(image.data.assetId);
  const captions=await api('/ai/image-captions','POST',{assetId:image.data.assetId,platform:'Telegram'});assert.equal(captions.status,201,JSON.stringify(captions));const edited=captions.data.options[1].caption+'\nReviewed by the author.';
  const saved=await api('/clipdrop/attach-and-save','POST',{title:'Owl visual',body:edited,platforms:['Telegram'],assetId:image.data.assetId,mediaUrl:image.data.url,status:'DRAFT'});assert.equal(saved.status,201,JSON.stringify(saved));
  const record=(await pool.query('SELECT body,variants FROM content WHERE id=$1',[saved.data.id])).rows[0];assert.equal(record.body,edited);assert.equal(record.variants.Telegram.caption,edited);
  const published=await api(`/content/${saved.data.id}/publish`,'POST',{socialAccountId:accountId});assert.equal(published.status,201,JSON.stringify(published));assert.equal(published.data.success,true);
});

 test('PDF upload automatically extracts citations, creates image, generates captions and schedules without UI actions',async()=>{
  await resetQuota();await pool.query('UPDATE workspace_subscriptions SET custom_daily_limit=10 WHERE workspace_id=$1',[wid]);
  await pool.query('DELETE FROM knowledge_automation_settings WHERE workspace_id=$1',[wid]);
  const events=[];
  const {getLLMProvider,setLLMProvider}=await import('../dist-api/ai/llm.service.js');const previous=getLLMProvider();
  setLLMProvider({validateConfiguration:async()=>true,generateStructured:async(req)=>{
    events.push(req.schemaName);
    if(req.schemaName==='DocumentKnowledgeExtraction')return {data:{facts:[{type:'SERVICE',key:'Content planning',value:'Our team offers content planning for businesses.',supportingChunkIds:[],confidence:0.95}]},provider:'fixture',model:'fixture'};
    if(req.schemaName==='PosterPromptSuggestion')return {data:{prompt:'An amber editorial illustration showing a business content calendar and planning desk',headline:'Content planning'},provider:'fixture',model:'fixture'};
    if(req.schemaName==='SocialCaptions'){
      const brief=JSON.parse(req.messages[1].content).brief;const context=JSON.parse(brief.topic);
      assert.ok(context.imageAssetId);assert.match(context.imagePrompt,/planning/);assert.ok(context.evidence.length);
      assert.equal((await pool.query("SELECT status FROM media_assets WHERE id=$1",[context.imageAssetId])).rows[0].status,'COMPLETED');
      return {data:{title:'Content planning for businesses',variants:Object.fromEntries(brief.platforms.map(p=>[p,`${p}: Our team offers content planning for businesses. #ContentPlanning #Business`]))},provider:'fixture',model:'fixture'};
    }
    throw Error('Unexpected fixture request '+req.schemaName);
  }});
  try{
    const {PDFDocument,StandardFonts}=await import('pdf-lib');const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage().drawText('Our team offers content planning for businesses.',{x:40,y:700,font,size:14});
    const {getStorageProvider}=await import('../dist-api/storage/storage.factory.js');const {provider,bucket}=getStorageProvider();const {uploadManagedMedia}=await import('../dist-api/storage/managed-media.js');
    const assetId=await uploadManagedMedia({workspaceId:wid,userId,bucket,provider,objectKey:'fixtures/automatic.pdf',body:Buffer.from(await pdf.save()),mimeType:'application/pdf',filename:'automatic.pdf',type:'DOCUMENT'});
    const uploaded=await api('/documents','POST',{mediaAssetId:assetId});assert.equal(uploaded.status,201,JSON.stringify(uploaded));const documentId=uploaded.data.documentId;
    const {postgresQueue}=await import('../dist-api/queues.js');const {runCron}=await import('../dist-api/cron-runtime.js');const {executeCronJob}=await import('../dist-api/cron-job.js');
    for(let i=0;i<5;i++)await runCron(postgresQueue,{lane:'background',budgetMs:20000,handle:executeCronJob});
    const plans=(await pool.query("SELECT p.*,c.variants,c.approved_by,c.status FROM knowledge_content_plans p JOIN content c ON c.id=p.content_id WHERE p.workspace_id=$1 AND p.source_snapshot::text LIKE $2",[wid,'%'+documentId+'%'])).rows;
    assert.equal(plans.length,1,JSON.stringify((await pool.query('SELECT state,error_message FROM knowledge_content_plans WHERE workspace_id=$1',[wid])).rows));
    assert.equal(plans[0].status,'SCHEDULED');assert.equal(plans[0].approved_by,userId);assert.match(plans[0].variants.Telegram.caption,/#ContentPlanning/);assert.ok(plans[0].variants.Telegram.mediaAssetId);
    assert.ok(events.indexOf('PosterPromptSuggestion')<events.indexOf('SocialCaptions'));
    const count=(await pool.query('SELECT count(*)::int n FROM scheduled_posts WHERE content_id=$1',[plans[0].content_id])).rows[0].n;assert.ok(count>=1);
    const {KnowledgeAutomationService}=await import('../dist-api/knowledge/automation.service.js');const replay=await new KnowledgeAutomationService().run(wid,3,documentId);assert.equal(replay.generated,0,'replay must respect topic cooldown');
    await pool.query("UPDATE scheduled_posts SET execute_at=now()-interval '1 second' WHERE content_id=$1",[plans[0].content_id]);
    const jobs=(await pool.query('SELECT id FROM scheduled_posts WHERE content_id=$1',[plans[0].content_id])).rows;
    const {executePublishRecord}=await import('../dist-api/publishing.js');
    for(const job of jobs)assert.equal((await executePublishRecord(job.id)).success,true,'automatic output passes the actual publishing policy');
    await pool.query('UPDATE knowledge_automation_settings SET enabled=false WHERE workspace_id=$1',[wid]);assert.equal((await new KnowledgeAutomationService().run(wid,3,documentId)).generated,0);
    const second=await api('/documents','POST',{mediaAssetId:assetId});assert.equal(second.status,201);assert.equal((await pool.query('SELECT enabled FROM knowledge_automation_settings WHERE workspace_id=$1',[wid])).rows[0].enabled,false,'upload preserves explicit pause');
    for(let i=0;i<3;i++)await runCron(postgresQueue,{lane:'background',budgetMs:20000,handle:executeCronJob});
    assert.equal((await pool.query("SELECT count(*)::int n FROM knowledge_content_plans WHERE workspace_id=$1 AND source_snapshot::text LIKE $2",[wid,'%'+second.data.documentId+'%'])).rows[0].n,0);
    await pool.query('UPDATE knowledge_automation_settings SET enabled=true,autopilot_enabled=false WHERE workspace_id=$1',[wid]);
    await pool.query("UPDATE document_knowledge SET value=to_jsonb('Our team offers thoughtful content planning for businesses.'::text) WHERE document_id=$1",[documentId]);
    const review=await new KnowledgeAutomationService().run(wid,1,documentId);assert.equal(review.generated,1,JSON.stringify(review));assert.equal(review.scheduled,0);
    const draft=(await pool.query("SELECT c.status,c.approved_by FROM knowledge_content_plans p JOIN content c ON c.id=p.content_id WHERE p.workspace_id=$1 ORDER BY p.created_at DESC LIMIT 1",[wid])).rows[0];assert.equal(draft.status,'NEEDS_REVIEW');assert.equal(draft.approved_by,null);
  }finally{setLLMProvider(previous);}
 });

