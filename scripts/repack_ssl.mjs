import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const baseDir = path.resolve('.runtime/cpanel-package-1793350339583/backend');
fs.cpSync('dist-api', path.join(baseDir, 'dist-api'), { recursive: true });
fs.cpSync('server', path.join(baseDir, 'server'), { recursive: true });
fs.copyFileSync('database_full_setup.sql', path.join(baseDir, 'database_full_setup.sql'));

if (fs.existsSync('backend-deploy.zip')) {
  fs.unlinkSync('backend-deploy.zip');
}

execSync(
  `powershell -NoProfile -Command "$ProgressPreference = 'SilentlyContinue'; Compress-Archive -Path '${baseDir}\\*' -DestinationPath 'backend-deploy.zip' -Force"`,
  { stdio: 'inherit' }
);

console.log('backend-deploy.zip repacked successfully! Size:', fs.statSync('backend-deploy.zip').size, 'bytes');
