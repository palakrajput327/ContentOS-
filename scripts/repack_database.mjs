import fs from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';

const entries = {};

// 1. Add database_full_setup.sql
if (fs.existsSync('database_full_setup.sql')) {
  entries['database_full_setup.sql'] = fs.readFileSync('database_full_setup.sql');
}

// 2. Add README-DATABASE.txt
if (fs.existsSync('README-DATABASE.txt')) {
  entries['README-DATABASE.txt'] = fs.readFileSync('README-DATABASE.txt');
}

// 3. Add all migrations
const migrationsDir = path.resolve('server/migrations');
if (fs.existsSync(migrationsDir)) {
  for (const file of fs.readdirSync(migrationsDir)) {
    if (file.endsWith('.sql')) {
      entries[`migrations/${file}`] = fs.readFileSync(path.join(migrationsDir, file));
    }
  }
}

const zipped = zipSync(entries, { level: 6 });
fs.writeFileSync('database-package.zip', zipped);

console.log('Successfully created database-package.zip! Size:', zipped.length, 'bytes, Total files:', Object.keys(entries).length);

