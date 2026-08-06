import { Redis } from "ioredis";
import { env } from "./env";

let instance: Redis | undefined;

export function getRedis(): Redis {
  instance ??= new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
  return instance;
}
