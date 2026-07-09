import { User } from "../models/User.js";
import { ApiError } from "../utilities/ApiError.js";
import { asyncHandler } from "../utilities/asyncHandler.js";
import redisClient from "../db/redis.js";
import { Link } from "../models/Link.js";
import { analysisQueue } from "../jobs/queue.js";
import { Collection } from "../models/Collection.js";
import mongoose from "mongoose";
import { publishUserEvent } from "../services/realtimeService.js";
import {
  getOptionalUserIdFromRequest,
  hasApprovedAccess,
} from "../services/accessService.js";
import { getUsableAuthProfile } from "../services/authProfileService.js";

const updateViewerCount = async (web_id) => {
  try {
    const fullShortUrl = `${process.env.REACT_APP_FRONTEND_URL}/l/${web_id}`;
    const user = await User.findOne({ "Links.newLink": fullShortUrl });
    if (user) {
      const index = user.Links.newLink.indexOf(fullShortUrl);
      if (index !== -1) {
        user.Viewer[index] += 1;
        await user.save();
        console.log(`Viewer count updated for ${web_id}`);
      }
    }
  } catch (error) {
    console.error(`Failed to update viewer count for ${web_id}:`, error);
  }
};
// ... (all other controller functions remain the same)

// Improved short ID generation function
const generateShortId = async (length = 7) => {
  const maxRetries = 10;
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Generate random string
    let shortId = "";
    for (let i = 0; i < length; i++) {
      shortId += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // Check if it already exists
    const existingLink = await Link.findOne({ shortId });
    if (!existingLink) {
      return shortId;
    }

    // If we're on the last attempt, try with a longer ID
    if (attempt === maxRetries) {
      return await generateShortId(length + 1);
    }

    // Add a small delay to avoid overwhelming the database
    if (attempt > 5) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  // Fallback: generate with timestamp to ensure uniqueness
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 4);
  return `${timestamp}${random}`.substring(0, length);
};

// ⭐️ HANDLE the public redirect with SAFETY WARNING ⭐️
export const handleRedirect = asyncHandler(async (req, res) => {
  const { web_id } = req.params;
  const cacheKey = `link:${web_id}`;
  let linkData;

  // 1. Check Redis for the full link object
  const cachedData = await redisClient.get(cacheKey);

  if (cachedData) {
    // 2a. CACHE HIT: Parse the JSON string from the cache
    linkData = JSON.parse(cachedData);
    // Asynchronously update the viewer count
    Link.findOneAndUpdate(
      { shortId: web_id },
      { $inc: { viewerCount: 1 } },
      { new: true }
    )
      .lean()
      .then((updatedLink) => {
        if (updatedLink) {
          publishUserEvent(updatedLink.owner, {
            type: "link-updated",
            reason: "viewer-count",
            link: updatedLink,
          });
        }
      })
      .catch((error) =>
        console.error(`Failed to publish viewer count for ${web_id}:`, error)
      );
  } else {
    // 2b. CACHE MISS: Query the database
    const link = await Link.findOne({ shortId: web_id });
    if (!link) {
      throw new ApiError(404, "Link not found");
    }

    link.viewerCount += 1;
    await link.save();
    await publishUserEvent(link.owner, {
      type: "link-updated",
      reason: "viewer-count",
      link: link.toObject(),
    });

    // 3. Cache the entire link object as a JSON string
    // We use lean() to get a plain JS object to avoid caching Mongoose methods
    linkData = link.toObject();
    await redisClient.set(cacheKey, JSON.stringify(linkData), "EX", 3600);
  }

  if (!linkData.isPublic) {
    return res.redirect(302, `${process.env.REACT_APP_FRONTEND_URL}/l/${web_id}`);
  }

  // --- 4. THE NEW SAFETY CHECK ---
  // Check if analysis is complete and the score is below the threshold (e.g., < 3)
  if (linkData.analysisStatus === "COMPLETED" && linkData.aiSafetyRating < 3) {
    console.log(
      `Unsafe link detected: ${linkData.shortId}. Redirecting to warning page.`
    );
    // Redirect to a frontend warning page, passing the destination and reason as query params
    const destinationUrl = encodeURIComponent(linkData.longUrl);
    const reason = encodeURIComponent(linkData.aiSafetyJustification);
    return res.redirect(
      `${process.env.REACT_APP_FRONTEND_URL}/warning?destination=${destinationUrl}&reason=${reason}`
    );
  }

  // 5. If the link is safe, perform the direct redirect
  return res.redirect(302, linkData.longUrl);
});

