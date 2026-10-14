import { queueBackend } from './queue-backend.js';
export { executePublishRecord, claim, aggregate } from './publishing.js';
if (queueBackend() === 'postgres') {
  throw new Error('PostgreSQL mode requires the bounded cron-worker entry point.');
}
await import('./bullmq-worker.js');
