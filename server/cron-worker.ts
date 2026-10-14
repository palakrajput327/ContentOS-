import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import { loadConfig } from './config.js';
import { queueBackend } from './queue-backend.js';
import { postgresQueue } from './queues.js';
import { runCron, type JobOutcome, lanes } from './cron-runtime.js';
import { prepareCron } from './cron-tasks.js';
import type { QueueJob } from './postgres-queue.js';

export function childJob(job: QueueJob,signal: AbortSignal,timeoutMs = 90000): Promise<JobOutcome> {
  return new Promise((resolve,reject)=>{
    const child = spawn(process.execPath,[fileURLToPath(new URL('./cron-job.js',import.meta.url)),job.id,job.owner],{
      env:process.env,stdio:['ignore','ignore','pipe','ipc'],windowsHide:true,
    });
    let outcome: JobOutcome | undefined, stopped=false, killTimer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      if (stopped) return;
      stopped=true; child.kill('SIGTERM');
      killTimer=setTimeout(()=>child.kill('SIGKILL'),5000);
    };
    signal.addEventListener('abort',abort,{once:true});
    if (signal.aborted) abort();
    const timer=setTimeout(abort,timeoutMs);
    // No credentials or arbitrary handler error text go into cron logs.
    child.stderr?.on('data',()=>{});
    child.on('message',(message:any)=>{ if (message?.type==='outcome') outcome=message.value; });
    const cleanup=()=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);signal.removeEventListener('abort',abort);};
    child.once('error',error=>{cleanup();reject(error);});
    child.once('exit',(code)=>{
      cleanup();
      resolve(code===0 && outcome ? outcome : {
        outcome:job.queue==='social-publishing' ? 'uncertain' : 'retry',code:stopped?'EXECUTION_TIMEOUT':'CHILD_FAILED',
      });
    });
  });
}

export async function cronMain(args = process.argv.slice(2)) {
  loadConfig();
  if (queueBackend() !== 'postgres') throw new Error('Cron worker requires explicit QUEUE_BACKEND=postgres');
  const laneArg = args.find(a=>a.startsWith('--lane='))?.split('=')[1] || 'priority';
  if (!(laneArg in lanes)) throw new Error('Invalid cron lane');
  const lane=laneArg as keyof typeof lanes;
  const budget=Number(args.find(a=>a.startsWith('--budget-seconds='))?.split('=')[1] || 45);
  if (!Number.isFinite(budget) || budget<1 || budget>120) throw new Error('Cron budget must be 1-120 seconds');
  const controller=new AbortController();
  const stop=()=>controller.abort();
  process.once('SIGTERM',stop); process.once('SIGINT',stop);
  // An invocation admits work for budget seconds, then drains one bounded child.
  const hardLimit=setTimeout(stop,(budget+95)*1000);
  try {
    const result=await runCron(postgresQueue,{
      lane,budgetMs:budget*1000,signal:controller.signal,
      prepare:()=>prepareCron(lane),handle:(job,signal)=>childJob(job,signal),
    });
    console.log(JSON.stringify({event:'cron_finished',lane,...result}));
  } finally {
    clearTimeout(hardLimit); process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase()===process.argv[1].toLowerCase()) {
  cronMain().catch(()=>{console.error(JSON.stringify({event:'cron_failed'}));process.exitCode=1;})
    .finally(()=>pool.end());
}
