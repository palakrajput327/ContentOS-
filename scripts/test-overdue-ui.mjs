import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let Component;
const compiled = resolve(`.overdue-ui-test-${randomUUID()}.mjs`);
before(async () => {
  const result = await build({ entryPoints: ['src/components/OverduePostsReview.tsx'], bundle: true,
    platform: 'node', format: 'esm', packages: 'external', write: false, define: { 'import.meta.env': '{}' } });
  await writeFile(compiled, result.outputFiles[0].text);
  Component = (await import(pathToFileURL(compiled).href)).OverduePostsReview;
});
after(async () => { await unlink(compiled).catch(() => {}); });
function render({ posts = [], canSchedule = true, demo = false } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['overdue-posts', 'fixture'], { posts, graceMinutes: 15 });
  try { return renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(MemoryRouter, null, createElement(Component, { workspaceId: 'fixture', timezone: 'Asia/Kolkata', canSchedule, demo })))); }
  finally { client.clear(); }
}
const post = { id: 'fixture-post', title: 'Missed campaign', execute_at: '2026-11-01T07:00:00Z', platform: 'Facebook', account_name: 'Fixture Page', reconnect_required: false };
test('Calendar overdue panel names the post, grace period and available decisions', () => {
  const html = render({ posts: [post] });
  for (const text of ['Missed schedules', 'Missed campaign', '15 minutes', 'Facebook', 'Fixture Page', 'Publish now', 'Reschedule', 'Discard schedule']) assert.ok(html.includes(text), text);
});
test('disconnected accounts disable publishing and rescheduling but allow discard and show Channels link', () => {
  const html = render({ posts: [{ ...post, reconnect_required: true }] });
  assert.match(html, /Reconnect required/);assert.match(html, /href="\/app\/channels"/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Publish now<\/button>/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>Reschedule<\/button>/);
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>Discard schedule<\/button>/);
});
test('viewers see the warning without mutation controls; empty and demo states stay hidden', () => {
  const html = render({ posts: [post], canSchedule: false });assert.ok(html.includes(post.title));assert.ok(!html.includes('Publish now'));assert.ok(!html.includes('Discard schedule'));
  assert.equal(render(), '');assert.equal(render({ posts: [post], demo: true }), '');
});
