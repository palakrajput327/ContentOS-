import fs from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';

const rootDir = path.resolve('.');
const outputFile = path.join(rootDir, 'contentos-full-project.zip');
const aliasFile = path.join(rootDir, 'project-combined.zip');

// Directories to include in the full project archive
const INCLUDED_DIRS = [
  'src',
  'server',
  'public',
  'scripts',
  'docs',
  'dist',
  'dist-api',
  'deploy',
  'tests',
];

// Root files to include in the project archive
const INCLUDED_ROOT_FILES = [
  'backend-deploy.zip',
  'frontend-deploy.zip',
  '.env',
  'env-cpanel-production.env',
  '.env.example',
  'package.json',
  'package-lock.json',
  'app.mjs',
  'database_full_setup.sql',
  'vite.config.ts',
  'tsconfig.json',
  'index.html',
  'ARCHITECTURE.md',
  'AGENTS.md',
  'FEATURE_REGISTRY.md',
  'API_CONTRACTS.md',
];

const entries = {};
let totalUncompressedBytes = 0;
let fileCount = 0;

function addFile(filePath, zipPath) {
  try {
    const data = fs.readFileSync(filePath);
    entries[zipPath.split(path.sep).join('/')] = data;
    totalUncompressedBytes += data.length;
    fileCount++;
  } catch (err) {
    console.warn(`[Skip] Could not read ${filePath}:`, err.message);
  }
}

function walkDir(dirPath, baseDir) {
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const item of items) {
    const full = path.join(dirPath, item.name);
    const rel = path.relative(baseDir, full);
    if (item.isDirectory()) {
      walkDir(full, baseDir);
    } else if (item.isFile()) {
      addFile(full, rel);
    }
  }
}

console.log('[Packaging] Adding root files (including backend-deploy.zip and frontend-deploy.zip)...');
for (const file of INCLUDED_ROOT_FILES) {
  const fullPath = path.join(rootDir, file);
  if (fs.existsSync(fullPath)) {
    addFile(fullPath, file);
  } else {
    console.warn(`[Warning] Root file not found: ${file}`);
  }
}

console.log('[Packaging] Scanning core directories (src, server, dist, dist-api, public, scripts, docs, deploy, tests)...');
for (const dir of INCLUDED_DIRS) {
  const fullDir = path.join(rootDir, dir);
  if (fs.existsSync(fullDir)) {
    walkDir(fullDir, rootDir);
  }
}

// Verify that required deployment zips are present
if (!entries['backend-deploy.zip'] || !entries['frontend-deploy.zip']) {
  console.error('[Error] Required deploy zips missing!');
  process.exit(1);
}

console.log(`[Packaging] Compressing ${fileCount} files (${(totalUncompressedBytes / (1024 * 1024)).toFixed(2)} MB)...`);
const startTime = Date.now();

const zipped = zipSync(entries, { level: 6 });
fs.writeFileSync(outputFile, zipped);
fs.copyFileSync(outputFile, aliasFile);

const durationMs = Date.now() - startTime;
console.log(`[Success] Combined project zip created in ${(durationMs / 1000).toFixed(2)}s!`);
console.log(`- Output File: ${outputFile} (${(zipped.length / (1024 * 1024)).toFixed(2)} MB, ${zipped.length} bytes)`);
console.log(`- Alias File:  ${aliasFile}`);
console.log(`- Total Files Contained: ${fileCount}`);
