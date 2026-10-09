import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Redis } from 'ioredis';
import { Worker } from 'bullmq';
import { MockLLMProvider } from '../dist-api/ai/mock.provider.js';
import { setLLMProvider } from '../dist-api/ai/llm.service.js';
import { generateCaptions } from '../dist-api/ai.controller.js';

// Keep this test offline: importing the existing worker must not consume real jobs.
Redis.prototype.connect = async function () {};
Worker.prototype.run = async function () {};
const { executeChildItem } = await import('../dist-api/batch/batch.worker.js');
const { publishingQueue } = await import('../dist-api/queues.js');
publishingQueue.add = async () => { throw new Error('Generation must never publish.'); };
const provider = new MockLLMProvider();
setLLMProvider(provider);
provider.mockStructuredData = { title:'Review test',variants:{LinkedIn:'Professional update',Telegram:'Community update'} };
const evidence = [{documentId:'doc',pageStart:2,pageEnd:2,excerpt:'Verified excerpt'}];
const writes=[];
const db={query:async(sql,params)=>{
  if(sql.startsWith('SELECT data')) return {rows:[{data:{tone:'Professional'}}]};
  writes.push({sql,params});
  return {rows:[{id:params[0],title:params[2],status:params[7]}]};
}};
try {
  const result=await executeChildItem(db,{operation_type:'ai_generation',payload:{topic:'Verified source',platforms:['LinkedIn','Telegram'],userId:'actor',sourceEvidence:evidence}},'workspace');
  assert.equal(result.status,'NEEDS_REVIEW');
  assert.ok(result.contentId);
  const insert=writes.find(w=>w.sql.startsWith('INSERT INTO content('));
  assert.equal(insert.params[1],'workspace');
  assert.equal(insert.params[6],'actor');
  const variants=JSON.parse(insert.params[5]);
  assert.notEqual(variants.LinkedIn.caption,variants.Telegram.caption);
  assert.deepEqual(variants.LinkedIn.metadata.sourceEvidence,evidence);
  assert.ok(writes.some(w=>w.sql.startsWith('INSERT INTO content_versions')));
  provider.mockStructuredData={title:'Incomplete',variants:{LinkedIn:'Only one caption'}};
  await assert.rejects(generateCaptions('Verified source','Professional','Engagement',['LinkedIn','Telegram']),/every requested platform/);
  provider.validateConfiguration=async()=>false;
  await assert.rejects(generateCaptions('Verified source'),/not configured/);
  console.log('AI workflow passed: distinct variants, automatic NEEDS_REVIEW persistence, source evidence, workspace/actor scope, version snapshot, no publishing, incomplete output and missing AI configuration rejected. Offline test; no external posts.');
  process.exit(0);
} catch(error) {console.error(error);process.exit(1);}
