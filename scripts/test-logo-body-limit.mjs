import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { jsonBodyParsers } from '../dist-api/http-body.js';
import { once } from 'node:events';
test('logo uploads accept base64 up to 5MB while other JSON endpoints retain small limits',async()=>{
 const app=express();app.use(jsonBodyParsers());app.post(/.*/, (req,res)=>res.json({received:!!req.body.dataUrl}));app.use((error,req,res,next)=>res.status(error.status||500).end());
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=(path,data)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 try {
  const data={dataUrl:'data:image/png;base64,'+Buffer.alloc(5*1024*1024).toString('base64')};
  assert.equal((await post('/api/v1/documents/test/brand-identity/upload-logo',data)).status,200);
  assert.equal((await post('/api/v1/documents/test/brand-identity', {dataUrl:'x'.repeat(20000)})).status,413);
  assert.equal((await post('/api/v1/documents/test/brand-identity/upload-logo',{dataUrl:'x'.repeat(8*1024*1024)})).status,413);
 }finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
