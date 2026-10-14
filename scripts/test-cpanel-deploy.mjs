import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec=promisify(execFile);
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
const temp=await mkdtemp(join(tmpdir(),'contentos-deploy-review-'));
const source=await readFile(new URL('../deploy/cpanel-deploy.sh',import.meta.url),'utf8');
const quote=value=>`'${value.replaceAll("'","'\\''")}'`;
try {
  await exec(bash,['-n',new URL('../deploy/cpanel-deploy.sh',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],{windowsHide:true});
  const posix=(await exec(bash,['-c','cd "$1" && pwd -P','_',temp],{windowsHide:true})).stdout.trim();
  const app=join(temp,'app'),front=join(temp,'front'),bin=join(temp,'bin'),envdir=join(temp,'env');
  for(const path of [app,front,bin,join(envdir,'lib','node_modules'),join(envdir,'bin'),join(app,'uploads'),join(front,'uploads')])await mkdir(path,{recursive:true});
  for(const [path,content]of [['package.json','{}'],['app.mjs',''],['.env','fixture-config-preserve'],['uploads/keep.txt','application-upload-preserve']])await writeFile(join(app,path),content);
  await writeFile(join(front,'.env'),'frontend-config-preserve');await writeFile(join(front,'uploads','keep.txt'),'frontend-upload-preserve');
  const commandLog=join(temp,'commands.txt');
  await writeFile(join(envdir,'bin','activate'),`export PATH=${quote(posix+'/bin')}:$PATH\nexport DEPLOY_TEST_COMMANDS=${quote(posix+'/commands.txt')}\n`);
  await writeFile(join(bin,'npm'),`#!/bin/bash\nprintf 'npm %s\\n' "$*" >> "$DEPLOY_TEST_COMMANDS"\n`);
  await writeFile(join(bin,'node'),`#!/bin/bash
printf 'node %s\\n' "$*" >> "$DEPLOY_TEST_COMMANDS"
if [[ "$1" == --version ]]; then echo v22.23.3; fi
if [[ "$1" == scripts/build.mjs ]]; then
  mkdir -p dist/assets dist/uploads dist-api
  echo generated > dist/index.html
  echo generated > dist/assets/index-test.js
  echo unsafe > dist/.env
  echo unsafe > dist/uploads/keep.txt
  touch dist-api/phase-main.js dist-api/cron-worker.js
fi
`);
  await exec(bash,['-c','chmod +x "$1"/bin/*','_',posix],{windowsHide:true});
  await symlink(await realpath(join(envdir,'lib','node_modules')),join(app,'node_modules'),process.platform==='win32'?'junction':'dir');
  const fixture=source.replace('APP_TARGET=/home/hindust1/api.hidustansocialnetwork.in',`APP_TARGET=${quote(posix+'/app')}`)
    .replace('FRONTEND_TARGET=/home/hindust1/public_html',`FRONTEND_TARGET=${quote(posix+'/front')}`)
    .replace('ACTIVATE=/home/hindust1/nodevenv/api.hidustansocialnetwork.in/22/bin/activate',`ACTIVATE=${quote(posix+'/env/bin/activate')}`);
  const script=join(temp,'deploy.sh');await writeFile(script,fixture);
  await exec(bash,[script,'--restart'],{windowsHide:true});
  assert.equal(await readFile(join(app,'.env'),'utf8'),'fixture-config-preserve');
  assert.equal(await readFile(join(app,'uploads','keep.txt'),'utf8'),'application-upload-preserve');
  assert.equal(await readFile(join(front,'.env'),'utf8'),'frontend-config-preserve');
  assert.equal(await readFile(join(front,'uploads','keep.txt'),'utf8'),'frontend-upload-preserve');
  assert.equal((await readFile(join(front,'index.html'),'utf8')).trim(),'generated');
  await readFile(join(app,'tmp','restart.txt'));
  const commands=await readFile(commandLog,'utf8');
  assert.match(commands,/npm install --include=dev --ignore-scripts/);
  assert.match(commands,/npm prune --omit=dev --ignore-scripts/);
  assert.match(commands,/npm rebuild ffmpeg-static --ignore-scripts=false/);
  assert.match(commands,/node scripts\/verify-ffmpeg.mjs/);
  assert.doesNotMatch(commands,/migrate|reconcile|cron-worker|start:worker|start:mail/);
  console.log('Deployment syntax, CloudLinux activation, command order and data preservation: PASS');
} finally {
  assert.ok(temp.startsWith(tmpdir()));await rm(temp,{recursive:true,force:true});
}
