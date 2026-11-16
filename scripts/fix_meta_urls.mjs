import fs from 'node:fs';

// 1. Fix server/meta.media.ts
let mediaTs = fs.readFileSync('server/meta.media.ts', 'utf8');
const oldMediaPattern = /const customBase = process\.env\.META_MEDIA_PUBLIC_BASE_URL\?\.trim\(\);[\r\n\s]*const isCustomBaseValid = customBase && !customBase\.includes\("localhost"\) && !customBase\.includes\("hidustansocialnetwork\.in"\);[\r\n\s]*const base = isCustomBaseValid[\r\n\s]*\? customBase[\r\n\s]*: `http:\/\/localhost:\${process\.env\.PORT \|\| 3001}`;/;
const newMediaReplacement = `const customBase = (process.env.META_MEDIA_PUBLIC_BASE_URL || process.env.PUBLIC_URL || process.env.STORAGE_PUBLIC_URL || process.env.APP_URL)?.trim();
    const isCustomBaseValid = customBase && !customBase.includes("localhost") && !customBase.includes("127.0.0.1");
    const base = isCustomBaseValid
      ? customBase
      : \`http://localhost:\${process.env.PORT || 3001}\`;`;

if (oldMediaPattern.test(mediaTs)) {
  mediaTs = mediaTs.replace(oldMediaPattern, newMediaReplacement);
  fs.writeFileSync('server/meta.media.ts', mediaTs);
  console.log('Successfully fixed server/meta.media.ts');
} else {
  console.warn('Could not match pattern in server/meta.media.ts');
}

// 2. Fix dist-api/meta.media.js
let mediaJs = fs.readFileSync('dist-api/meta.media.js', 'utf8');
if (oldMediaPattern.test(mediaJs)) {
  mediaJs = mediaJs.replace(oldMediaPattern, newMediaReplacement);
  fs.writeFileSync('dist-api/meta.media.js', mediaJs);
  console.log('Successfully fixed dist-api/meta.media.js');
} else {
  console.warn('Could not match pattern in dist-api/meta.media.js');
}

// 3. Fix server/meta.publishing.ts
let pubTs = fs.readFileSync('server/meta.publishing.ts', 'utf8');
const oldPubPattern = /url\.hostname\.includes\("hidustansocialnetwork\.in"\)/g;
if (oldPubPattern.test(pubTs)) {
  pubTs = pubTs.replace(oldPubPattern, 'false /* hidustansocialnetwork.in is public */');
  fs.writeFileSync('server/meta.publishing.ts', pubTs);
  console.log('Successfully fixed server/meta.publishing.ts');
} else {
  console.warn('Could not match pattern in server/meta.publishing.ts');
}

// 4. Fix dist-api/meta.publishing.js
let pubJs = fs.readFileSync('dist-api/meta.publishing.js', 'utf8');
if (oldPubPattern.test(pubJs)) {
  pubJs = pubJs.replace(oldPubPattern, 'false /* hidustansocialnetwork.in is public */');
  fs.writeFileSync('dist-api/meta.publishing.js', pubJs);
  console.log('Successfully fixed dist-api/meta.publishing.js');
} else {
  console.warn('Could not match pattern in dist-api/meta.publishing.js');
}

// 5. Add browser User-Agent to catbox in both files
for (const file of ['server/meta.publishing.ts', 'dist-api/meta.publishing.js']) {
  let text = fs.readFileSync(file, 'utf8');
  if (!text.includes('"User-Agent": "Mozilla/5.0')) {
    text = text.replace(
      'method: "POST",',
      'method: "POST", headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0" },'
    );
    fs.writeFileSync(file, text);
    console.log('Added User-Agent header to', file);
  }
}

