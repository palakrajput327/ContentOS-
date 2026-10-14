import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, before, after, mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { spawn } from 'node:child_process';
import EmbeddedPostgres from 'embedded-postgres';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// Never read .env or accept an external DATABASE_URL. Always provision a new local cluster.
const originalCwd=process.cwd(),testDir=await mkdtemp(join(tmpdir(),'contentos-pgqueue-'));
const root=fileURLToPath(new URL('../',import.meta.url));
let cluster,pool,queue,runCron,executeCronJob,app;
const ids={user:randomUUID(),ws:randomUUID(),other:randomUUID(),account:randomUUID()};
let providerCalls=0,providerOutcome='success',smtpCalls=0,knowledgeCalls=0;
const smtpReceipts=[];
mock.module('nodemailer',{defaultExport:{createTransport:()=>({
  async sendMail(mail){smtpCalls++;smtpReceipts.push(mail);return {accepted:[mail.to]};},close(){},
})}});
mock.module('../dist-api/auto-poster.js',{namedExports:{
  uploadFestivalPosterJpegToStorage:async()=>({url:'https://fixture.example.test/poster.jpg'}),
  uploadAutoPosterJpegToStorage:async()=>({url:'https://fixture.example.test/poster.jpg'}),
  renderFestivalPosterSvg:()=>'<svg/>',
  generateFestivalPosterJpegBuffer:async()=>Buffer.from('fixture'),
}});
mock.module('../dist-api/ai/llm.service.js',{namedExports:{
  getLLMProvider:()=>({generateStructured:async()=>({provider:'fixture',model:'fixture',data:{facts:[{type:'INSIGHT',key:'Fixture concept',value:'Fixture insight',supportingChunkIds:[],confidence:0.9}]}})}),
  createLLMProvider:()=>({generateStructured:async()=>({provider:'fixture',model:'fixture',data:{facts:[]}})}),
}});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
async function clearJobs(){await pool.query('TRUNCATE queue_jobs,queue_worker_leases,queue_recurring_tasks,api_rate_limits');}
async function publication({state='PENDING',status='SCHEDULED',version=1,jobVersion=version,when=new Date(Date.now()-1000)}={}){
  const content=randomUUID(),schedule=randomUUID();
  await pool.query(`INSERT INTO content(id,workspace_id,title,body,platforms,status,version,created_by,updated_by)
    VALUES($1,$2,'Queue fixture','Publishing fixture','["Telegram"]',$3,$4,$5,$5)`,[content,ids.ws,status,version,ids.user]);
  await pool.query(`INSERT INTO scheduled_posts(id,workspace_id,content_id,account_id,content_version,execute_at,timezone,state)
    VALUES($1,$2,$3,$4,$5,$6,'UTC',$7)`,[schedule,ids.ws,content,ids.account,jobVersion,when,state]);
  return {content,schedule};
}
async function enqueuePublish(record){return queue.enqueue('social-publishing','publish',{id:record.schedule,workspaceId:ids.ws},{workspaceId:ids.ws,key:record.schedule,attempts:5,backoff:10});}