export const resolveShortLink = asyncHandler(async (req, res) => {
  const { web_id } = req.params;
  const viewerId = getOptionalUserIdFromRequest(req);
  const link = await Link.findOne({ shortId: web_id }).lean();

  if (!link) {
    throw new ApiError(404, "Link not found.");
  }

  const isOwner = viewerId && String(link.owner) === String(viewerId);
  const approved = await hasApprovedAccess({
    resourceType: "link",
    resourceId: link._id,
    userId: viewerId,
  });

  if (!link.isPublic && !isOwner && !approved) {
    return res.status(200).json({
      success: false,
      requiresApproval: true,
      link: {
        shortId: link.shortId,
      },
      message: "This short link is private. Request access from the owner.",
    });
  }

  await Link.findOneAndUpdate(
    { shortId: web_id },
    { $inc: { viewerCount: 1 } },
    { new: true }
  )
    .lean()
    .then((updatedLink) => {
      if (updatedLink) {
        publishUserEvent(updatedLink.owner, {
          type: "link-updated",
          reason: "viewer-count",
          link: updatedLink,
        });
      }
    });

  res.status(200).json({
    success: true,
    longUrl: link.longUrl,
    link,
  });
});

export const addurl = asyncHandler(async (req, res) => {
  try {
    const {
      oldLink: legacyOldLink,
      longUrl,
      customShortId,
      collectionIds = [],
      authProfileId = null,
      analysisSnapshotText = "",
    } = req.body;
    const oldLink = (longUrl || legacyOldLink || "").trim();
    const sanitizedSnapshotText =
      typeof analysisSnapshotText === "string"
        ? analysisSnapshotText.replace(/\s\s+/g, " ").trim()
        : "";
    const user_id = req.params.user_id;
    const user = await User.findById(user_id);

    if (!user) {
      console.log("User not found");
      throw new ApiError(404, "User not found");
    }

    if (!oldLink.startsWith("http://") && !oldLink.startsWith("https://")) {
      console.log("Invalid URL   ", oldLink);
      throw new ApiError(
        400,
        "Invalid URL: URL must start with 'http://' or 'https://'"
      );
    }

    if (!Array.isArray(collectionIds)) {
      throw new ApiError(400, "collectionIds must be an array.");
    }

    if (collectionIds.length > 0) {
      const foundCollections = await Collection.find({
        _id: { $in: collectionIds },
        owner: user_id,
        isSystem: { $ne: true },
      }).select("_id");

      if (foundCollections.length !== collectionIds.length) {
        throw new ApiError(
          400,
          "Some selected collections are invalid or do not belong to you."
        );
      }
    }

    if (
      sanitizedSnapshotText &&
      (sanitizedSnapshotText.length < 100 || sanitizedSnapshotText.length > 200000)
    ) {
      throw new ApiError(
        400,
        "Private page snapshot must be between 100 and 200,000 characters."
      );
    }

    const authProfile = authProfileId
      ? await getUsableAuthProfile({
          ownerId: user_id,
          authProfileId,
          url: oldLink,
        })
      : null;

    // Check if link already exists for this user
    const existingLink = await Link.findOne({
      longUrl: oldLink,
      owner: user_id,
    });

    if (existingLink) {
      const hasConnectorCandidate =
        oldLink.includes("atlassian.net") ||
        oldLink.includes("github.com") ||
        oldLink.includes("docs.google.com") ||
        oldLink.includes("drive.google.com");
      const shouldRefreshAnalysis = Boolean(
        sanitizedSnapshotText || authProfile || hasConnectorCandidate
      );

      if (sanitizedSnapshotText) {
        existingLink.analysisSnapshotText = sanitizedSnapshotText;
        existingLink.analysisInputMode = "SNAPSHOT";
      } else if (authProfile) {
        existingLink.analysisAuthProfile = authProfile._id;
        existingLink.analysisInputMode = "AUTH_PROFILE";
      } else if (hasConnectorCandidate) {
        existingLink.analysisSnapshotText = null;
        existingLink.analysisInputMode = "URL_SCRAPE";
      }

      if (collectionIds.length > 0) {
        existingLink.collections = Array.from(
          new Set([
            ...(existingLink.collections || []).map((id) => String(id)),
            ...collectionIds.map((id) => String(id)),
          ])
        );
        await Collection.updateMany(
          { _id: { $in: collectionIds }, owner: user_id },
          { $addToSet: { links: existingLink._id } }
        );
      }

      if (shouldRefreshAnalysis) {
        existingLink.analysisStatus = "PENDING";
      }

      await existingLink.save();

      if (shouldRefreshAnalysis) {
        await analysisQueue.add("analyze-link", { linkId: existingLink._id });
        await publishUserEvent(user_id, {
          type: "link-updated",
          reason: "analysis-refresh-requested",
          link: existingLink.toObject(),
          refreshDashboard: true,
        });
      }

      return res.status(200).json({
        message: shouldRefreshAnalysis
          ? "Link refreshed successfully"
          : "Link already exists",
        shortUrl: `${process.env.REACT_APP_FRONTEND_URL}/l/${existingLink.shortId}`,
        link: existingLink,
        isCustom: existingLink.shortId === customShortId,
      });
    }

    let shortId;

    if (customShortId) {
      // Validate custom short ID
      if (customShortId.length < 3 || customShortId.length > 20) {
        throw new ApiError(
          400,
          "Custom short ID must be between 3 and 20 characters"
        );
      }

      // Check if custom short ID contains only valid characters
      if (!/^[a-zA-Z0-9_-]+$/.test(customShortId)) {
        throw new ApiError(
          400,
          "Custom short ID can only contain letters, numbers, hyphens, and underscores"
        );
      }

      // Check if custom short ID already exists
      const existingCustomLink = await Link.findOne({ shortId: customShortId });
      if (existingCustomLink) {
        throw new ApiError(400, "Custom short ID already exists");
      }

      shortId = customShortId;
    } else {
      // Generate unique short ID
      shortId = await generateShortId();
    }

    const newLink = new Link({
      shortId,
      longUrl: oldLink,
      owner: user_id,
      collections: collectionIds,
      analysisAuthProfile: authProfile?._id || null,
      analysisSnapshotText: sanitizedSnapshotText || null,
      analysisInputMode: sanitizedSnapshotText
        ? "SNAPSHOT"
        : authProfile
          ? "AUTH_PROFILE"
          : "URL_SCRAPE",
    });

    await newLink.save();

    if (collectionIds.length > 0) {
      await Collection.updateMany(
        { _id: { $in: collectionIds }, owner: user_id },
        { $addToSet: { links: newLink._id } }
      );
    }

    // Add a job to the queue to analyze this link in the background
    await analysisQueue.add("analyze-link", { linkId: newLink._id });
    console.log(`Added link analysis job for link ID: ${newLink._id}`);
    await publishUserEvent(user_id, {
      type: "link-created",
      reason: "created",
      link: newLink.toObject(),
    });
    res.status(200).json({
      message: "Link added successfully",
      shortUrl: `${process.env.REACT_APP_FRONTEND_URL}/l/${shortId}`,
      link: newLink,
      isCustom: !!customShortId,
    });
  } catch (err) {
    console.log(err);
    res.status(400).json({
      message: err.message,
    });
  }
});

