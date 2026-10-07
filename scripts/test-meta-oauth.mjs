import assert from 'node:assert/strict';
import { metaPages, META_SCOPES } from '../dist-api/meta.api.js';
import { socialRedirectUri } from '../dist-api/social.oauth.js';
import { FacebookProvider, InstagramProvider } from '../dist-api/social.provider.js';
const originalFetch=globalThis.fetch;
const uri=process.env.FACEBOOK_REDIRECT_URI;
try {
 process.env.FACEBOOK_REDIRECT_URI='https://hindustandigitalworkshop.info/api/v1/social/facebook/callback';
 assert.equal(socialRedirectUri('facebook'),process.env.FACEBOOK_REDIRECT_URI);
 assert.equal(META_SCOPES.split(',').length,5);
 const calls=[];let responses=[];
 globalThis.fetch=async(url,options)=>{calls.push({url:String(url),options});return {ok:true,json:async()=>responses.shift()};};
 responses=[{data:[{id:'1',name:'Page',instagram_business_account:{id:'2'}}],paging:{next:'next',cursors:{after:'cursor'}}},{data:[{id:'3'}]}];
 assert.equal((await metaPages('secret')).length,2);
 assert.match(calls[1].url,/after=cursor/);
 assert.ok(!calls[0].url.includes('secret'));
 responses=[{data:[]}];await assert.rejects(metaPages('secret'),/No managed Facebook Page/);
 responses=[{id:'2',username:'business'}];
 const ig=new InstagramProvider();
 assert.equal((await ig.validateConnection({token:'secret',destination:'2'})).providerId,'2');
 assert.match(calls.at(-1).url,/\/2\?/);
 assert.equal((await ig.publishText({token:'secret'},{destination:'2',text:'hello'})).success,false);
 responses=[{id:'container'},{id:'published'}];
 assert.equal((await ig.publishText({token:'secret'},{destination:'2',text:'caption',mediaUrl:'https://example.com/image.jpg'})).providerPostId,'published');
 assert.equal(calls.at(-2).options.body.get('caption'),'caption');
 responses=[{id:'post'}];assert.equal((await new FacebookProvider().publishText({token:'secret'},{destination:'1',text:'hello'})).providerPostId,'post');
 console.log('Meta scopes, redirect, pagination, diagnostics, account validation and publishing checks passed.');
} finally {globalThis.fetch=originalFetch;if(uri===undefined)delete process.env.FACEBOOK_REDIRECT_URI;else process.env.FACEBOOK_REDIRECT_URI=uri;}
