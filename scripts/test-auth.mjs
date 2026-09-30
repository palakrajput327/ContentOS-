import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
process.loadEnvFile(root+'.env');
// Dedicated API process, real local PostgreSQL/Redis, no mail worker or external email.
const env={...process.env,PORT:'3002',APP_ENV:'test',MAIL_USERNAME:'test@example.test',MAIL_PASSWORD:'test-only-not-a-secret',TOKEN_ENCRYPTION_KEY:process.env.ENCRYPTION_KEY};
const api=spawn(process.execPath,['dist-api/phase-main.js'],{cwd:root,env,stdio:'ignore',windowsHide:true});
try{
 let ready=false;for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:3002/api/v1/health/ready')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,200));}
 if(!ready)throw new Error('Test API failed to start');
 const code=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['--experimental-strip-types','--test','tests/auth.test.ts'],{cwd:root,env,stdio:'inherit',windowsHide:true});p.on('exit',resolve);p.on('error',reject)});process.exitCode=code??1;
}finally{api.kill();}
