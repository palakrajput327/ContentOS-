import ffmpeg from 'ffmpeg-static';
import { accessSync, constants } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (!ffmpeg) throw new Error('FFmpeg is unavailable for this platform.');
accessSync(ffmpeg, constants.X_OK);
const result = spawnSync(ffmpeg, ['-version'], {
  encoding: 'utf8', timeout: 15000, windowsHide: true,
});
if (result.error || result.status !== 0) {
  throw new Error(`FFmpeg verification failed: ${result.error?.code || result.status}`);
}
console.log(result.stdout.split('\n')[0]);
