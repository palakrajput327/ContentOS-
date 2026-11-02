import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOpenAIImage } from '../dist-api/ai/openai-image.js';
test('OpenAI image request uses server key and returns image bytes',async()=>{
 const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-key';
 try {let payload;const result=await generateOpenAIImage('Poster artwork','1:1',async(url,options)=>{
  assert.equal(url,'https://api.openai.com/v1/images/generations');assert.equal(options.headers.Authorization,'Bearer test-key');payload=JSON.parse(options.body);
  return new Response(JSON.stringify({data:[{b64_json:Buffer.from('image').toString('base64')}]}),{status:200});
 });assert.equal(result.toString(),'image');assert.equal(payload.size,'1024x1024');assert.equal(payload.n,1);
 }finally {if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
});
test('billing errors remain actionable and never leak provider response secrets',async()=>{
 process.env.OPENAI_API_KEY='test-key';
 await assert.rejects(generateOpenAIImage('Poster','1:1',async()=>new Response(JSON.stringify({error:{code:'insufficient_quota',message:'private provider message'}}),{status:429})),error=>error.message.includes('insufficient_quota')&&!error.message.includes('private provider message'));
});
