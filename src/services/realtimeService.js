import { createClient } from "redis";
import "dotenv/config";

const redisUrl = process.env?.REDIS_URL || "redis://localhost:6379";
const CHANNEL_PREFIX = "linkly:user:";
const REALTIME_RETRY_MS = 30000;

let publisher;
let realtimeDisabledUntil = 0;
let lastRealtimeErrorMessage = "";

const isRealtimeCoolingDown = () => Date.now() < realtimeDisabledUntil;

const markRealtimeUnavailable = (error) => {
  realtimeDisabledUntil = Date.now() + REALTIME_RETRY_MS;
  const message =
    error?.code ||
    error?.message ||
    error?.errors?.map((item) => item.code).filter(Boolean).join(", ") ||
    "Redis unavailable";

  if (message !== lastRealtimeErrorMessage) {
    console.warn(
      `Realtime updates paused: ${message}. Start Redis or set REDIS_URL to enable live updates.`
    );
    lastRealtimeErrorMessage = message;
  }
};

const createRealtimeClient = () =>
  createClient({
    url: redisUrl,
    socket: {
      reconnectStrategy: false,
    },
  });

const getPublisher = async () => {
  if (isRealtimeCoolingDown()) return null;

  if (!publisher) {
    publisher = createRealtimeClient();
    publisher.on("error", markRealtimeUnavailable);

    try {
      await publisher.connect();
    } catch (error) {
      markRealtimeUnavailable(error);
      publisher = null;
      return null;
    }
  }
  return publisher;
};

export const getUserRealtimeChannel = (userId) => `${CHANNEL_PREFIX}${userId}`;

export const publishUserEvent = async (userId, event) => {
  if (!userId || !event) return;

  try {
    const client = await getPublisher();
    if (!client) return;

    await client.publish(
      getUserRealtimeChannel(userId),
      JSON.stringify({
        ...event,
        emittedAt: new Date().toISOString(),
      })
    );
  } catch (error) {
    markRealtimeUnavailable(error);
    publisher = null;
  }
};

export const createRealtimeSubscriber = async () => {
  if (isRealtimeCoolingDown()) return null;

  const subscriber = createRealtimeClient();
  subscriber.on("error", markRealtimeUnavailable);

  try {
    await subscriber.connect();
  } catch (error) {
    markRealtimeUnavailable(error);
    return null;
  }

  return subscriber;
};
