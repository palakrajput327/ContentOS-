import { queueBackend } from '../queue-backend.js';
import { Worker } from 'bullmq';
import { redis } from '../queues.js';
import { processBatch } from './batch-processing.js';
export { executeChildItem } from './batch-processing.js';
if (queueBackend()==='postgres') throw new Error('Use cron-worker in PostgreSQL mode');
export const batchWorker = new Worker('batch-processing',processBatch,{connection:redis,concurrency:3});
batchWorker.on('failed',(job,error)=>console.error(JSON.stringify({event:'batch_worker_failed',jobId:job?.id,error:error.message})));
