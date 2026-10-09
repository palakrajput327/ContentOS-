import assert from 'node:assert/strict';
import { META_SCOPES, metaPages, metaPermissions, MetaGraphError } from '../dist-api/meta.api.js';
const originalFetch = globalThis.fetch;
const oldId = process.env.FACEBOOK_APP_ID;
const oldSecret = process.env.FACEBOOK_APP_SECRET;
process.env.FACEBOOK_APP_ID = '123';
process.env.FACEBOOK_APP_SECRET = 'app-secret-test';
const token = 'private-user-token-test';
let queue = [], calls = [];
const details = (overrides = {}) => ({ data: { is_valid: true, app_id: '123', type: 'USER', scopes: META_SCOPES.split(','), granular_scopes: [{scope:'pages_show_list', target_ids:['456']}], ...overrides } });
globalThis.fetch = async (url, options) => {
  calls.push({url:new URL(url), options});
  assert.ok(queue.length, 'unexpected Graph request');
  const item = queue.shift();
  if (item instanceof Error) throw item;
  return {ok: !item.error, status: item.error ? 400 : 200, json:async()=>item};
};
function setup(items) {queue = items; calls = [];}
try {
  setup([{data:[{id:'456', access_token:'page-token',tasks:['CREATE_CONTENT'],instagram_business_account:{id:'789'}}]}]);
  assert.equal((await metaPages(token))[0].instagram_business_account.id,'789');
  assert.equal(calls[0].url.pathname.split('/').slice(-2).join('/'),'me/accounts');
  assert.equal(calls[0].options.headers.Authorization,'Bearer '+token);
  assert.ok(!calls[0].url.search.includes(token));

  setup([{data:[]}, details(), {id:'456',name:'Page',access_token:'page-token',instagram_business_account:{id:'789',username:'business'}}]);
  assert.equal((await metaPages(token))[0].id,'456');
  assert.equal(calls[1].options.headers.Authorization,'Bearer 123|app-secret-test');
  assert.equal(calls[1].url.searchParams.get('input_token'),token);
  assert.equal(calls[2].options.headers.Authorization,'Bearer '+token);
  assert.ok(calls[2].url.searchParams.get('fields').includes('instagram_business_account'));

  setup([{data:[]}, details({granular_scopes:[{scope:'instagram_basic',target_ids:['789']}]})]);
  await assert.rejects(metaPages(token), /no selected Page IDs/);
  assert.equal(calls.length,2); // Never guess Page IDs from Instagram grants.
  for (const [override, pattern] of [
    [{is_valid:false},/invalid or expired/],
    [{app_id:'999'},/different app/],
    [{type:'PAGE'},/USER token/],
    [{scopes:['pages_show_list']},/missing permissions/],
  ]) {
    setup([{data:[]},details(override)]);
    await assert.rejects(metaPages(token),pattern);
    assert.equal(calls.length,2);
  }
  setup([{data:[]},details(),{id:'456'}]);
  await assert.rejects(metaPages(token),/Page access token/);

  setup([{error:{code:200,error_subcode:123,message:'unsafe '+token+' app-secret-test'}}]);
  await assert.rejects(metaPages(token), e => e instanceof MetaGraphError && e.code === 200 && e.subcode === 123 && e.message.includes('me/accounts') && !e.message.includes(token) && !e.message.includes('app-secret-test'));
  assert.equal(calls.length,1); // Do not turn Graph failures into empty lists.
  setup([new Error('fetch failed URL containing '+token)]);
  await assert.rejects(metaPages(token),e=>e.message.includes('connectivity') && !e.message.includes(token));
  setup([{}]); await assert.rejects(metaPages(token),/invalid Page list/);
  setup([{data:META_SCOPES.split(',').map(permission=>({permission,status:permission==='instagram_basic'?'declined':'granted'}))}]);
  await assert.rejects(metaPermissions(token),/instagram_basic/);
  console.log('Meta discovery checks passed: user-token authorization, selected-Page fallback, Instagram linkage, empty/malformed results, wrong/expired tokens, declined scopes, Graph errors and credential redaction.');
} finally {
  globalThis.fetch = originalFetch;
  if (oldId === undefined) delete process.env.FACEBOOK_APP_ID; else process.env.FACEBOOK_APP_ID = oldId;
  if (oldSecret === undefined) delete process.env.FACEBOOK_APP_SECRET; else process.env.FACEBOOK_APP_SECRET = oldSecret;
}
