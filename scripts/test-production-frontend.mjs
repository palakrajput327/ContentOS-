import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { API_BASE, releaseEnvironment } from './release-contract.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'contentos-production-auth-'));
const run = (name, env) => spawnSync(process.execPath, [
  'node_modules/vite/bin/vite.js', 'build', '--outDir', join(temp, name), '--emptyOutDir',
], { cwd: root, env: { ...env, NODE_ENV: '' }, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
const bundle = async name => {
  const dir = join(temp, name, 'assets');
  return (await Promise.all((await readdir(dir)).filter(file => file.endsWith('.js')).map(file => readFile(join(dir, file), 'utf8')))).join('\n');
};
try {
  // A hostile caller/local .env cannot turn the release into a preview build.
  const env = releaseEnvironment({ ...process.env, VITE_API_ENABLED: 'false', VITE_API_BASE: 'https://wrong.example.test' });
  assert.equal(env.VITE_API_ENABLED, 'true');
  assert.equal(env.VITE_API_BASE, API_BASE);
  const positive = run('production', env);
  assert.equal(positive.status, 0, positive.stdout + positive.stderr);
  assert.match(positive.stdout + positive.stderr, /Verified compiled production authentication: apiEnabled=true/);
  const output = await bundle('production');
  assert.ok(output.includes(API_BASE), 'Generated frontend must use the production API');
  assert.ok(output.includes('auth-form'), 'Generated frontend must contain authentication UI');

  const disabled = run('disabled-release', { ...env, VITE_API_ENABLED: 'false' });
  assert.notEqual(disabled.status, 0);
  assert.match(disabled.stdout + disabled.stderr, /Release frontend requires/);
  const wrongBase = run('wrong-api', { ...env, VITE_API_BASE: 'https://wrong.example.test' });
  assert.notEqual(wrongBase.status, 0);
  assert.match(wrongBase.stdout + wrongBase.stderr, /Release frontend requires/);

  console.log('PASS: actual generated frontend authentication module is enabled and authentication UI/production API are present despite false caller flags; disabled-auth/wrong-API releases fail closed.');
} finally {
  await rm(temp, { recursive: true, force: true });
}
