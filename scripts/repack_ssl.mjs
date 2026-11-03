import fs from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';

const baseDir = path.resolve('.runtime/cpanel-package-1793350339583/backend');
fs.cpSync('dist-api', path.join(baseDir, 'dist-api'), { recursive: true });
fs.cpSync('server', path.join(baseDir, 'server'), { recursive: true });
fs.cpSync('scripts', path.join(baseDir, 'scripts'), { recursive: true });
fs.copyFileSync('database_full_setup.sql', path.join(baseDir, 'database_full_setup.sql'));
if (fs.existsSync('env-cpanel-production.env')) {
  fs.copyFileSync('env-cpanel-production.env', path.join(baseDir, '.env.production.example'));
}

const entries = {};

function walk(current) {
  for (const item of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, item.name);
    const rel = path.relative(baseDir, full).split(path.sep).join('/');
    if (item.isDirectory()) {
      walk(full);
    } else if (item.isFile()) {
      entries[rel] = fs.readFileSync(full);
    }
  }
}

walk(baseDir);
const zipped = zipSync(entries, { level: 6 });
fs.writeFileSync('backend-deploy.zip', zipped);

console.log('backend-deploy.zip repacked successfully! Size:', zipped.length, 'bytes, Total files:', Object.keys(entries).length);
