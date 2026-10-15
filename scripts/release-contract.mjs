import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const API_BASE = 'https://api.hidustansocialnetwork.in';
export const releaseEnvironment = (env = process.env) => ({
  ...env, VITE_API_BASE: API_BASE, VITE_API_ENABLED: 'true', CONTENTOS_RELEASE_BUILD: '1',
});

export function assertLockfileBytes(actual, committed) {
  if (committed.includes(13)) throw new Error('Committed lockfile must use LF bytes');
  if (!actual.equals(committed)) throw new Error('Release lockfile must exactly match committed LF bytes; use a clean LF checkout');
  return committed;
}

export async function committedLockfile(root, revision) {
  const committed = execFileSync('git', ['show', `${revision}:package-lock.json`], {
    cwd: root, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  return assertLockfileBytes(await readFile(join(root, 'package-lock.json')), committed);
}

// Check the actual API module after Vite replaces import.meta.env. No receipt or
// user-visible application code is added to the generated frontend.
export function productionFrontendGuard() {
  let active = false, checked = false;
  return {
    name: 'contentos-production-auth', enforce: 'post', apply: 'build',
    configResolved(config) {
      active = process.env.CONTENTOS_RELEASE_BUILD === '1';
      checked = false;
      if (active && (config.env.VITE_API_ENABLED !== 'true' || config.env.VITE_API_BASE !== API_BASE)) {
        throw new Error('Release frontend requires production API URL and VITE_API_ENABLED=true');
      }
    },
    transform(code, id) {
      if (!active || !id.replaceAll('\\', '/').endsWith('/src/lib/api.ts')) return;
      const ast = this.parse(code);
      const declarations = ast.body.flatMap(node => (node.declaration || node).declarations || []);
      const value = declarations.find(node => node.id?.name === 'apiEnabled')?.init;
      checked = value?.type === 'Literal' && value.value === true
        || value?.type === 'BinaryExpression' && value.operator === '==='
          && value.left.type === 'Literal' && value.left.value === 'true'
          && value.right.type === 'Literal' && value.right.value === 'true';
      if (!checked) this.error('Generated frontend authentication is not enabled');
    },
    generateBundle() {
      if (active && !checked) this.error('Release frontend authentication module was not verified');
      if (active) this.info('Verified compiled production authentication: apiEnabled=true');
    },
  };
}
