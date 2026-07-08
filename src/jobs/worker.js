import { Worker, QueueEvents } from "bullmq";
import "dotenv/config";
import { Link } from "../models/Link.js";
import { analyzeUrlContent } from "../services/aiService.js";
import { assignLinkToSystemCollection } from "../services/systemCollectionService.js";
// --- 1. IMPORT YOUR DATABASE CONNECTION FUNCTION ---
import { addLinkTagsToUser } from "../services/systemCollectionService.js";
import { connectDB } from "../db/index.js";
import { publishUserEvent } from "../services/realtimeService.js";
import {
  markKnowledgeAssetFailed,
  upsertKnowledgeAssetFromAnalysis,
} from "../services/knowledgeAssetService.js";

// --- 3. CREATE AN ASYNC FUNCTION TO START THE WORKER ---
const startWorker = async () => {
  // --- 4. CONNECT TO MONGODB FIRST ---
  try {
    await connectDB();
    console.log("MongoDB connection established for AI worker.");
  } catch (error) {
    console.error(
      "Failed to connect to MongoDB for AI worker. Exiting.",
      error
    );
    process.exit(1); // Exit if DB connection fails
  }
  const connection = process.env?.REDIS_URL || "redis://localhost:6379";

  const queueEvents = new QueueEvents("link-analysis", { connection });
  queueEvents.on("waiting", ({ jobId }) =>
    console.log("Queue event: waiting", jobId)
  );
  queueEvents.on("active", ({ jobId }) =>
    console.log("Queue event: active", jobId)
  );
  queueEvents.on("completed", ({ jobId }) =>
    console.log("Queue event: completed", jobId)
  );
  queueEvents.on("failed", ({ jobId, failedReason }) =>
    console.log("Queue event: failed", jobId, failedReason)
  );

  // --- 5. INITIALIZE THE WORKER ONLY AFTER DB IS CONNECTED ---
  const worker = new Worker(
    "link-analysis",
    async (job) => {
      const { linkId } = job.data;
      console.log(`Processing job for linkId: ${linkId}`);

      try {
        // Now this database call will work because we are connected
        const link = await Link.findById(linkId);
        if (!link) throw new Error("Link not found");

        const analysisResult = await analyzeUrlContent(link.longUrl, {
          ownerId: link.owner,
          authProfileId: link.analysisAuthProfile,
          textOverride: link.analysisSnapshotText,
        });
        console.log(analysisResult);

        link.aiSummary = analysisResult.summary;
        link.aiTags = analysisResult.tags;
        link.aiSafetyRating = analysisResult.safety.safety_rating;
        link.aiSafetyJustification =
          analysisResult.safety.justification || analysisResult.safety.explanation;
        link.aiClassification = {
          category: analysisResult.classification.category,
          confidence: analysisResult.classification.confidence,
          reason: analysisResult.classification.reason,
        };
        link.analysisStatus = "COMPLETED";

        await link.save();

        let knowledgeAsset = null;
        try {
          knowledgeAsset = await upsertKnowledgeAssetFromAnalysis({
            link,
            analysisResult,
          });
        } catch (error) {
          console.error("Failed to upsert knowledge asset:", error);
        }

        // Automatically assign link to appropriate system collection
        try {
          await assignLinkToSystemCollection(
            link.owner,
            link._id,
            analysisResult.classification
          );
        } catch (error) {
          console.error("Failed to assign link to system collection:", error);
        }
        try {
          await addLinkTagsToUser(link.owner, analysisResult.tags);
        } catch (error) {
          console.error("Failed to add link tags to user:", error);
        }
        await publishUserEvent(link.owner, {
          type: "link-updated",
          reason: "analysis-completed",
          link: link.toObject(),
          asset: knowledgeAsset,
          refreshDashboard: true,
        });
      } catch (error) {
        console.error(`Job failed for linkId: ${linkId}`, error);
        const failedLink = await Link.findByIdAndUpdate(
          linkId,
          { analysisStatus: "FAILED" },
          { new: true }
        ).lean();
        if (failedLink) {
          let knowledgeAsset = null;
          try {
            knowledgeAsset = await markKnowledgeAssetFailed({
              link: failedLink,
              errorMessage: error?.message || "Analysis failed",
            });
          } catch (assetError) {
            console.error("Failed to mark knowledge asset failed:", assetError);
          }

          await publishUserEvent(failedLink.owner, {
            type: "link-updated",
            reason: "analysis-failed",
            link: failedLink,
            asset: knowledgeAsset,
          });
        }
      }
    },
    { connection }
  );

  worker.on("error", (err) => console.error("Worker error:", err));
  worker.on("completed", (job) => console.log(`Job ${job.id} has completed!`));
  worker.on("failed", (job, err) =>
    console.log(`Job ${job.id} has failed:`, err?.message || err)
  );

  process.on("unhandledRejection", (reason) =>
    console.error("UnhandledRejection in worker:", reason)
  );
  process.on("uncaughtException", (err) =>
    console.error("UncaughtException in worker:", err)
  );

  console.log("AI Worker started and listening for jobs...");
};

// --- 6. RUN THE START FUNCTION ---
startWorker();
