import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const policy = await readFile(join(root, '.npmrc'), 'utf8');
const installHooks = ['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare'];
for (const name of installHooks) assert.equal(manifest.scripts[name], undefined, `Install-time hook ${name} must not run application builds`);
for (const name of ['typescript', 'vite']) assert.equal(manifest.dependencies[name], undefined, `${name} must stay out of production dependencies`);
assert.match(policy, /^ignore-scripts=true$/m);

// npm run supplies npm_execpath. The fallback supports direct invocation with
// the bundled official Node distribution on Windows and standard Unix layouts.
let npmCli = process.env.npm_execpath;
if (!npmCli) {
  for (const candidate of [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')]) {
    try { await access(candidate); npmCli = candidate; break; } catch {}
  }
}
assert.ok(npmCli, 'Run this test with npm run test:deploy or a Node distribution containing npm');
const temp = await mkdtemp(join(tmpdir(), 'contentos-npm-policy-'));
const exists = async path => access(path).then(() => true, () => false);
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^npm_config_(ignore_scripts|userconfig|globalconfig)$/i.test(key)) delete env[key];
}
const run = (cwd, args) => spawnSync(process.execPath, [npmCli, ...args], { cwd, env, encoding: 'utf8', windowsHide: true, timeout: 60000 });
const install = ['install', '--omit=dev', '--offline', '--package-lock=false', '--no-audit', '--no-fund'];
try {
  await writeFile(join(temp, 'empty.npmrc'), '');
  env.npm_config_userconfig = join(temp, 'empty.npmrc');
  env.npm_config_globalconfig = join(temp, 'global.npmrc');
  await writeFile(env.npm_config_globalconfig, '');
  async function fixture(name, scripts, guarded) {
    const dir = join(temp, name);
    await mkdir(dir);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `contentos-${name}`, version: '1.0.0', private: true, scripts }));
    await writeFile(join(dir, 'compiler.cjs'), 'require("node:fs").writeFileSync("compiler-invoked", "unexpected"); process.exit(127);');
    if (guarded) await writeFile(join(dir, '.npmrc'), policy);
    return dir;
  }
  const legacyScripts = { postinstall: 'npm run build:api', 'build:api': 'node compiler.cjs' };
  const legacy = await fixture('legacy', legacyScripts, false);
  const reproduced = run(legacy, [...install, '--ignore-scripts=false']);
  assert.notEqual(reproduced.status, 0, 'Legacy install must reproduce a compiler invocation failure');
  assert.ok(await exists(join(legacy, 'compiler-invoked')));
  assert.match(reproduced.stdout + reproduced.stderr, /npm run build:api/);

  const guarded = await fixture('guarded', legacyScripts, true);
  const prevented = run(guarded, install);
  assert.equal(prevented.status, 0, prevented.stdout + prevented.stderr);
  assert.ok(!await exists(join(guarded, 'compiler-invoked')));
  const effective = run(guarded, ['config', 'get', 'ignore-scripts']);
  assert.equal(effective.stdout.trim(), 'true');

  const current = await fixture('current', manifest.scripts, true);
  const clean = run(current, install);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.doesNotMatch(clean.stdout + clean.stderr, /tsc|vite build|npm run build:api/);

  // The explicit FFmpeg exception must still run its installer, without running
  // the application's legacy postinstall. No real binary/network is used here.
  const ffmpeg = join(guarded, 'node_modules', 'ffmpeg-static');
  await mkdir(ffmpeg, { recursive: true });
  await writeFile(join(ffmpeg, 'package.json'), JSON.stringify({ name: 'ffmpeg-static', version: '5.3.0', scripts: { install: 'node install.cjs' } }));
  await writeFile(join(ffmpeg, 'install.cjs'), 'require("node:fs").writeFileSync("ffmpeg-installed", "ok");');
  const rebuilt = run(guarded, ['rebuild', 'ffmpeg-static', '--ignore-scripts=false', '--offline', '--no-audit', '--no-fund']);
  assert.equal(rebuilt.status, 0, rebuilt.stdout + rebuilt.stderr);
  assert.ok(await exists(join(ffmpeg, 'ffmpeg-installed')));
  assert.ok(!await exists(join(guarded, 'compiler-invoked')));

  // ignore-scripts is not a blanket suppression of explicit CI build commands.
  const explicit = run(guarded, ['run', 'build:api']);
  assert.notEqual(explicit.status, 0);
  assert.ok(await exists(join(guarded, 'compiler-invoked')));
  console.log('PASS: legacy postinstall chain reproduced; ordinary production install runs no compiler; repository hooks absent; project ignore-scripts enforced; selective FFmpeg installer and explicit build commands still execute.');
} finally { await rm(temp, { recursive: true, force: true }); }
