// src/db/redis.js

import { createClient } from "redis";
import "dotenv/config";

let redisClient;
try {
  // Use REDIS_URL if available, otherwise fall back to local default
  const redisUrl = process.env?.REDIS_URL || "redis://localhost:6379";

  redisClient = createClient({
    url: redisUrl,
  });

  redisClient.on("error", (err) => {
    console.error("Redis Client Connection Error", err);
  });

  redisClient.on("connect", () => {
    console.log("Connected to Redis successfully!");
  });

  // Connect the client
  (async () => {
    await redisClient.connect();
  })();
} catch (err) {
  console.error("Failed to create Redis client:", err);
}
export default redisClient;
