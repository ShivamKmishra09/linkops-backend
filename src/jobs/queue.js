import { Queue } from "bullmq";
import "dotenv/config";
import { getBullRedisConnection } from "./redisConnection.js";

const connection = getBullRedisConnection();

export const analysisQueue = new Queue("link-analysis", {
  connection,
  defaultJobOptions: {
    attempts: 3, // Retry failed jobs 3 times
    backoff: {
      type: "exponential",
      delay: 5000, // wait 5s before first retry
    },
  },
});
