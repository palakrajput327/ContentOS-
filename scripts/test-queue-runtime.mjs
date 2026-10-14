import assert from 'node:assert/strict';
import { test, mock } from 'node:test';

const queues = [], workers = [], schedulers = [];
class Redis {
  constructor(url, options) { this.url = url; this.options = options; }
  on() {} async quit() {}
}
class Queue {
  constructor(name, options) { this.name = name; this.options = options; queues.push(this); }
  async upsertJobScheduler(id, schedule, template) { schedulers.push({ id, schedule, template }); }
  async close() {}
}
class Worker {
  constructor(name, processor, options) { Object.assign(this, { name, processor, options }); workers.push(this); }
  on() {} async close() {}
}
mock.module('ioredis', { namedExports: { Redis } });
mock.module('bullmq', { namedExports: { Queue, Worker, UnrecoverableError: class extends Error {} } });
mock.module('../dist-api/db.js', { namedExports: {
  pool: { query: async () => ({ rows: [] }), end: async () => {} },
  transaction: async () => {}, audit: async () => {},
} });
process.env.REDIS_URL = 'redis://127.0.0.1:1';
const { publishingQueue, redis } = await import('../dist-api/queues.js');

test('queue initialization creates a producer, not a worker, and preserves publish retries', () => {
  assert.equal(workers.length, 0);
  assert.equal(queues.length, 1);
  assert.equal(publishingQueue.name, 'social-publishing');
  assert.equal(redis.options.maxRetriesPerRequest, null);
  assert.deepEqual(publishingQueue.options.defaultJobOptions, {
    attempts: 5, backoff: { type: 'exponential', delay: 60000 },
    removeOnComplete: { age: 7 * 86400 }, removeOnFail: { age: 30 * 86400 },
  });
});

test('mail worker schedules delivery every 10 seconds without extra consumers', async () => {
  let deliveries = 0;
  mock.module('../dist-api/config.js', { namedExports: { loadConfig: () => ({ REDIS_URL: process.env.REDIS_URL }) } });
  mock.module('../dist-api/codes.js', { namedExports: { requireMail() {} } });
  mock.module('../dist-api/mail.js', { namedExports: { deliverEmails: async () => { deliveries++; } } });
  await import('../dist-api/mail-worker.js');
  const worker = workers.find(w => w.name === 'auth-email-dispatch');
  assert.equal(workers.length, 1);
  assert.equal(worker.options.connection.options.maxRetriesPerRequest, null);
  assert.deepEqual(schedulers.find(s => s.id === 'email-outbox').schedule, { every: 10000 });
  await worker.processor();
  assert.equal(deliveries, 1);
});

test('maintenance remains scheduled and publishing retains lock and stall protection', async () => {
  mock.module('../dist-api/pdf-worker.js', { namedExports: { pdfWorker: new Worker('pdf-processing', () => {}, {}) } });
  mock.module('../dist-api/ai-worker.js', { namedExports: { aiWorker: new Worker('content-generation', () => {}, {}) } });
  mock.module('../dist-api/knowledge/automation.worker.js', { namedExports: {
    knowledgeAutomationQueue: new Queue('knowledge-automation', {}),
    knowledgeAutomationWorker: new Worker('knowledge-automation', () => {}, {}),
  } });
  await import('../dist-api/worker.js');
  assert.equal(workers.filter(w => w.name === 'pdf-processing').length, 1);
  assert.equal(workers.filter(w => w.name === 'content-generation').length, 1);
  assert.equal(workers.filter(w => w.name === 'social-publishing').length, 1);
  assert.deepEqual(schedulers.find(s => s.id === 'outbox-relay').schedule, { every: 30000 });
  const worker = workers.find(w => w.name === 'social-publishing');
  assert.equal(worker.options.lockDuration, 90000);
  assert.equal(worker.options.maxStalledCount, 1);
  assert.equal(worker.options.concurrency, 5);
  assert.equal(worker.options.skipLockRenewal, undefined);
  assert.equal(worker.options.skipStalledCheck, undefined);
  await workers.find(w => w.name === 'scheduler-maintenance').processor();
});
