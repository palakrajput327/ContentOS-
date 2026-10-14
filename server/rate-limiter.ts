import { queueBackend } from './queue-backend.js';
import { pool } from './db.js';

export async function postgresRateLimit(key: string, windowSeconds = 60) {
  return Number((await pool.query(`INSERT INTO api_rate_limits(key,hits,expires_at)
    VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET
    hits=CASE WHEN api_rate_limits.expires_at<=now() THEN 1 ELSE api_rate_limits.hits+1 END,
    expires_at=CASE WHEN api_rate_limits.expires_at<=now() THEN EXCLUDED.expires_at ELSE api_rate_limits.expires_at END
    RETURNING hits`,[key,windowSeconds])).rows[0].hits);
}
export async function createRateLimiter() {
  if (queueBackend() === 'postgres') return {
    ping: async () => { await pool.query('SELECT 1 FROM api_rate_limits LIMIT 1'); },
    count: postgresRateLimit, quit: async () => {}, disconnect: () => {}, status: 'ready',
  };
  const { Redis } = await import('ioredis');
  const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1, connectTimeout: 5000 });
  redis.on('error', () => console.error(JSON.stringify({ event: 'redis_unavailable' })));
  return {
    ping: () => redis.ping(),
    count: async (key: string, seconds = 60) => Number(await redis.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",1,key,seconds)),
    quit: () => redis.quit(), disconnect: () => redis.disconnect(), get status() { return redis.status; },
  };
}
