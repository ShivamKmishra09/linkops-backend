const DEFAULT_REDIS_URL = "redis://localhost:6379";

export const getBullRedisConnection = () => {
  const redisUrl = new URL(process.env?.REDIS_URL || DEFAULT_REDIS_URL);

  return {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    username: redisUrl.username ? decodeURIComponent(redisUrl.username) : undefined,
    password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined,
    maxRetriesPerRequest: null,
  };
};
