import { queueBackend } from './queue-backend.js';
import { pool } from './db.js';
const memoryLimits = new Map();
export async function postgresRateLimit(key, windowSeconds = 60) {
    try {
        return Number((await pool.query(`INSERT INTO api_rate_limits(key,hits,expires_at)
      VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET
      hits=CASE WHEN api_rate_limits.expires_at<=now() THEN 1 ELSE api_rate_limits.hits+1 END,
      expires_at=CASE WHEN api_rate_limits.expires_at<=now() THEN EXCLUDED.expires_at ELSE api_rate_limits.expires_at END
      RETURNING hits`, [key, windowSeconds])).rows[0].hits);
    }
    catch (err) {
        if (err?.code === '42P01') {
            try {
                await pool.query(`CREATE TABLE IF NOT EXISTS api_rate_limits (
          key text PRIMARY KEY,
          hits integer NOT NULL,
          expires_at timestamptz NOT NULL
        )`);
                return await postgresRateLimit(key, windowSeconds);
            }
            catch { }
        }
        const now = Date.now();
        const entry = memoryLimits.get(key);
        if (!entry || entry.expires <= now) {
            memoryLimits.set(key, { hits: 1, expires: now + windowSeconds * 1000 });
            return 1;
        }
        entry.hits += 1;
        return entry.hits;
    }
}
export async function createRateLimiter() {
    if (queueBackend() === 'postgres')
        return {
            ping: async () => {
                try {
                    await pool.query('SELECT 1 FROM api_rate_limits LIMIT 1');
                }
                catch (err) {
                    if (err?.code === '42P01') {
                        await pool.query(`CREATE TABLE IF NOT EXISTS api_rate_limits (
            key text PRIMARY KEY,
            hits integer NOT NULL,
            expires_at timestamptz NOT NULL
          )`);
                    }
                }
            },
            count: postgresRateLimit, quit: async () => { }, disconnect: () => { }, status: 'ready',
        };
    const { Redis } = await import('ioredis');
    const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 5000 });
    redis.on('error', () => console.error(JSON.stringify({ event: 'redis_unavailable' })));
    return {
        ping: () => redis.ping(),
        count: async (key, seconds = 60) => Number(await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", 1, key, seconds)),
        quit: () => redis.quit(), disconnect: () => redis.disconnect(), get status() { return redis.status; },
    };
}
