import { Redis } from 'ioredis';
import { env } from '../config/env.js';

// BullMQ requires maxRetriesPerRequest: null on its connections.
export function createRedis(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
}

let shared: Redis | null = null;
export function redis(): Redis {
  if (!shared) shared = createRedis();
  return shared;
}
