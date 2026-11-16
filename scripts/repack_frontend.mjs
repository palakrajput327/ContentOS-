import fs from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';

const sourceDir = path.resolve('dist');
const entries = {};

function walk(current) {
  for (const item of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, item.name);
    const rel = path.relative(sourceDir, full).split(path.sep).join('/');
    if (item.isDirectory()) {
      walk(full);
    } else if (item.isFile()) {
      entries[rel] = fs.readFileSync(full);
    }
  }
}

walk(sourceDir);
const zipped = zipSync(entries, { level: 6 });
fs.writeFileSync('frontend-deploy.zip', zipped);

console.log('Successfully repacked frontend-deploy.zip! Size:', zipped.length, 'bytes, Total files:', Object.keys(entries).length);