export const increaseViewer = asyncHandler(async (req, res) => {
  try {
    const web_id = req.params.web_id;
    const cacheKey = `link:${web_id}`;

    // 1. First, check Redis
    const cachedUrl = await redisClient.get(cacheKey);

    // 2. CACHE HIT: If found, redirect immediately
    if (cachedUrl) {
      console.log(`CACHE HIT for ${web_id}`);
      // We can optionally increment the viewer count in the background
      // For now, let's keep it simple and just redirect
      return res.status(200).json({
        message: "Redirecting from cache",
        oldLink: cachedUrl,
      });
    }

    // 3. CACHE MISS: Go to the database
    console.log(`CACHE MISS for ${web_id}`);
    const link = await Link.findOne({ shortId: web_id });

    if (!link) {
      console.log("Link not found");
      throw new ApiError(404, "Link not found");
    }

    // Increment viewer count
    link.viewerCount = (link.viewerCount || 0) + 1;
    await link.save();

    res.status(200).json({
      message: "Viewer count increased successfully",
      oldLink: link.longUrl,
    });
  } catch (err) {
    console.log(err);
    res.status(400).json({
      message: err.message,
    });
  }
});

export const geturls = asyncHandler(async (req, res) => {
  try {
    const { user_id } = req.params;

    // Find all links in the Link collection that belong to this user
    const userLinks = await Link.find({ owner: user_id }).sort({
      createdAt: -1,
    }); // Sort by newest first

    if (!userLinks) {
      // This is unlikely to happen, but good practice
      return res.status(200).json({ urls: [] });
    }

    // Send the full link objects back to the frontend
    res.status(200).json({
      urls: userLinks,
    });
  } catch (err) {
    console.log(err);
    res.status(400).json({
      message: err.message,
    });
  }
});

