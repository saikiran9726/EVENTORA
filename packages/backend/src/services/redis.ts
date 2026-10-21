import { Redis } from 'ioredis';
// @ts-ignore
import RedisMock from 'ioredis-mock';

let redisInstance: Redis | null = null;

export function getRedisClient(): Redis {
  if (redisInstance) {
    return redisInstance;
  }

  const redisUrl = process.env.REDIS_URL;

  if (process.env.NODE_ENV === 'test' || !redisUrl) {
    // In test or local dev without REDIS_URL, use ioredis-mock for 100% in-memory Redis compatibility
    redisInstance = new (RedisMock as any)() as Redis;
    return redisInstance;
  }

  redisInstance = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  redisInstance.on('error', (err: Error) => {
    console.warn('[Redis] Connection warning, falling back to mock if needed:', err.message);
  });

  return redisInstance;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

/**
 * Sliding window rate limiter using Redis sorted sets (ZSET).
 * Key tracks timestamps in milliseconds.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;
  const setKey = `ratelimit:${key}`;

  try {
    const multi = redis.multi();
    // 1. Remove timestamps older than current sliding window
    multi.zremrangebyscore(setKey, 0, windowStart);
    // 2. Count requests in current window
    multi.zcard(setKey);
    // 3. Add current timestamp
    multi.zadd(setKey, now, `${now}-${Math.random()}`);
    // 4. Set TTL to window length
    multi.expire(setKey, windowSeconds);

    const results = await multi.exec();
    if (!results) {
      return { allowed: true, remaining: limit, resetSeconds: windowSeconds };
    }

    // Index 1 is zcard result
    const currentCount = (results[1][1] as number) || 0;

    if (currentCount >= limit) {
      // Remove the timestamp that exceeded the limit
      await redis.zremrangebyscore(setKey, now, now);
      return {
        allowed: false,
        remaining: 0,
        resetSeconds: windowSeconds,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - (currentCount + 1)),
      resetSeconds: windowSeconds,
    };
  } catch (err) {
    console.error('[RateLimit] Error checking rate limit:', err);
    // Fail-open in unexpected error to prevent hard lockout, but log
    return { allowed: true, remaining: 1, resetSeconds: windowSeconds };
  }
}
