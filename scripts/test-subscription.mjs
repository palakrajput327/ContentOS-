import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.loadEnvFile(root + '.env');

const env = {
  ...process.env,
  PORT: process.env.PORT || '3001',
  APP_ENV: 'test',
  MAIL_USERNAME: 'test@example.test',
  MAIL_PASSWORD: 'test-only-not-a-secret',
  TOKEN_ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || process.env.TOKEN_ENCRYPTION_KEY,
};

let spawnedApi = null;
try {
  let ready = false;
  try {
    const res = await fetch(`http://127.0.0.1:${env.PORT}/api/v1/health/ready`);
    if (res.ok) ready = true;
  } catch {}

  if (!ready) {
    spawnedApi = spawn(process.execPath, ['dist-api/phase-main.js'], {
      cwd: root,
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${env.PORT}/api/v1/health/ready`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  const code = await new Promise((resolve, reject) => {
    const p = spawn(
      process.execPath,
      ['--experimental-strip-types', '--test', 'tests/subscription.test.ts'],
      {
        cwd: root,
        env,
        stdio: 'inherit',
        windowsHide: true,
      },
    );
    p.on('exit', resolve);
    p.on('error', reject);
  });
  process.exitCode = code ?? 1;
} finally {
  if (spawnedApi) {
    spawnedApi.kill();
  }
}
