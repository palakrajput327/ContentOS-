import fs from 'node:fs';
import { execSync } from 'node:child_process';

if (fs.existsSync('frontend-deploy.zip')) {
  fs.unlinkSync('frontend-deploy.zip');
}

execSync(
  `powershell -NoProfile -Command "$ProgressPreference = 'SilentlyContinue'; Compress-Archive -Path 'dist\\*' -DestinationPath 'frontend-deploy.zip' -Force"`,
  { stdio: 'inherit' }
);

console.log('Successfully repacked frontend-deploy.zip! Size:', fs.statSync('frontend-deploy.zip').size, 'bytes');