before(async()=>{
  const port=await freePort();
  cluster=new EmbeddedPostgres({databaseDir:join(testDir,'database'),port,user:'queue_test',password:'local-test-only',
    persistent:true,createPostgresUser:false,postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
  await cluster.initialise();await cluster.start();await cluster.createDatabase('contentos_queue_test');
  Object.assign(process.env,{
    DATABASE_URL:`postgresql://queue_test:local-test-only@127.0.0.1:${port}/contentos_queue_test`,QUEUE_BACKEND:'postgres',
    APP_ENV:'test',NODE_ENV:'test',APP_URL:'http://localhost:5173',APP_ORIGIN:'http://localhost:5173',
    ENCRYPTION_KEY:'ab'.repeat(32),TOKEN_ENCRYPTION_KEY:'ab'.repeat(32),MAIL_HOST:'fixture.example.test',MAIL_PORT:'587',
    MAIL_FROM_ADDRESS:'sender@example.test',MAIL_USERNAME:'fixture',MAIL_PASSWORD:'fixture',STORAGE_BUCKET:'test',
    STORAGE_PROVIDER:'local',LOCAL_STORAGE_ROOT:join(testDir,'uploads'),
  });
  delete process.env.REDIS_URL;delete process.env.STORAGE_ENDPOINT;delete process.env.STORAGE_ACCESS_KEY;delete process.env.STORAGE_SECRET_KEY;
  process.chdir(testDir);
  ({pool}=await import('../dist-api/db.js'));
  assert.equal(new URL(process.env.DATABASE_URL).hostname,'127.0.0.1');
  const {migrate}=await import('../dist-api/migrate.js');await migrate();
  const {PostgresQueue}=await import('../dist-api/postgres-queue.js');queue=new PostgresQueue(pool);
  ({runCron}=await import('../dist-api/cron-runtime.js'));({executeCronJob}=await import('../dist-api/cron-job.js'));
  const {hashPassword,encryptToken}=await import('../dist-api/security.js');
  await pool.query(`INSERT INTO users(id,email,name,password_hash,email_verified_at,terms_accepted_at,account_status)
    VALUES($1,'queue-user@example.test','Fixture',$2,now(),now(),'ACTIVE')`,[ids.user,await hashPassword('Fixture-password-123')]);
  for(const ws of [ids.ws,ids.other]){
    await pool.query(`INSERT INTO workspaces(id,name,timezone,require_approval) VALUES($1,'Fixture','UTC',true)`,[ws]);
    await pool.query(`INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'Owner')`,[ws,ids.user]);
  }
  await pool.query(`INSERT INTO social_accounts(id,workspace_id,platform,provider_id,name,state)
    VALUES($1,$2,'telegram','fixture','Fixture','Connected')`,[ids.account,ids.ws]);
  await pool.query('INSERT INTO social_account_tokens(account_id,ciphertext) VALUES($1,$2)',[ids.account,encryptToken('fixture-token',ids.ws)]);
  const {SocialProviderRegistry}=await import('../dist-api/social.provider.js');
  SocialProviderRegistry.getProvider=()=>({async publishText(){providerCalls++;await pause(20);
    if(providerOutcome==='ambiguous')return {success:false,uncertain:true,error:'PROVIDER_OUTCOME_UNKNOWN'};
    return {success:true,providerPostId:`fixture-${providerCalls}`};}});
});
after(async()=>{
  if(app)await app.close();
  if(pool)await pool.end();
  if(cluster)await cluster.stop();
  process.chdir(originalCwd);
  // This unique test directory contains only artifacts created by this suite.
  assert.ok(testDir.startsWith(tmpdir()));await rm(testDir,{recursive:true,force:true});
});

test('fresh isolated database applies the additive migration',async()=>{
  assert.ok((await pool.query("SELECT name FROM schema_migrations WHERE name='023_postgres_queue.sql'")).rowCount);
  console.log('Local PostgreSQL version:',(await pool.query('SHOW server_version')).rows[0].server_version);
});
test('enqueue deduplicates per tenant and rolls back with business writes',async()=>{
  await clearJobs();
  const jobs=await Promise.all(Array.from({length:12},()=>queue.enqueue('pdf-processing','extract',{}, {workspaceId:ids.ws,key:'same'})));
  assert.equal(new Set(jobs.map(j=>j.id)).size,1);
  const second=await queue.enqueue('pdf-processing','extract',{}, {workspaceId:ids.other,key:'same'});
  assert.notEqual(second.id,jobs[0].id);
  const {transaction}=await import('../dist-api/db.js');
  await assert.rejects(transaction(async db=>{await queue.enqueue('pdf-processing','extract',{}, {workspaceId:ids.ws,key:'rollback'},db);throw Error('rollback');}));
  assert.equal((await pool.query("SELECT count(*) FROM queue_jobs WHERE dedupe_key='rollback'")).rows[0].count,'0');
});
test('concurrent claims are exclusive; future work waits',async()=>{
  await clearJobs();
  await queue.enqueue('pdf-processing','extract',{}, {workspaceId:ids.ws,key:'due'});
  await queue.enqueue('pdf-processing','extract',{}, {workspaceId:ids.ws,key:'later',runAt:new Date(Date.now()+60000)});
  const claimed=await Promise.all(Array.from({length:10},()=>queue.claim(['pdf-processing'])));
  assert.equal(claimed.filter(Boolean).length,1);
  assert.equal(await queue.claim(['pdf-processing']),undefined);
});
test('retry backoff and maximum attempts are preserved',async()=>{
  await clearJobs();await queue.enqueue('pdf-processing','extract',{}, {workspaceId:ids.ws,key:'retry',attempts:2,backoff:10000});
  let job=await queue.claim(['pdf-processing']);await queue.settle(job,'retry',null,'TRANSIENT');
  assert.equal(await queue.claim(['pdf-processing']),undefined);
  await pool.query("UPDATE queue_jobs SET run_at=now()-interval '1 second' WHERE dedupe_key='retry'");job=await queue.claim(['pdf-processing']);assert.equal(job.attempts,2);
  await queue.settle(job,'retry');assert.equal((await pool.query('SELECT state FROM queue_jobs WHERE id=$1',[job.id])).rows[0].state,'failed');
});
test('crash recovery reclaims safe jobs and fences the old owner',async()=>{
  await clearJobs();await queue.enqueue('pdf-processing','extract',{}, {workspaceId:ids.ws,key:'crash',backoff:0});
  const old=await queue.claim(['pdf-processing'],100);
  await pool.query("UPDATE queue_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[old.id]);
  await queue.recover(['pdf-processing']);const next=await queue.claim(['pdf-processing']);
  assert.notEqual(next.owner,old.owner);assert.equal(await queue.settle(old,'completed'),false);assert.equal(await queue.heartbeat(old),false);
  assert.equal(await queue.settle(next,'completed'),true);
});
test('concurrent cron executions skip an active lane; heartbeat prevents takeover',async()=>{
  await clearJobs();await queue.enqueue('pdf-processing','extract',{}, {workspaceId:ids.ws,key:'cron'});
  let entered;const ready=new Promise(r=>entered=r);
  const first=runCron(queue,{lane:'background',leaseMs:1000,heartbeatMs:50,handle:async()=>{entered();await pause(1600);return {outcome:'completed'};}});
  await ready;await pause(1200);
  assert.deepEqual(await runCron(queue,{lane:'background',handle:async()=>{throw Error('overlap');}}),{skipped:true,processed:0});
  assert.equal((await first).processed,1);
});
test('cron abort drains the current job, does not claim another, and releases its lane',async()=>{
  await clearJobs();for(let i=0;i<2;i++)await queue.enqueue('pdf-processing','extract',{}, {workspaceId:ids.ws,key:`stop-${i}`});
  const controller=new AbortController();
  const result=await runCron(queue,{lane:'background',signal:controller.signal,handle:async()=>{controller.abort();return {outcome:'completed'};}});
  assert.equal(result.processed,1);assert.equal((await pool.query("SELECT count(*) FROM queue_jobs WHERE state='waiting'")).rows[0].count,'1');
  assert.equal(await queue.acquireLane('background',randomUUID()),true);
});
test('a killed OS process releases no job acknowledgement; lease recovery works',async()=>{
  await clearJobs();await queue.enqueue('pdf-processing','extract',{}, {workspaceId:ids.ws,key:'os-crash',backoff:0});
  const childCode=`import pg from ${JSON.stringify(new URL('../node_modules/pg/lib/index.js',import.meta.url).href)};\nconst p=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:false});\nawait p.query("UPDATE queue_jobs SET state='active',owner=$1,attempts=1,lease_until=now()-interval '1 second' WHERE dedupe_key='os-crash'",[${JSON.stringify(randomUUID())}]);process.exit(9);`;
  const fixture=join(testDir,'crash.mjs');await writeFile(fixture,childCode);
  const child=spawn(process.execPath,[fixture],{env:process.env,windowsHide:true,stdio:'ignore'});
  assert.equal(await new Promise(r=>child.once('exit',r)),9);
  assert.equal(await queue.recover(['pdf-processing']),1);assert.ok(await queue.claim(['pdf-processing']));
});
test('publishing handler dispatches once under duplicate deliveries',async()=>{
  await clearJobs();providerOutcome='success';const record=await publication();const queued=await enqueuePublish(record);
  const job=await queue.claim(['social-publishing']);const before=providerCalls;
  const {executePublishRecord}=await import('../dist-api/publishing.js');
  const outcomes=await Promise.all([executeCronJob(job),executePublishRecord(record.schedule)]);
  assert.equal(providerCalls-before,1);assert.equal(outcomes[0].outcome,'completed');
  await queue.settle(job,'completed');
  assert.equal((await pool.query('SELECT state FROM scheduled_posts WHERE id=$1',[record.schedule])).rows[0].state,'PUBLISHED');
  assert.equal((await queue.enqueue('social-publishing','publish',{id:record.schedule,workspaceId:ids.ws},{workspaceId:ids.ws,key:record.schedule})).id,queued.id);
});
test('ambiguous publication stays uncertain and is never automatically resent',async()=>{
  await clearJobs();providerOutcome='ambiguous';const record=await publication();await enqueuePublish(record);
  const job=await queue.claim(['social-publishing']),before=providerCalls;
  const result=await executeCronJob(job);assert.equal(result.outcome,'uncertain');await queue.settle(job,result.outcome);
  await queue.recover(['social-publishing']);assert.equal(await queue.claim(['social-publishing']),undefined);
  assert.equal(providerCalls-before,1);assert.equal((await pool.query('SELECT state FROM scheduled_posts WHERE id=$1',[record.schedule])).rows[0].state,'UNCERTAIN');
});
test('interrupted publishing becomes uncertain; stale versions and cancelled work do not dispatch',async()=>{
  await clearJobs();const record=await publication();await enqueuePublish(record);const job=await queue.claim(['social-publishing']);
  await pool.query("UPDATE scheduled_posts SET state='PROCESSING',attempt_started_at=now() WHERE id=$1",[record.schedule]);
  await pool.query("UPDATE queue_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",[job.id]);
  await queue.recover(['social-publishing']);assert.equal((await pool.query('SELECT state FROM scheduled_posts WHERE id=$1',[record.schedule])).rows[0].state,'UNCERTAIN');
  const before=providerCalls;
  for(const opts of [{state:'CANCELLED'},{version:2,jobVersion:1},{status:'NEEDS_REVIEW'}]){
    const record=await publication(opts);const {executePublishRecord}=await import('../dist-api/publishing.js');await executePublishRecord(record.schedule);
  }
  assert.equal(providerCalls,before);
});
test('queue facade rejects forged tenant payloads and requires tenant-scoped lookup',async()=>{
  await clearJobs();const {publishingQueue}=await import('../dist-api/queues.js');const record=await publication();
  await assert.rejects(publishingQueue.add('publish',{id:record.schedule,workspaceId:ids.other},{jobId:record.schedule}),/tenant mismatch/);
  await publishingQueue.add('publish',{id:record.schedule,workspaceId:ids.ws},{jobId:record.schedule});
  assert.equal(await publishingQueue.getJob(record.schedule,ids.other),undefined);
  await assert.rejects(publishingQueue.getJob(record.schedule),/workspaceId/);
});
test('batch handler commits child results with their operation and skips completed children on replay',async()=>{
  await clearJobs();const record=await publication({status:'NEEDS_REVIEW'});
  const {BatchService}=await import('../dist-api/batch/batch.service.js');
  const batch=await BatchService.createBatch({workspaceId:ids.ws,userId:ids.user,role:'Owner',type:'bulk_approve',
    items:[{operationType:'bulk_approve',targetId:record.content,payload:{userId:ids.user}}]});
  const job=await queue.claim(['batch-processing']);assert.equal((await executeCronJob(job)).outcome,'completed');
  assert.equal((await pool.query('SELECT status FROM content WHERE id=$1',[record.content])).rows[0].status,'APPROVED');
  const approvals=(await pool.query('SELECT count(*) FROM approvals WHERE content_id=$1',[record.content])).rows[0].count;
  await executeCronJob(job);
  assert.equal((await pool.query('SELECT count(*) FROM approvals WHERE content_id=$1',[record.content])).rows[0].count,approvals);
  assert.equal((await pool.query('SELECT status FROM batch_jobs WHERE id=$1',[batch.batchId])).rows[0].status,'COMPLETED');
});
test('reconciliation is read-only by default and import is idempotent without altering schedules',async()=>{
  await clearJobs();const record=await publication();const before=(await pool.query('SELECT * FROM scheduled_posts WHERE id=$1',[record.schedule])).rows[0];
  const {reconciliationPlan,importPlan}=await import('../dist-api/queue-reconcile.js');
  const plan=await reconciliationPlan(pool);assert.ok(plan.items.some(i=>i.key===record.schedule));
  assert.equal((await pool.query('SELECT count(*) FROM queue_jobs')).rows[0].count,'0');
  const items=plan.items.filter(i=>i.key===record.schedule);await importPlan(items);await importPlan(items);
  assert.equal((await pool.query('SELECT count(*) FROM queue_jobs')).rows[0].count,'1');
  assert.deepEqual((await pool.query('SELECT * FROM scheduled_posts WHERE id=$1',[record.schedule])).rows[0],before);
});
test('a bounded cron child exits on timeout and uncertain publishing is not retried',async()=>{
  await clearJobs();const record=await publication();await enqueuePublish(record);const job=await queue.claim(['social-publishing']);
  const {childJob}=await import('../dist-api/cron-worker.js');
  const result=await childJob(job,new AbortController().signal,1);
  assert.equal(result.outcome,'uncertain');assert.equal(result.code,'EXECUTION_TIMEOUT');
  await queue.settle(job,result.outcome,null,result.code);
  assert.equal((await pool.query('SELECT state FROM scheduled_posts WHERE id=$1',[record.schedule])).rows[0].state,'UNCERTAIN');
});
test('OTP outbox dispatch preserves expiry, test isolation and minute-cron pickup latency',async()=>{
  await clearJobs();await pool.query('TRUNCATE email_outbox');
  const {encryptToken}=await import('../dist-api/security.js');const {deliverEmails}=await import('../dist-api/mail.js');
  for(const [age,expires,isTest]of [[59000,600000,false],[1000,-1000,false],[1000,600000,true]]){
    const id=randomUUID();await pool.query(`INSERT INTO email_outbox(id,recipient,subject,encrypted_body,expires_at,created_at,is_test)
      VALUES($1,'recipient@example.test','OTP',$2,now()+$3*interval '1 millisecond',now()-$4*interval '1 millisecond',$5)`,[id,encryptToken('Fixture OTP',`mail:${id}`),expires,age,isTest]);
  }
  const before=smtpCalls,result=await deliverEmails({limit:5,budgetMs:30000});
  assert.equal(smtpCalls-before,1);assert.equal(result.delivered,1);
  assert.ok(result.maxLatencyMs>=59000 && result.maxLatencyMs<65000);
  assert.equal((await pool.query("SELECT count(*) FROM email_outbox WHERE state='EXPIRED' AND encrypted_body IS NULL")).rows[0].count,'1');
  assert.equal((await pool.query("SELECT state FROM email_outbox WHERE is_test=true")).rows[0].state,'PENDING');
  console.log('Simulated minute-cron OTP pickup latency ms:',result.maxLatencyMs);
});
test('PostgreSQL rate limiting is atomic and expiration resets its window',async()=>{
  await clearJobs();const {postgresRateLimit}=await import('../dist-api/rate-limiter.js');
  const counts=await Promise.all(Array.from({length:30},()=>postgresRateLimit('fixture-rate')));
  assert.equal(new Set(counts).size,30);assert.equal(Math.max(...counts),30);
  await pool.query("UPDATE api_rate_limits SET expires_at=now()-interval '1 second' WHERE key='fixture-rate'");
  assert.equal(await postgresRateLimit('fixture-rate'),1);
});
test('PDF and AI handlers run through the PostgreSQL queue without background worker imports',async()=>{
  await clearJobs();
  const {KnowledgeService}=await import('../dist-api/knowledge/knowledge.service.js');
  const original=KnowledgeService.prototype.processKnowledgeExtraction;
  KnowledgeService.prototype.processKnowledgeExtraction=async function(generationId,documentId,workspaceId){
    knowledgeCalls++;assert.equal(workspaceId,ids.ws);
    await pool.query("UPDATE ai_generations SET status='COMPLETED' WHERE id=$1 AND workspace_id=$2",[generationId,workspaceId]);
  };
  try{
    const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText('ContentOS PostgreSQL queue PDF extraction and knowledge fixture.',{font,size:12});
    const bytes=Buffer.from(await pdf.save()),asset=randomUUID(),document=randomUUID();
    ids.document=document;
    const {getStorageProvider}=await import('../dist-api/storage/storage.factory.js');
    const storage=getStorageProvider();await storage.provider.upload({bucket:storage.bucket,objectKey:'fixture.pdf',body:bytes,mimeType:'application/pdf'});
    await pool.query(`INSERT INTO media_assets(id,workspace_id,type,status,bucket,object_key,mime_type,size_bytes,original_filename,created_by)
      VALUES($1,$2,'DOCUMENT','COMPLETED','test','fixture.pdf','application/pdf',$3,'fixture.pdf',$4)`,[asset,ids.ws,bytes.length,ids.user]);
    await pool.query(`INSERT INTO documents(id,workspace_id,media_asset_id,original_filename,status,created_by)
      VALUES($1,$2,$3,'fixture.pdf','QUEUED',$4)`,[document,ids.ws,asset,ids.user]);
    const {createQueue,redis}=await import('../dist-api/queues.js');assert.equal(redis,null);
    await createQueue('pdf-processing').add('extract',{documentId:document,workspaceId:ids.ws},{jobId:document});
    let job=await queue.claim(['pdf-processing']);const result=await executeCronJob(job);
    assert.equal(result.outcome,'completed');assert.equal(result.result.pageCount,1);await queue.settle(job,result.outcome);
    assert.equal((await pool.query('SELECT status FROM documents WHERE id=$1',[document])).rows[0].status,'READY');
    const automatic=await queue.claim(['content-generation']);assert.ok(automatic);
    assert.equal((await executeCronJob(automatic)).outcome,'completed');await queue.settle(automatic,'completed');
    const generation=randomUUID();await pool.query(`INSERT INTO ai_generations(id,workspace_id,actor_id,provider,generation_type,status,input,output)
      VALUES($1,$2,$3,'fixture','DOCUMENT_KNOWLEDGE','QUEUED',$4,'{}')`,[generation,ids.ws,ids.user,JSON.stringify({documentId:document})]);
    await createQueue('content-generation').add('extract-knowledge',{generationId:generation,documentId:document,workspaceId:ids.ws},{jobId:generation});
    job=await queue.claim(['content-generation']);await executeCronJob(job);const before=knowledgeCalls;await executeCronJob(job);
    assert.equal(knowledgeCalls,before);assert.ok(knowledgeCalls>=2);
  }finally{KnowledgeService.prototype.processKnowledgeExtraction=original;}
});
test('interrupted AI generation resumes without duplicating persisted facts',async()=>{
  await clearJobs();const generation=randomUUID();
  await pool.query(`INSERT INTO ai_generations(id,workspace_id,actor_id,provider,generation_type,status,input,output)
    VALUES($1,$2,$3,'fixture','DOCUMENT_KNOWLEDGE','QUEUED',$4,'{}')`,[generation,ids.ws,ids.user,JSON.stringify({documentId:ids.document})]);
  await queue.enqueue('content-generation','extract-knowledge',{generationId:generation,documentId:ids.document,workspaceId:ids.ws},
    {workspaceId:ids.ws,key:generation,attempts:3,backoff:0});
  const job=await queue.claim(['content-generation']);await executeCronJob(job);
  const before=(await pool.query('SELECT count(*) FROM document_knowledge WHERE generation_id=$1',[generation])).rows[0].count;
  assert.equal(before,'1');
  await pool.query("UPDATE ai_generations SET status='PROCESSING' WHERE id=$1",[generation]);
  await executeCronJob({...job,attempts:2});
  assert.equal((await pool.query('SELECT count(*) FROM document_knowledge WHERE generation_id=$1',[generation])).rows[0].count,before);
  assert.equal((await pool.query('SELECT status FROM ai_generations WHERE id=$1',[generation])).rows[0].status,'COMPLETED');
});
test('festival automation preserves manual review and deduplicates generated drafts',async()=>{
  await clearJobs();const {FestivalAutoSchedulerService}=await import('../dist-api/calendar/festival-auto-scheduler.js');
  await pool.query(`UPDATE workspaces SET festival_automation_enabled=true,festival_auto_publish_enabled=false,festival_approval_mode='MANUAL_APPROVAL',festival_prep_days=2 WHERE id=$1`,[ids.ws]);
  await pool.query(`INSERT INTO brand_kits(workspace_id,data) VALUES($1,'{"companyName":"Fixture Brand"}') ON CONFLICT(workspace_id) DO UPDATE SET data=EXCLUDED.data`,[ids.ws]);
  const now=new Date('2026-11-07T00:00:00Z');
  const first=await FestivalAutoSchedulerService.runFestivalAutoScheduler(pool,{nowFn:()=>now,workspaceId:ids.ws});
  const second=await FestivalAutoSchedulerService.runFestivalAutoScheduler(pool,{nowFn:()=>now,workspaceId:ids.ws});
  assert.equal(first.errors.length,0);assert.equal(second.generatedDrafts,0);
  const drafts=(await pool.query("SELECT status FROM content WHERE workspace_id=$1 AND variants->'metadata'->>'content_source'='INDIAN_FESTIVAL_ENGINE'",[ids.ws])).rows;
  assert.ok(drafts.length>0);assert.ok(drafts.every(d=>d.status==='NEEDS_REVIEW'));
});
test('PostgreSQL API boots without Redis; unauthenticated access and rate limits remain enforced',async()=>{
  await clearJobs();process.env.PORT=String(await freePort());
  const {bootstrap}=await import('../dist-api/phase-main.js');app=await bootstrap();
  const url=`http://127.0.0.1:${process.env.PORT}`;
  const ready=await fetch(url+'/api/v1/health/ready');assert.equal(ready.status,200);
  assert.equal((await ready.json()).data.redis,'disabled');
  assert.equal((await fetch(url+'/api/v1/auth/me')).status,401);
  const requests=await Promise.all(Array.from({length:25},()=>fetch(url+'/api/v1/auth/login',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'invalid',password:'invalid'}),
  })));
  assert.equal(requests.filter(r=>r.status===429).length,5);
  assert.ok(requests.filter(r=>r.status!==429).every(r=>r.status===400));
  await pool.query('TRUNCATE api_rate_limits');
  const login=await fetch(url+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'queue-user@example.test',password:'Fixture-password-123'})});
  assert.equal(login.status,201);assert.ok(login.headers.get('set-cookie'));
  const session=login.headers.get('set-cookie').match(/contentos_session=([^;]+)/)?.[1];assert.ok(session);
  assert.equal((await fetch(url+'/api/v1/auth/me',{headers:{Cookie:`contentos_session=${session}`}})).status,200);
  await pool.query("UPDATE users SET account_status='SUSPENDED' WHERE id=$1",[ids.user]);
  assert.equal((await fetch(url+'/api/v1/auth/me',{headers:{Cookie:`contentos_session=${session}`}})).status,401);
  await pool.query("UPDATE users SET account_status='ACTIVE' WHERE id=$1",[ids.user]);
  const {queueTokenEmail}=await import('../dist-api/mail.js');const {transaction}=await import('../dist-api/db.js');
  await transaction(db=>queueTokenEmail(db,{id:ids.user,email:'queue-user@example.test'},'login','fixture-challenge'));
  assert.equal((await pool.query("SELECT count(*) FROM email_outbox WHERE subject='Your ContentOS sign-in code'")).rows[0].count,'1');
  const {redis}=await import('../dist-api/queues.js');assert.equal(redis,null);
});
