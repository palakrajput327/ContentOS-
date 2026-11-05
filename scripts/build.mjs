import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const cwd = fileURLToPath(new URL('../', import.meta.url));

// Precompiled-only deployment is explicit; normal builds always verify fresh source.
if (process.env.SKIP_BUILD === '1') {
  if (!fs.existsSync('dist-api/phase-main.js') || !fs.existsSync('dist/index.html')) throw Error('Missing precompiled artifacts');
  console.log('[ContentOS] Explicit precompiled-only deployment; source compilation was not verified.');
  process.exit(0);
}

// 2. Otherwise compile Backend API
let tscPath = null;
try {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  tscPath = req.resolve('typescript/lib/tsc.js');
} catch {
  const possiblePaths = [
    'node_modules/typescript/lib/tsc.js',
    'node_modules/typescript/bin/tsc',
    'node_modules/.bin/tsc',
  ];
  tscPath = possiblePaths.find((p) => fs.existsSync(p));
}

if (!tscPath) {
  console.log('[ContentOS] Running tsc via npx...');
  const r0 = spawnSync('npx', ['tsc', '-p', 'server/tsconfig.json'], { cwd, stdio: 'inherit', shell: true });
  if (r0.status !== 0) process.exit(r0.status || 1);
} else {
  console.log('[ContentOS] Compiling backend API with:', tscPath);
  const r1 = spawnSync(process.execPath, [tscPath, '-p', 'server/tsconfig.json'], { cwd, stdio: 'inherit' });
  if (r1.status !== 0) process.exit(r1.status || 1);
}

// Copy server static assets (fonts, templates) and migrations into dist-api
if (fs.existsSync('server/assets')) {
  fs.cpSync('server/assets', 'dist-api/assets', { recursive: true });
}
if (fs.existsSync('server/migrations')) {
  fs.cpSync('server/migrations', 'dist-api/migrations', { recursive: true });
}

// 3. Skip frontend in cloud (Frontend deploys separately to Vercel)
if (process.env.RENDER || process.env.SKIP_FRONTEND_BUILD === 'true') {
  console.log('[ContentOS] Skipping frontend build in backend cloud environment (Render).');
  process.exit(0);
}

let vitePath = null;
try {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  vitePath = req.resolve('vite/bin/vite.js');
} catch {
  const possiblePaths = ['node_modules/vite/bin/vite.js', 'node_modules/.bin/vite'];
  vitePath = possiblePaths.find((p) => fs.existsSync(p));
}

if (vitePath && fs.existsSync(vitePath)) {
  const env = { ...process.env };
  if (!env.VITE_API_BASE) env.VITE_API_BASE = 'https://api.hidustansocialnetwork.in';
  delete env.NODE_ENV;
  const r2 = spawnSync(process.execPath, [vitePath, 'build'], { cwd, env, stdio: 'inherit' });
  if (r2.status !== 0) process.exit(r2.status || 1);
}
