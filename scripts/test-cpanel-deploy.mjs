import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
const temp=await mkdtemp(join(tmpdir(),'contentos-deploy-bootstrap-'));
const source=await readFile(new URL('../deploy/cpanel-deploy.sh',import.meta.url),'utf8');
const quote=v=>`'${v.replaceAll("'","'\\''")}'`;
const absent=async p=>{try{await access(p);return false;}catch{return true;}};
try {
  await exec(bash,['-n',fileURLToPath(new URL('../deploy/cpanel-deploy.sh',import.meta.url))],{windowsHide:true});
  const posix=(await exec(bash,['-c','cd "$1" && pwd -P','_',temp],{windowsHide:true})).stdout.trim();
  const app=join(temp,'app'),front=join(temp,'front'),repo=join(temp,'repo'),bin=join(temp,'bin'),envdir=join(temp,'env');
  for(const p of [app,front,repo,bin,join(envdir,'lib','node_modules'),join(envdir,'bin'),join(app,'uploads'),join(app,'deploy'),join(front,'uploads')])await mkdir(p,{recursive:true});
  await writeFile(join(app,'app.mjs'),'OLD APPLICATION');await writeFile(join(app,'.env'),'PRODUCTION CONFIG PRESERVED');
  await writeFile(join(app,'uploads','keep.txt'),'UPLOAD PRESERVED');await writeFile(join(app,'dump.rdb'),'DATA PRESERVED');
  await writeFile(join(app,'deploy','cpanel-deploy.sh'),'#!/bin/bash\necho STALE_SCRIPT_EXECUTED\nexit 77\n');
  await writeFile(join(front,'index.html'),'OLD FRONTEND');await writeFile(join(front,'.env'),'FRONT CONFIG PRESERVED');
  await writeFile(join(front,'uploads','keep.txt'),'FRONT UPLOAD PRESERVED');
  await writeFile(join(envdir,'lib','node_modules','marker'),'OLD DEPENDENCIES');
  await writeFile(join(envdir,'bin','activate'),`export PATH=${quote(posix+'/bin')}:$PATH\nexport DEPLOY_TEST_COMMANDS=${quote(posix+'/commands.txt')}\n`);
  await writeFile(join(bin,'npm'),`#!/bin/bash
printf 'npm %s\\n' "$*" >> "$DEPLOY_TEST_COMMANDS"
if [[ "$1" == ci ]]; then mkdir -p node_modules; echo NEW_DEPENDENCIES > node_modules/marker; fi
if [[ "$1" == ls ]]; then test -f node_modules/marker; fi
`);
  await writeFile(join(bin,'node'),`#!/bin/bash
printf 'node %s\\n' "$*" >> "$DEPLOY_TEST_COMMANDS"
if [[ "$1" == --version ]]; then echo v22.23.3; fi
if [[ "$1" == scripts/build.mjs ]]; then
  if [[ "\${FAIL_BUILD:-}" == 1 ]]; then exit 23; fi
  mkdir -p dist/assets dist/uploads dist-api
  echo NEW_FRONTEND > dist/index.html
  echo NEW_ASSET > dist/assets/index-test.js
  echo UNSAFE > dist/.env
  echo UNSAFE > dist/uploads/keep.txt
  touch dist-api/phase-main.js dist-api/cron-worker.js
fi
if [[ "$1" == scripts/verify-ffmpeg.mjs && "\${FAIL_FINAL:-}" == 1 && "$PWD" == ${quote(posix+'/app')} ]]; then exit 19; fi
`);
  await exec(bash,['-c','chmod +x "$1"/bin/*','_',posix],{windowsHide:true});
  await symlink(await realpath(join(envdir,'lib','node_modules')),join(app,'node_modules'),process.platform==='win32'?'junction':'dir');
  const fixture=source.replace('REPO_TARGET=/home/hindust1/repositories/ContentOS-',`REPO_TARGET=${quote(posix+'/repo')}`)
    .replace('APP_TARGET=/home/hindust1/api.hidustansocialnetwork.in',`APP_TARGET=${quote(posix+'/app')}`)
    .replace('FRONTEND_TARGET=/home/hindust1/public_html',`FRONTEND_TARGET=${quote(posix+'/front')}`)
    .replace('ACTIVATE=/home/hindust1/nodevenv/api.hidustansocialnetwork.in/22/bin/activate',`ACTIVATE=${quote(posix+'/env/bin/activate')}`);
  for(const dir of ['server','src','public','scripts','deploy'])await mkdir(join(repo,dir));
  for(const [path,data]of [['app.mjs','LATEST COMMITTED APPLICATION'],['package.json','{}'],['package-lock.json','{}'],['tsconfig.json','{}'],['vite.config.ts','fixture'],['index.html','fixture'],['server/new.ts','latest source'],['src/new.ts','latest source'],['public/favicon.svg','fixture'],['scripts/build.mjs','fixture'],['scripts/verify-ffmpeg.mjs','fixture'],['deploy/cpanel-deploy.sh',fixture],['deploy/.env.production.example','IGNORED SAMPLE']])await writeFile(join(repo,path),data);
  const git=(...args)=>exec('git',['-C',repo,...args],{windowsHide:true});
  await git('init');await git('add','.');await git('-c','user.name=Fixture','-c','user.email=fixture@example.test','-c','commit.gpgsign=false','-c','core.hooksPath=disabled-hooks','commit','-m','fixture');
  const script=join(repo,'deploy','cpanel-deploy.sh');
  const run=(args=[],env={})=>exec(bash,[script,...args],{cwd:app,windowsHide:true,env:{...process.env,...env}});
  const preserved=async()=>{
    assert.equal(await readFile(join(app,'.env'),'utf8'),'PRODUCTION CONFIG PRESERVED');
    assert.equal(await readFile(join(app,'uploads','keep.txt'),'utf8'),'UPLOAD PRESERVED');
    assert.equal(await readFile(join(app,'dump.rdb'),'utf8'),'DATA PRESERVED');
    assert.equal(await readFile(join(front,'.env'),'utf8'),'FRONT CONFIG PRESERVED');
    assert.equal(await readFile(join(front,'uploads','keep.txt'),'utf8'),'FRONT UPLOAD PRESERVED');
    assert.ok(await absent(join(app,'tmp','restart.txt')));
  };
  await assert.rejects(run([],{FAIL_BUILD:'1'}));
  assert.equal(await readFile(join(app,'app.mjs'),'utf8'),'OLD APPLICATION');await preserved();
  const result=await run();assert.doesNotMatch(result.stdout,/STALE_SCRIPT_EXECUTED/);
  const backup=result.stdout.match(/\[DEPLOY\] Backup: (.+)/)[1].trim();
  assert.equal(await readFile(join(app,'app.mjs'),'utf8'),'LATEST COMMITTED APPLICATION');
  assert.equal((await readFile(join(envdir,'lib','node_modules','marker'),'utf8')).trim(),'NEW_DEPENDENCIES');
  assert.equal((await readFile(join(front,'index.html'),'utf8')).trim(),'NEW_FRONTEND');
  assert.equal((await readFile(join(app,'dist','index.html'),'utf8')).trim(),'NEW_FRONTEND');await preserved();
  assert.equal(await readFile(join(app,basename(backup),'node_modules','marker'),'utf8'),'OLD DEPENDENCIES');
  await run(['--rollback',backup]);assert.equal(await readFile(join(app,'app.mjs'),'utf8'),'OLD APPLICATION');
  assert.equal(await readFile(join(front,'index.html'),'utf8'),'OLD FRONTEND');
  assert.equal(await readFile(join(envdir,'lib','node_modules','marker'),'utf8'),'OLD DEPENDENCIES');await preserved();
  await assert.rejects(run([],{FAIL_FINAL:'1'}));
  assert.equal(await readFile(join(app,'app.mjs'),'utf8'),'OLD APPLICATION');
  assert.equal(await readFile(join(envdir,'lib','node_modules','marker'),'utf8'),'OLD DEPENDENCIES');await preserved();
  const commands=await readFile(join(temp,'commands.txt'),'utf8');
  assert.match(commands,/npm ci --include=dev --ignore-scripts/);assert.match(commands,/npm prune --omit=dev --ignore-scripts/);
  assert.match(commands,/npm rebuild ffmpeg-static --ignore-scripts=false/);assert.match(commands,/npm ls --omit=dev --depth=0/);
  assert.doesNotMatch(commands,/migrate|reconcile|start:worker|start:mail|cron-worker/);
  const yml=await readFile(new URL('../.cpanel.yml',import.meta.url),'utf8');assert.match(yml,/repositories\/ContentOS-\/deploy\/cpanel-deploy.sh/);assert.doesNotMatch(yml,/--restart/);
  console.log('PASS: latest committed repository script/source; staged build failure isolation; dependency/symlink preservation; manual rollback; automatic promotion rollback; protected data; no restart or cutover.');
} finally {assert.ok(temp.startsWith(tmpdir()));await rm(temp,{recursive:true,force:true});}
