import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cwd = fileURLToPath(new URL('../', import.meta.url));

// 1. Build Backend API
let tscPath = null;
try {
  tscPath = require.resolve('typescript/lib/tsc.js');
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

// 2. Build Frontend Vite bundle (skip if on Render or backend cloud environment)
if (process.env.RENDER || process.env.SKIP_FRONTEND_BUILD === 'true') {
  console.log('[ContentOS] Skipping frontend build in backend cloud environment (Render).');
  process.exit(0);
}

let vitePath = null;
try {
  vitePath = require.resolve('vite/bin/vite.js');
} catch {
  const possiblePaths = ['node_modules/vite/bin/vite.js', 'node_modules/.bin/vite'];
  vitePath = possiblePaths.find((p) => fs.existsSync(p));
}

if (vitePath && fs.existsSync(vitePath)) {
  const env = { ...process.env };
  delete env.NODE_ENV;
  const r2 = spawnSync(process.execPath, [vitePath, 'build'], { cwd, env, stdio: 'inherit' });
  if (r2.status !== 0) process.exit(r2.status || 1);
} else {
  console.log('[ContentOS] Vite not found, skipping frontend build.');
}
