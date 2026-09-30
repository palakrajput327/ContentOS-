import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));

// Build Backend API (server/tsconfig.json)
const r1 = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'server/tsconfig.json'], { cwd, stdio: 'inherit', windowsHide: true });
if (r1.status !== 0) process.exit(r1.status || 1);

// Build Frontend Vite bundle (clean NODE_ENV for Tailwind CSS v4 plugin)
const env = { ...process.env };
delete env.NODE_ENV;
const r2 = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd, env, stdio: 'inherit', windowsHide: true });
if (r2.status !== 0) process.exit(r2.status || 1);