// REPLACE your old deleteUrl function with this one

export const deleteUrl = asyncHandler(async (req, res) => {
  try {
    const { linkId } = req.params;
    const { user_id } = req.params; // Or from req.userData

    const link = await Link.findOne({ _id: linkId, owner: user_id });

    if (!link) {
      throw new ApiError(
        404,
        "Link not found or you do not have permission to delete it."
      );
    }

    // First, invalidate the cache
    await redisClient.del(`link:${link.shortId}`);

    // Remove this link from any collections that reference it
    try {
      // Pull the linkId from all collections owned by the user that contain it
      await Collection.updateMany(
        { owner: user_id, links: linkId },
        { $pull: { links: linkId } }
      );

      // Delete any system collections that became empty after removal
      // Note: use $size 0 to find empty 'links' arrays
      const emptyUserCollections = await Collection.find({
        owner: user_id,
        isSystem: { $ne: false },
        links: { $size: 0 },
      });

      if (emptyUserCollections && emptyUserCollections.length > 0) {
        const idsToDelete = emptyUserCollections.map((c) => c._id);
        await Collection.deleteMany({ _id: { $in: idsToDelete } });
        console.log(
          `Deleted ${idsToDelete.length} empty collections for user ${user_id}`
        );
      }
    } catch (colErr) {
      console.error("Error updating collections while deleting link:", colErr);
      // don't block deletion of the link if collection cleanup fails
    }

    // Finally, delete the link from the database
    await Link.deleteOne({ _id: linkId });

    res.status(200).json({ message: "Link deleted successfully" });
  } catch (err) {
    console.error("Error in deleteUrl:", err);
    res.status(err.statusCode || 500).json({
      message: err.message || "An error occurred while deleting the URL",
    });
  }
});

export const editShortUrl = asyncHandler(async (req, res) => {
  try {
    const user_id = req.params.user_id;
    const { oldShortUrl, newShortUrl } = req.body;

    // Log received data to debug
    console.log("Edit URL request:", { user_id, oldShortUrl, newShortUrl });

    // Extract short ID from the old short URL
    const oldShortId = oldShortUrl.split("/").pop();
    const newShortId = newShortUrl.split("/").pop();

    // Check if the old link exists and belongs to the user
    const oldLink = await Link.findOne({
      shortId: oldShortId,
      owner: user_id,
    });

    if (!oldLink) {
      console.log("Short URL not found or permission denied");
      throw new ApiError(404, "Short URL not found or permission denied");
    }

    // Check if the new short ID already exists
    const existingLink = await Link.findOne({ shortId: newShortId });
    if (existingLink) {
      console.log("Short URL already exists");
      throw new ApiError(400, "Short URL already exists");
    }

    // +++ Invalidate the OLD cache key +++
    await redisClient.del(`link:${oldShortId}`);
    console.log(`CACHE INVALIDATED for old link ${oldShortId}`);

    // Update the link with new short ID
    oldLink.shortId = newShortId;
    await oldLink.save();

    // Set cache for the new short ID
    const newCacheKey = `link:${newShortId}`;
    await redisClient.set(
      newCacheKey,
      JSON.stringify(oldLink.toObject()),
      "EX",
      3600
    );

    res.status(200).json({
      message: "Short URL updated successfully",
      newShortUrl: `${process.env.REACT_APP_FRONTEND_URL}/l/${newShortId}`,
    });
  } catch (err) {
    console.error("Error in editShortUrl:", err);
    res.status(err.statusCode || 500).json({
      message: err.message || "An error occurred while updating the URL",
    });
  }
});

