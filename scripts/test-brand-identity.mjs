import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { BrandIdentityService } from '../dist-api/documents/brand-identity.service.js';
import { groupKnowledge } from '../dist-api/knowledge/automation.service.js';
const service = new BrandIdentityService();
const brand = {workspaceId:'w',documentId:'a',companyName:'TradeOrbit',logoAssetId:'logo',logoUrl:'managed',websiteDomain:'www.tradeorbit.live',brandColors:['#ff0000'],applyToAllPosters:true,logoPosition:'top-left',domainPosition:'bottom-center',logoSize:'medium',safeMargin:32,status:'CONFIRMED'};
test('approval required for every enabled PDF identity', () => {
  assert.throws(()=>service.requireApprovedBrand({...brand,status:'PENDING_REVIEW'}));
  assert.throws(()=>service.requireApprovedBrand({...brand,websiteDomain:''}));
  assert.doesNotThrow(()=>service.requireApprovedBrand(brand));
  assert.doesNotThrow(()=>service.requireApprovedBrand({...brand,status:'PENDING_REVIEW',applyToAllPosters:false}));
});
test('identical knowledge from different companies stays separate',()=>{
 const row={knowledge_type:'FACT',value:'Same fact',status:'CONFIRMED',source_excerpt:'Evidence',knowledge_key:'Fact'};
 assert.equal(groupKnowledge([{...row,id:'1',document_id:'tradeorbit'},{...row,id:'2',document_id:'redhash'}]).length,2);
});
test('original logo pixels are composited and colors detected',async()=>{
 const bg=createCanvas(1024,1024);const ctx=bg.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,1024,1024);
 const logo=createCanvas(100,100);logo.getContext('2d').fillStyle='#ff0000';logo.getContext('2d').fillRect(0,0,100,100);
 const logoBuffer=logo.toBuffer('image/png');
 const local=new BrandIdentityService();local.readAsset=async()=>logoBuffer;
 assert.deepEqual(await local.detectColors(logoBuffer),['#ff0000']);
 const output=await local.composeBrandOverlay({backgroundBuffer:bg.toBuffer('image/png'),brand});
 const canvas=createCanvas(1024,1024);canvas.getContext('2d').drawImage(await loadImage(output),0,0);
 assert.deepEqual([...canvas.getContext('2d').getImageData(80,80,1,1).data],[255,0,0,255]);
 local.readAsset=async()=>{throw new Error('Missing logo')};
 await assert.rejects(local.composeBrandOverlay({backgroundBuffer:bg.toBuffer('image/png'),brand}),/could not be composited/);
});
import { pool } from '../dist-api/db.js';
test('multiple websites stay pending and no company domain is invented',async()=>{
 const original=pool.query;
 try {
  for (const text of ['Visit https://tradeorbit.live and https://redhash.com', 'Contact sales@example.com']) {
   let inserted;
   pool.query=async(sql,args)=>{
    if(sql.startsWith('SELECT id FROM documents')) return {rowCount:1,rows:[{id:'pdf'}]};
    if(sql.includes('SELECT * FROM document_brand_identities')) return {rowCount:0,rows:[]};
    if(sql.includes('SELECT original_filename')) return {rows:[{original_filename:'TradeOrbit.pdf'}]};
    if(sql.includes('SELECT clean_text')) return {rows:[{clean_text:text}]};
    if(sql.includes('FROM document_source_media')) return {rowCount:0,rows:[]};
    if(sql.includes('INSERT INTO document_brand_identities')) {inserted=args;return {rows:[{document_id:'pdf',workspace_id:'w',website_domain:args[5],brand_colors:args[6],status:args[7]}]};}
    throw new Error('Unexpected query');
   };
   const result=await service.getOrCreateBrandIdentity('pdf','w');
   assert.equal(result.websiteDomain,'');assert.equal(result.status,'PENDING_REVIEW');assert.deepEqual(JSON.parse(inserted[6]),[]);
  }
 } finally {pool.query=original;}
});
test('optional branding returns original media and warns when unconfirmed or unavailable',async()=>{
 const local=new BrandIdentityService();let warnings=0;
 local.warnOptionalBrand=async()=>{warnings++};
 const opts={documentId:'pdf',workspaceId:'workspace',userId:'user',assetId:'original',url:'original-url'};
 for(const status of ['DETECTED','PENDING_REVIEW']) {
  local.getOrCreateBrandIdentity=async()=>({...brand,status});
  assert.deepEqual(await local.brandGeneratedImage(opts),{assetId:'original',url:'original-url'});
 }
 local.getOrCreateBrandIdentity=async()=>{throw new Error('Brand storage unavailable')};
 assert.deepEqual(await local.brandGeneratedImage(opts),{assetId:'original',url:'original-url'});
 assert.equal(warnings,3);
});
