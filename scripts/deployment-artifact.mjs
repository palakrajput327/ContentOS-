import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { API_BASE, committedLockfile, releaseEnvironment } from './release-contract.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const apiBase = API_BASE;
const hash = data => createHash('sha256').update(data).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
async function inventory(directory) {
  const files = {};
  async function walk(relative) {
    const path = join(directory, relative);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`Artifact symlink: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort()) {
        if (!/^[A-Za-z0-9_@.-]+$/.test(name) || name.startsWith('.env') || ['node_modules', 'uploads', '.git'].includes(name)) throw new Error(`Unsafe artifact path: ${name}`);
        await walk(`${relative}/${name}`);
      }
    } else if (stat.isFile()) files[relative] = hash(await readFile(path));
    else throw new Error(`Unsupported artifact file: ${relative}`);
  }
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Artifact root must not be a symlink');
  const entries = (await readdir(directory)).sort();
  if (entries.some(name => !['dist', 'dist-api', 'manifest.json'].includes(name))) throw new Error('Unexpected artifact entry');
  for (const dir of ['dist', 'dist-api']) await walk(dir);
  for (const file of ['dist/index.html', 'dist-api/phase-main.js', 'dist-api/cron-worker.js']) {
    if (!files[file]) throw new Error(`Missing required output: ${file}`);
  }
  return files;
}

const [mode, suppliedDirectory, expectedRevision] = process.argv.slice(2);
const directory = resolve(suppliedDirectory || join(root, '.deploy-artifact'));
if (mode === 'verify') {
  const manifestPath = join(directory, 'manifest.json');
  if (!(await lstat(manifestPath)).isFile() || (await lstat(manifestPath)).isSymbolicLink()) throw new Error('Invalid artifact manifest');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.version !== 2 || !/^[a-f0-9]{40}$/.test(expectedRevision || '') || manifest.revision !== expectedRevision || manifest.apiBase !== apiBase || manifest.apiEnabled !== true || manifest.nodeMajor !== 22) throw new Error('Artifact metadata does not match deployment');
  const lockfile = await readFile(join(root, 'package-lock.json'));
  if (lockfile.includes(13) || manifest.lockSha256 !== hash(lockfile)) throw new Error('Artifact lockfile mismatch; exact LF bytes required');
  const actual = await inventory(directory);
  const ordered = files => JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  if (!manifest.files || ordered(actual) !== ordered(manifest.files)) throw new Error('Artifact checksums/file inventory mismatch');
  console.log(`Verified prebuilt artifact for ${manifest.revision}`);
} else if (mode === 'build' && !suppliedDirectory) {
  if (process.versions.node.split('.')[0] !== '22') throw new Error('Build artifacts with Node.js 22');
  const revision = git('rev-parse', 'HEAD');
  // dist is tracked in this repository; generated output is deliberately excluded.
  const sourcePaths = ['.gitattributes', '.gitignore', '.cpanel.yml', 'app.mjs', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html', 'server', 'src', 'public', 'scripts', 'deploy'];
  if (git('status', '--porcelain', '--untracked-files=all', '--', ...sourcePaths)) throw new Error('Commit runtime source changes before building a release artifact');
  const lockfile = await committedLockfile(root, revision);
  await rm(directory, { recursive: true, force: true });
  await rm(join(root, 'dist-api'), { recursive: true, force: true });
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, stdio: 'inherit', windowsHide: true, env: releaseEnvironment() });
  if (result.status !== 0) throw new Error('Release build failed');
  if (git('rev-parse', 'HEAD') !== revision || git('status', '--porcelain', '--untracked-files=all', '--', ...sourcePaths)) throw new Error('Source changed during artifact build');
  await committedLockfile(root, revision);
  await mkdir(directory);
  for (const dir of ['dist', 'dist-api']) await cp(join(root, dir), join(directory, dir), { recursive: true, verbatimSymlinks: true });
  const files = await inventory(directory);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ version: 2, revision, nodeMajor: 22, apiBase, apiEnabled: true, lockSha256: hash(lockfile), files }, null, 2) + '\n');
  console.log(`Release artifact ready: ${directory}`);
} else throw new Error('Usage: node scripts/deployment-artifact.mjs build | verify DIRECTORY COMMIT');
