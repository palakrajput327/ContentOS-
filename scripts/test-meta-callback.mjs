import 'reflect-metadata';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {SocialController} from '../dist-api/social.controller.js';
import {pool} from '../dist-api/db.js';
import {decryptToken} from '../dist-api/security.js';
import {META_SCOPES} from '../dist-api/meta.api.js';
const oldFetch=globalThis.fetch, oldQuery=pool.query;
const keys=['FACEBOOK_APP_ID','FACEBOOK_APP_SECRET','FACEBOOK_REDIRECT_URI','TOKEN_ENCRYPTION_KEY'];
const oldEnv=keys.map(key=>process.env[key]);
Object.assign(process.env,{FACEBOOK_APP_ID:'123',FACEBOOK_APP_SECRET:'test-app-secret',FACEBOOK_REDIRECT_URI:'http://localhost:3001/api/v1/social/facebook/callback',TOKEN_ENCRYPTION_KEY:'a'.repeat(64)});
const record={workspace_id:randomUUID(),user_id:randomUUID()};
const calls=[], writes=[];
let responses=[];
pool.query=async(sql,args)=>{if(sql.startsWith('INSERT INTO meta_oauth_pending'))writes.push(args);return{rowCount:1,rows:[]};};
globalThis.fetch=async(url,options)=>{calls.push({url:new URL(url),options});assert.ok(responses.length);return{ok:true,status:200,json:async()=>responses.shift()};};
let redirect;
const res={redirect(url){redirect=url;}};
try {
  responses=[{access_token:'short-user'},{access_token:'long-user'},{data:META_SCOPES.split(',').map(permission=>({permission,status:'granted'}))},{data:[]},{data:{is_valid:true,app_id:'123',type:'USER',scopes:META_SCOPES.split(','),granular_scopes:[{scope:'pages_show_list',target_ids:['456']}]}},{id:'456',access_token:'page-token',instagram_business_account:{id:'789'}}];
  await new SocialController().finishMetaOAuth('code','hash',record,res);
  assert.ok(new URL(redirect).searchParams.has('meta_pending'));
  assert.equal(calls[0].url.searchParams.get('redirect_uri'),process.env.FACEBOOK_REDIRECT_URI);
  assert.equal(calls[1].url.searchParams.get('fb_exchange_token'),'short-user');
  assert.equal(calls[2].options.headers.Authorization,'Bearer long-user');
  assert.equal(calls[3].options.headers.Authorization,'Bearer long-user');
  assert.equal(calls[5].options.headers.Authorization,'Bearer long-user');
  assert.equal(decryptToken(writes[0][3],record.workspace_id),'long-user');
  assert.ok(!redirect.includes('long-user')&&!redirect.includes('test-app-secret'));
  responses=[{}];writes.length=0;
  await new SocialController().finishMetaOAuth('code','hash',record,res);
  assert.match(new URL(redirect).searchParams.get('error'),/code exchange/);
  assert.equal(writes.length,0);
  console.log('Meta callback exchange, exact redirect URI, long-lived USER-token discovery, encrypted pending storage and missing-token rejection passed.');
} finally {
  globalThis.fetch=oldFetch;pool.query=oldQuery;
  keys.forEach((key,index)=>{if(oldEnv[index]===undefined)delete process.env[key];else process.env[key]=oldEnv[index];});
  await pool.end();
}
