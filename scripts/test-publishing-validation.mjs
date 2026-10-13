import assert from 'node:assert/strict';
import { validatePlatformVariant } from '../dist-api/platform-capabilities.js';

console.log('Testing validatePlatformVariant rules...');

// 1. Test Empty Caption Validation
const emptyCaptionResult = validatePlatformVariant('LinkedIn', {
  caption: '   ',
  mediaType: 'text'
}, { isPublishing: true });

assert.strictEqual(emptyCaptionResult.valid, false, 'Empty caption should fail validation');
assert.ok(emptyCaptionResult.errors.includes('Caption cannot be empty.'), 'Should include empty caption error message');

// 2. Test Instagram Text-to-JPEG Auto-Poster Validation (Valid Caption)
const igAutoPosterResult = validatePlatformVariant('Instagram', {
  caption: 'Hello Instagram World!',
  mediaType: 'text'
}, { isPublishing: true });

assert.strictEqual(igAutoPosterResult.valid, true, 'Instagram caption-only post should be valid for auto-poster');

// 3. Test Instagram Empty Caption (Invalid)
const igEmptyResult = validatePlatformVariant('Instagram', {
  caption: '',
  mediaType: 'text'
}, { isPublishing: true });

assert.strictEqual(igEmptyResult.valid, false, 'Instagram empty caption should fail validation');
assert.ok(igEmptyResult.errors.includes('Caption cannot be empty.'), 'Should complain about empty caption');

// 4. Test YouTube Requires Video
const ytResult = validatePlatformVariant('YouTube', {
  title: 'My Video',
  caption: 'Description',
  mediaType: 'text'
}, { isPublishing: true });

assert.strictEqual(ytResult.valid, false, 'YouTube without video should fail validation');
assert.ok(ytResult.errors.some(e => e.includes('YouTube requires an attached video')), 'Should specify YouTube video requirement');

// 5. Test LinkedIn Normal Post
const linkedinResult = validatePlatformVariant('LinkedIn', {
  caption: 'Valid B2B Update',
  mediaType: 'text'
}, { isPublishing: true });

// 6. Test MetaGraphError detail preservation
import { MetaGraphError } from '../dist-api/meta.api.js';
import { publicMetaUrl } from '../dist-api/meta.publishing.js';

const graphErr = new MetaGraphError('12345/media', 400, 100, 368, 'OAuthException', 'Unsupported aspect ratio', 'trace_xyz123');
assert.strictEqual(graphErr.status, 400);
assert.strictEqual(graphErr.code, 100);
assert.strictEqual(graphErr.subcode, 368);
assert.strictEqual(graphErr.errorType, 'OAuthException');
assert.strictEqual(graphErr.apiMessage, 'Unsupported aspect ratio');
assert.strictEqual(graphErr.fbtraceId, 'trace_xyz123');
assert.ok(graphErr.message.includes('Unsupported aspect ratio'), 'MetaGraphError should preserve API message');

// 7. Test Localhost URL detection in publicMetaUrl
assert.throws(() => {
  publicMetaUrl('http://localhost:5173/api/v1/social/meta/text-card');
}, (err) => {
  return err.message.includes('Meta cannot download media from localhost/private storage');
});

console.log('✅ ALL PUBLISHING VALIDATION & ERROR REPORTING TESTS PASSED SUCCESSFULLY!');
