import { pool, type DB } from './db.js';
import { postgresQueue } from './queues.js';

export async function relayScheduledPosts(db: DB = pool,limit = 200) {
  const records = (await db.query(`SELECT id,workspace_id,execute_at FROM scheduled_posts
    WHERE state IN ('PENDING','ENQUEUED') ORDER BY execute_at,id LIMIT $1`,[limit])).rows;
  for (const row of records) {
    await postgresQueue.enqueue('social-publishing','publish',{id:row.id,workspaceId:row.workspace_id},{
      workspaceId:row.workspace_id,key:row.id,runAt:new Date(row.execute_at),attempts:5,backoff:60000,priority:90,
    },db);
  }
  return records.length;
}

export async function prepareCron(lane: 'priority'|'background') {
  const tasks: Array<[string,number,number]> = lane === 'priority'
    ? [['auth-email-dispatch',60000,100],['youtube-processing',60000,80]]
    : [['festival-automation',60000,30],['knowledge-automation',60000,20],['queue-maintenance',3600000,10]];
  if (lane === 'priority') await postgresQueue.recurring('publishing-relay',60000,async db => { await relayScheduledPosts(db); });
  for (const [name,interval,priority] of tasks) {
    await postgresQueue.recurring(name,interval,async db => {
      const pending = (await db.query(`SELECT 1 FROM queue_jobs WHERE queue=$1 AND scope='system'
        AND state IN ('waiting','active') LIMIT 1`,[name])).rowCount;
      if (!pending) await postgresQueue.enqueue(name,name,{}, {key:`${name}:${Date.now()}`,attempts:3,backoff:60000,priority},db);
    });
  }
}
