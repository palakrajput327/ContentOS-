import assert from 'node:assert/strict';
import { createLLMProvider } from '../dist-api/ai/llm.service.js';
import { knowledgeExtractionOutputSchema } from '../dist-api/knowledge/knowledge.types.js';
import { SYSTEM_KNOWLEDGE_EXTRACTION_PROMPT } from '../dist-api/knowledge/prompts.js';
const originalFetch = globalThis.fetch;
const secrets = ['GEMINI_API_KEY','GROQ_API_KEY','OPENROUTER_API_KEY'].map(k => process.env[k]).filter(Boolean);
const safe = value => secrets.reduce((s,key) => s.split(key).join('[REDACTED]'), String(value)).slice(0,350);
let trace = [];
let forced = false;
globalThis.fetch = async (url, options) => {
 const host = new URL(url).hostname;
 if (forced && host === 'generativelanguage.googleapis.com') { trace.push({host,status:503,simulated:true}); return new Response('{}',{status:503}); }
 try {
 const res = await originalFetch(url,options);
 const entry = {host,status:res.status};
 if(!res.ok){const data=await res.clone().json().catch(()=>({}));entry.message=safe((Array.isArray(data) ? data[0]?.error?.message : data.error?.message) || data.message || 'Request rejected');}
 trace.push(entry);return res;
 } catch(e) {trace.push({host,error:safe(e.cause?.code || e.name)});throw e;}
};
const chunkId='11111111-1111-4111-8111-111111111111';
const input={messages:[{role:'system',content:SYSTEM_KNOWLEDGE_EXTRACTION_PROMPT},{role:'user',content:JSON.stringify([{chunkId,pageStart:1,pageEnd:1,text:'ExampleCo is a software company headquartered in Austin, Texas.'}])}],schema:knowledgeExtractionOutputSchema,maxTokens:2048};
const results=[];
async function run(name,env,simulate=false){
 trace=[];forced=simulate;
 try {
 const result=await createLLMProvider(env).generateStructured(input);
 assert.ok(result.data.facts.length>0);
 assert.ok(result.data.facts.every(f=>f.supportingChunkIds.every(id=>id===chunkId)));
 const report={test:name,passed:true,provider:result.provider,model:result.model,factCount:result.data.facts.length,usage:result.usage,trace};results.push(report);console.log(JSON.stringify(report));
 } catch(e){const report={test:name,passed:false,error:safe(e.message),trace};results.push(report);console.log(JSON.stringify(report));}
}
const env={...process.env,LLM_MAX_RETRIES:'0',LLM_TIMEOUT_MS:'30000'};
for(const name of (process.env.LIVE_TEST_ONLY ? [process.env.LIVE_TEST_ONLY] : ['gemini','groq','openrouter'])) await run(name,{...env,LLM_PROVIDER:name,LLM_FALLBACK_PROVIDERS:''});
if (!process.env.LIVE_TEST_ONLY) await run('configured-fallback',{...process.env});
if (!process.env.LIVE_TEST_ONLY) await run('simulated-primary-outage-live-fallback',env,true);
console.log(JSON.stringify({summary:results.map(({test,passed,provider})=>({test,passed,provider}))}));
if(results.some(r=>!r.passed))process.exitCode=1;
