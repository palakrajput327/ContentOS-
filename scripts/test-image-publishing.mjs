import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ContentController } from '../dist-api/content.controller.js';
import { createPublishPlan } from '../dist-api/publish-planner.js';
import { TelegramProvider, LinkedInProvider } from '../dist-api/social.provider.js';
import { LocalStorageProvider } from '../dist-api/storage/local-storage.provider.js';
import { pool } from '../dist-api/db.js';
import { encryptToken } from '../dist-api/security.js';
import { SocialController } from '../dist-api/social.controller.js';
import { metaMediaTicket } from '../dist-api/meta.media.js';
import { Readable, Writable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
const old = {fetch:globalThis.fetch,connect:pool.connect,query:pool.query,download:LocalStorageProvider.prototype.getSignedDownloadUrl};
const envKeys=['TOKEN_ENCRYPTION_KEY','STORAGE_ENDPOINT','STORAGE_ACCESS_KEY','STORAGE_SECRET_KEY','META_MEDIA_PUBLIC_BASE_URL'];
const oldEnv=envKeys.map(key=>process.env[key]);
process.env.TOKEN_ENCRYPTION_KEY='ab'.repeat(32);
for(const key of envKeys.slice(1)) delete process.env[key];
process.env.META_MEDIA_PUBLIC_BASE_URL='https://media.example';
const wid=randomUUID(),assetId=randomUUID(),contentId=randomUUID();
const accounts=Object.fromEntries(['linkedin','facebook','instagram','telegram','youtube'].map(platform=>[platform,{id:randomUUID(),platform,provider_id:platform==='telegram'?'-100123':platform==='linkedin'?'urn:li:person:test':'123',ciphertext:encryptToken('credential-test',wid)}]));
const post={id:contentId,workspace_id:wid,title:'Library title',body:'hello <world>',version:1,status:'DRAFT',variants:Object.fromEntries(Object.keys(accounts).map(platform=>[platform,{caption:'hello <world>',mediaType:'image',mediaAssetId:assetId,mediaUrl:'https://expired.example/photo.jpg'}]))};
const asset={id:assetId,bucket:'bucket',object_key:'photo.jpg',mime_type:'image/jpeg'};
const published=new Set();let active='',rejectTelegram=false;const calls=[];
LocalStorageProvider.prototype.getSignedDownloadUrl=async()=> 'https://media.example/current.jpg';
async function query(sql,args=[]) {
  if(sql.startsWith('SELECT platform FROM social_accounts'))return{rows:[accounts[active]],rowCount:1};
  if(sql.startsWith('SELECT * FROM content'))return{rows:[post],rowCount:1};
  if(sql.startsWith('SELECT 1 FROM scheduled_posts'))return{rows:[],rowCount:0};
  if(sql.startsWith('SELECT a.*'))return{rows:[accounts[active]],rowCount:1};
  if(sql.includes('FROM media_assets')) {assert.equal(args[1],wid);assert.ok(!sql.includes('SELECT id, url'));return{rows:[asset],rowCount:1};}
  if(sql.startsWith('INSERT INTO scheduled_posts') && sql.includes("'PUBLISHED'"))published.add(active);
  if(sql.startsWith('SELECT id FROM scheduled_posts'))return{rows:[{id:randomUUID()}],rowCount:1};
  return{rows:[],rowCount:1};
}
pool.query=query;pool.connect=async()=>({query,release(){}});
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json',...headers}});
globalThis.fetch=async(url,init={})=>{
  const u=String(url);calls.push({platform:active,url:u,init});
  if(u==='https://media.example/current.jpg')return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}});
  if(u.includes('initializeUpload'))return json({value:{image:'urn:li:image:test',uploadUrl:'https://upload.example/image'}});
  if(u==='https://upload.example/image')return new Response(null,{status:201});
  if(u.includes('linkedin.com/rest/posts')){const body=JSON.parse(init.body);assert.equal(body.commentary,post.body);assert.equal(body.content.media.id,'urn:li:image:test');return new Response(null,{status:201,headers:{'x-restli-id':'urn:li:share:test'}});}
  if(u.includes('/sendPhoto')) {assert.equal(init.body.get('caption'),post.body);assert.equal(init.body.get('chat_id'),'-100123');assert.equal(init.body.get('parse_mode'),null);assert.ok(init.body.get('photo') instanceof Blob);return rejectTelegram?json({ok:false,description:'Forbidden'},403):json({ok:true,result:{message_id:42,date:1700000000}});}
  if(u.includes('/sendMessage'))throw new Error('Image must never downgrade to text');
  const graph=new URL(u);
  if(graph.pathname.endsWith('/photos')){assert.equal(init.body.get('caption'),post.body);assert.equal(init.body.get('url'),'https://media.example/current.jpg');return json({id:'fb-photo',post_id:'fb-post'});}
  if(graph.pathname.endsWith('/media')){assert.equal(init.body.get('caption'),post.body);assert.equal(init.body.get('image_url'),'https://media.example/current.jpg');return json({id:'container'});}
  if(graph.pathname.endsWith('/container'))return json({status_code:'FINISHED'});
  if(graph.pathname.endsWith('/media_publish'))return json({id:'ig-post'});
  throw new Error('Unexpected endpoint');
};
try {
  const controller=new ContentController();const req={workspace:{id:wid,role:'Owner'},user:{id:randomUUID()}};
  for(active of ['linkedin','facebook','instagram','telegram']){
    const result=await controller.publishContent(req,contentId,{socialAccountId:accounts[active].id});
    assert.equal(result.success,true);assert.ok(result.providerPostId);assert.ok(published.has(active));
    console.log(active+': image + caption API payload and confirmed post ID passed (mocked).');
  }
  active='youtube';const before=calls.length;
  assert.equal((await controller.publishContent(req,contentId,{socialAccountId:accounts.youtube.id})).status,'skipped');
  assert.equal(calls.length,before);
  console.log('youtube: image skipped without upload API call.');
  active='telegram';rejectTelegram=true;published.delete(active);
  await assert.rejects(controller.publishContent(req,contentId,{socialAccountId:accounts.telegram.id}),/Publishing failed/);
  assert.ok(!published.has('telegram'));
  active='instagram';assert.equal((await controller.publishContent(req,contentId,{socialAccountId:accounts.instagram.id})).success,true);
  const failedFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(null,{status:404});
  const failed=await new TelegramProvider().publishText({botToken:'credential-test',chatId:'-100123'},{destination:'-100123',text:'caption',mediaUrl:'https://missing.example/photo.jpg'});
  assert.equal(failed.success,false);
  let attempts=0;
  globalThis.fetch=async(url)=>{attempts++;if(String(url).includes('media.example'))return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}});return json({ok:true,result:{date:1700000000}});};
  const missingId=await new TelegramProvider().publishText({botToken:'credential-test',chatId:'-100123'},{destination:'-100123',text:'caption',mediaUrl:'https://media.example/current.jpg'});
  assert.equal(missingId.success,false);
  assert.ok(attempts<=2);
  globalThis.fetch=failedFetch;
  const unavailable={query:async()=>({rows:[]})};
  await assert.rejects(createPublishPlan(unavailable,post,'Telegram'),/missing or incomplete/);
  asset.mime_type='image/png';
  const pngPlan=await createPublishPlan({query},post,'Instagram');
  assert.equal(pngPlan.mimeType,'image/jpeg');
  assert.equal(new URL(pngPlan.mediaUrl).searchParams.get('format'),'jpeg');
  const png=execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=32x32','-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1']);
  const oldRead=LocalStorageProvider.prototype.read;
  try {
    LocalStorageProvider.prototype.read=async()=>Readable.from([png]);
    const chunks=[],headers={};
    const output=new Writable({write(chunk,encoding,callback){chunks.push(chunk);callback();}});
    output.setHeader=(name,value)=>{headers[name]=value;};
    const complete=new Promise((resolve,reject)=>{output.on('finish',resolve);output.on('error',reject);output.on('close',()=>{if(!output.writableFinished)reject(new Error('Conversion stream closed prematurely'));});});
    await new SocialController().metaMediaDownload(metaMediaTicket(wid,assetId),output,'jpeg');
    await complete;
    assert.equal(headers['Content-Type'],'image/jpeg');
    assert.equal(Buffer.concat(chunks).subarray(0,2).toString('hex'),'ffd8');
  } finally {LocalStorageProvider.prototype.read=oldRead;}
  console.log('Independent failures, missing attachments, no text fallback, missing API IDs, PNG-to-JPEG stream conversion and unchanged source asset passed. No real posts sent.');
} finally {
  globalThis.fetch=old.fetch;pool.connect=old.connect;pool.query=old.query;LocalStorageProvider.prototype.getSignedDownloadUrl=old.download;
  envKeys.forEach((key,i)=>{if(oldEnv[i]===undefined)delete process.env[key];else process.env[key]=oldEnv[i];});
  await pool.end();
}
