import { createRealtimeSubscriber, getUserRealtimeChannel } from "../services/realtimeService.js";
import { asyncHandler } from "../utilities/asyncHandler.js";

export const streamUserEvents = asyncHandler(async (req, res) => {
  const { user_id } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  res.write(
    `event: connected\ndata: ${JSON.stringify({
      message: "Realtime updates connected",
    })}\n\n`
  );

  const subscriber = await createRealtimeSubscriber();
  if (!subscriber) {
    res.write("retry: 30000\n");
    res.write(
      `event: realtime-unavailable\ndata: ${JSON.stringify({
        message:
          "Realtime updates are unavailable because Redis is not connected. The dashboard can still refresh normally.",
      })}\n\n`
    );
    res.end();
    return;
  }

  const channel = getUserRealtimeChannel(user_id);

  await subscriber.subscribe(channel, (message) => {
    res.write(`event: linkly-update\ndata: ${message}\n\n`);
  });

  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
  }, 25000);

  req.on("close", async () => {
    clearInterval(heartbeat);
    try {
      await subscriber.unsubscribe(channel);
      await subscriber.quit();
    } catch (error) {
      console.error("Error closing realtime subscriber:", error);
    }
  });
});