// Add this new function inside src/controllers/redirect.controller.js

export const editLongUrl = asyncHandler(async (req, res) => {
  try {
    const { linkId } = req.params;
    const { newLongUrl } = req.body;
    const { user_id } = req.params; // Or from req.userData if you prefer

    if (
      !newLongUrl ||
      (!newLongUrl.startsWith("http://") && !newLongUrl.startsWith("https://"))
    ) {
      throw new ApiError(400, "A valid new long URL is required.");
    }

    const link = await Link.findOne({ _id: linkId, owner: user_id });

    if (!link) {
      throw new ApiError(
        404,
        "Link not found or you do not have permission to edit it."
      );
    }

    link.longUrl = newLongUrl;
    // When a link is edited, its content has changed, so we must re-analyze it.
    link.analysisStatus = "PENDING";
    await link.save();

    // Invalidate the cache for the old entry
    await redisClient.del(`link:${link.shortId}`);

    // Add a new job to the queue to re-analyze the updated link
    // Make sure 'analysisQueue' is imported from '../jobs/queue.js'
    await analysisQueue.add("analyze-link", { linkId: link._id });
    await publishUserEvent(user_id, {
      type: "link-updated",
      reason: "edited",
      link: link.toObject(),
    });

    res.status(200).json({ message: "Link updated successfully", link });
  } catch (err) {
    console.error("Error in editLongUrl:", err);
    res.status(err.statusCode || 500).json({
      message: err.message || "An error occurred while updating the URL",
    });
  }
});

// Add this new function to the bottom of src/controllers/redirect.controller.js

export const updateLinkCollections = asyncHandler(async (req, res) => {
  const { linkId, user_id } = req.params;
  const { collectionIds } = req.body; // Expect an array of collection IDs

  if (!Array.isArray(collectionIds)) {
    throw new ApiError(400, "An array of collectionIds is required.");
  }
  // Validate that all provided collectionIds exist and belong to the user
  const foundCollections = await Collection.find(
    { _id: { $in: collectionIds }, owner: user_id },
    { _id: 1 }
  ).lean();

  const foundIds = new Set(foundCollections.map((c) => String(c._id)));
  const invalidIds = collectionIds.filter((id) => !foundIds.has(String(id)));
  if (invalidIds.length > 0) {
    throw new ApiError(
      400,
      `Some collectionIds are invalid or do not belong to the user: ${invalidIds.join(
        ", "
      )}`
    );
  }

  let updatedLink = null;
  let addResult = null;
  let removeResult = null;

  try {
    updatedLink = await Link.findOneAndUpdate(
      { _id: linkId, owner: user_id },
      { $set: { collections: collectionIds } },
      { new: true }
    );

    if (!updatedLink) {
      throw new ApiError(404, "Link not found or permission denied.");
    }

    addResult = await Collection.updateMany(
      { _id: { $in: collectionIds }, owner: user_id },
      { $addToSet: { links: linkId } }
    );

    removeResult = await Collection.updateMany(
      { _id: { $nin: collectionIds }, owner: user_id, links: linkId },
      { $pull: { links: linkId } }
    );
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    console.error("Error updating link collections:", error);
    throw new ApiError(
      500,
      "An error occurred while updating link collections."
    );
  }

  // Invalidate the cached link object so downstream services see the updated collections
  try {
    if (updatedLink && updatedLink.shortId) {
      await redisClient.del(`link:${updatedLink.shortId}`);
    }
  } catch (cacheErr) {
    console.error(
      "Failed to invalidate cache for link after updating collections:",
      cacheErr
    );
    // Do not fail the API if cache invalidation fails
  }

  await publishUserEvent(user_id, {
    type: "link-updated",
    reason: "collections-updated",
    link: updatedLink.toObject(),
    refreshDashboard: true,
  });

  // Provide detailed results to the caller
  res.status(200).json({
    message: "Link collections updated successfully.",
    link: updatedLink,
    collectionUpdateSummary: {
      addedModifiedCount: addResult
        ? addResult.modifiedCount ?? addResult.nModified ?? null
        : null,
      removedModifiedCount: removeResult
        ? removeResult.modifiedCount ?? removeResult.nModified ?? null
        : null,
    },
  });
});
