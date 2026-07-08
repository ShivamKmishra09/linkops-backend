import { Collection } from "../models/Collection.js";
import { Link } from "../models/Link.js";
import { ApiError } from "../utilities/ApiError.js";
import { ApiResponse } from "../utilities/ApiResponse.js";
import { asyncHandler } from "../utilities/asyncHandler.js";
import mongoose from "mongoose";
import { User } from "../models/User.js";
import {
  getOptionalUserIdFromRequest,
  hasApprovedAccess,
} from "../services/accessService.js";

// --- CREATE a new, empty collection ---
export const createCollection = asyncHandler(async (req, res) => {
  const { name } = req.body;
  const { user_id } = req.params;

  // Validate user_id format
  if (!mongoose.Types.ObjectId.isValid(user_id)) {
    throw new ApiError(400, "Invalid user ID format.");
  }

  // Validate and sanitize collection name
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new ApiError(400, "Collection name cannot be empty.");
  }

  const sanitizedName = name.trim();

  // Check name length
  if (sanitizedName.length > 100) {
    throw new ApiError(400, "Collection name cannot exceed 100 characters.");
  }

  // Check for potentially harmful characters (basic XSS prevention)
  const harmfulPattern = /[<>]/;
  if (harmfulPattern.test(sanitizedName)) {
    throw new ApiError(400, "Collection name contains invalid characters.");
  }

  // Check for duplicate collection names for the same user
  const existingCollection = await Collection.findOne({
    owner: user_id,
    name: sanitizedName,
  });

  if (existingCollection) {
    throw new ApiError(409, "A collection with this name already exists.");
  }

  const newCollection = new Collection({
    name: sanitizedName,
    owner: user_id,
    links: [],
  });

  await newCollection.save();

  res.status(201).json({
    success: true,
    message: "Collection created successfully",
    collection: newCollection,
  });
});

// --- GET all collections for a user ---
export const getCollections = asyncHandler(async (req, res) => {
  const { user_id } = req.params;
  const { page = 1, limit = 50, search = "" } = req.query;

  // Validate user_id format
  if (!mongoose.Types.ObjectId.isValid(user_id)) {
    throw new ApiError(400, "Invalid user ID format.");
  }

  // Validate pagination parameters
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);

  if (
    isNaN(pageNum) ||
    isNaN(limitNum) ||
    pageNum < 1 ||
    limitNum < 1 ||
    limitNum > 100
  ) {
    throw new ApiError(
      400,
      "Invalid pagination parameters. Page must be >= 1, limit must be between 1 and 100."
    );
  }

  // Validate search parameter
  if (search && typeof search !== "string") {
    throw new ApiError(400, "Search parameter must be a string.");
  }

  try {
    // Build query
    const query = { owner: user_id };
    if (search && search.trim()) {
      const sanitizedSearch = search.trim();
      if (sanitizedSearch.length > 100) {
        throw new ApiError(
          400,
          "Search query too long. Maximum 100 characters allowed."
        );
      }
      query.name = { $regex: sanitizedSearch, $options: "i" };
    }

    // Get total count for pagination
    const totalCollections = await Collection.countDocuments(query);

    // Get collections with pagination
    const collections = await Collection.find(query)
      .sort({ name: 1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .populate("links", "shortId longUrl viewerCount analysisStatus")
      .lean(); // Use lean() for better performance when we don't need Mongoose methods

    res.status(200).json({
      success: true,
      collections,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalCollections / limitNum),
        totalCollections,
        hasNextPage: pageNum * limitNum < totalCollections,
        hasPrevPage: pageNum > 1,
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error(`Error fetching collections for user ${user_id}:`, error);
    throw new ApiError(
      500,
      "An error occurred while fetching collections. Please try again."
    );
  }
});

// --- GET a single collection by ID ---
export const getCollection = asyncHandler(async (req, res) => {
  const { collectionId, user_id } = req.params;

  // Validate IDs format
  if (
    !mongoose.Types.ObjectId.isValid(collectionId) ||
    !mongoose.Types.ObjectId.isValid(user_id)
  ) {
    throw new ApiError(400, "Invalid ID format.");
  }

  try {
    const collection = await Collection.findOne({
      _id: collectionId,
      owner: user_id,
    }).populate(
      "links",
      "shortId longUrl viewerCount analysisStatus aiSummary aiTags aiSafetyRating"
    );

    if (!collection) {
      throw new ApiError(404, "Collection not found or permission denied.");
    }

    res.status(200).json({
      success: true,
      collection,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    console.error(`Error fetching collection ${collectionId}:`, error);
    throw new ApiError(
      500,
      "An error occurred while fetching the collection. Please try again."
    );
  }
});

// --- UPDATE collection name ---
export const updateCollection = asyncHandler(async (req, res) => {
  const { collectionId, user_id } = req.params;
  const { name } = req.body;

  // Validate IDs format
  if (
    !mongoose.Types.ObjectId.isValid(collectionId) ||
    !mongoose.Types.ObjectId.isValid(user_id)
  ) {
    throw new ApiError(400, "Invalid ID format.");
  }

  // Validate and sanitize collection name
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new ApiError(400, "Collection name cannot be empty.");
  }

  const sanitizedName = name.trim();

  // Check name length
  if (sanitizedName.length > 100) {
    throw new ApiError(400, "Collection name cannot exceed 100 characters.");
  }

  // Check for potentially harmful characters (basic XSS prevention)
  const harmfulPattern = /[<>]/;
  if (harmfulPattern.test(sanitizedName)) {
    throw new ApiError(400, "Collection name contains invalid characters.");
  }

  // Check for duplicate collection names for the same user (excluding current collection)
  const existingCollection = await Collection.findOne({
    owner: user_id,
    name: sanitizedName,
    _id: { $ne: collectionId },
  });

  if (existingCollection) {
    throw new ApiError(409, "A collection with this name already exists.");
  }

  const updatedCollection = await Collection.findOneAndUpdate(
    {
      _id: collectionId,
      owner: user_id,
    },
    { name: sanitizedName },
    { new: true, runValidators: true }
  );

  if (!updatedCollection) {
    throw new ApiError(404, "Collection not found or permission denied.");
  }

  res.status(200).json({
    success: true,
    message: "Collection updated successfully",
    collection: updatedCollection,
  });
});

// --- ADD links to collection ---
export const addLinksToCollection = asyncHandler(async (req, res) => {
  const { collectionId, user_id } = req.params;
  const { linkIds } = req.body;

  // Validate IDs format
  if (
    !mongoose.Types.ObjectId.isValid(collectionId) ||
    !mongoose.Types.ObjectId.isValid(user_id)
  ) {
    throw new ApiError(400, "Invalid ID format.");
  }

  // Validate linkIds array
  if (!Array.isArray(linkIds) || linkIds.length === 0) {
    throw new ApiError(400, "linkIds must be a non-empty array.");
  }

  // Limit the number of links that can be added at once
  if (linkIds.length > 100) {
    throw new ApiError(400, "Cannot add more than 100 links at once.");
  }

  // Validate each linkId format
  for (const linkId of linkIds) {
    if (!mongoose.Types.ObjectId.isValid(linkId)) {
      throw new ApiError(400, `Invalid link ID format: ${linkId}`);
    }
  }

  // Check if collection exists and user owns it
  const collection = await Collection.findOne({
    _id: collectionId,
    owner: user_id,
  });

  if (!collection) {
    throw new ApiError(404, "Collection not found or permission denied.");
  }

  // Check if all links exist and belong to the user
  const links = await Link.find({
    _id: { $in: linkIds },
    owner: user_id,
  });

  if (links.length !== linkIds.length) {
    const foundIds = links.map((link) => link._id.toString());
    const missingIds = linkIds.filter((id) => !foundIds.includes(id));
    throw new ApiError(
      400,
      `Some links not found or permission denied: ${missingIds.join(", ")}`
    );
  }
const session = await mongoose.startSession();
  let updatedCollection = null;
  let updateResult = null;
  
  try {
    await session.withTransaction(async () => {
      // 1. ATOMIC UPDATE: Add links to collection
      updatedCollection = await Collection.findByIdAndUpdate(
        collectionId,
        { $addToSet: { links: { $each: linkIds } } },
        { new: true, runValidators: true, session: session } // 👈 Pass session to ensure atomicity
      );

      if (!updatedCollection) {
        // Must throw an error to abort the transaction
        throw new ApiError(404, "Collection not found or permission denied (Transaction aborted).");
      }

      // 2. ATOMIC UPDATE: Update links to include this collection
      updateResult = await Link.updateMany(
        { _id: { $in: linkIds }, owner: user_id },
        { $addToSet: { collections: collectionId } },
        { session: session } // 👈 Pass session to ensure atomicity
      );
      
      // We don't check updateResult.modifiedCount, but we rely on the above checks 
      // ensuring the links exist and belong to the user.
    });

    // 3. Close the session after successful commit

    // 4. Return success response
    res.status(200).json({
      success: true,
      message: "Links added to collection successfully (Atomic)",
      collection: updatedCollection,
      addedLinks: linkIds.length,
      modifiedLinks: updateResult.modifiedCount,
    });
  } catch (error) {
    // Ensure session is closed even on failure
    await session.endSession(); 
    
    // Re-throw ApiError to be handled by asyncHandler, or wrap other errors
    if (error instanceof ApiError) {
        throw error;
    }
    console.error(`Error adding links to collection ${collectionId}:`, error);
    throw new ApiError(
      500,
      "An error occurred while adding links to the collection. Transaction rolled back."
    );
  } finally {
    // Ensure session is closed even on failure
    await session.endSession(); 
  }
});

// --- REMOVE links from collection ---
export const removeLinksFromCollection = asyncHandler(async (req, res) => {
  const { collectionId, user_id } = req.params;
  const { linkIds } = req.body;

  // Validate IDs format
  if (
    !mongoose.Types.ObjectId.isValid(collectionId) ||
    !mongoose.Types.ObjectId.isValid(user_id)
  ) {
    throw new ApiError(400, "Invalid ID format.");
  }

  // Validate linkIds array
  if (!Array.isArray(linkIds) || linkIds.length === 0) {
    throw new ApiError(400, "linkIds must be a non-empty array.");
  }

  // Limit the number of links that can be removed at once
  if (linkIds.length > 100) {
    throw new ApiError(400, "Cannot remove more than 100 links at once.");
  }

  // Validate each linkId format
  for (const linkId of linkIds) {
    if (!mongoose.Types.ObjectId.isValid(linkId)) {
      throw new ApiError(400, `Invalid link ID format: ${linkId}`);
    }
  }

  // Check if collection exists and user owns it
  const collection = await Collection.findOne({
    _id: collectionId,
    owner: user_id,
  });

  if (!collection) {
    throw new ApiError(404, "Collection not found or permission denied.");
  }

  try {
    // Remove links from collection
    const updatedCollection = await Collection.findByIdAndUpdate(
      collectionId,
      { $pull: { links: { $in: linkIds } } },
      { new: true, runValidators: true }
    );

    // Remove collection from links
    const updateResult = await Link.updateMany(
      { _id: { $in: linkIds } },
      { $pull: { collections: collectionId } }
    );

    if (updateResult.modifiedCount > 0) {
      console.log(
        `Removed collection ${collectionId} from ${updateResult.modifiedCount} links`
      );
    }

    res.status(200).json({
      success: true,
      message: "Links removed from collection successfully",
      collection: updatedCollection,
      removedLinks: linkIds.length,
      modifiedLinks: updateResult.modifiedCount,
    });
  } catch (error) {
    console.error(
      `Error removing links from collection ${collectionId}:`,
      error
    );
    throw new ApiError(
      500,
      "An error occurred while removing links from the collection. Please try again."
    );
  }
});

// --- DELETE a collection ---
export const deleteCollection = asyncHandler(async (req, res) => {
  const { collectionId, user_id } = req.params;

  // Validate IDs format
  if (
    !mongoose.Types.ObjectId.isValid(collectionId) ||
    !mongoose.Types.ObjectId.isValid(user_id)
  ) {
    throw new ApiError(400, "Invalid ID format.");
  }

  // Check if collection exists and user owns it
  const collection = await Collection.findOne({
    _id: collectionId,
    owner: user_id,
  });

  if (!collection) {
    throw new ApiError(404, "Collection not found or permission denied.");
  }

  try {
    // Remove this collection from all links that contain it
    if (collection.links && collection.links.length > 0) {
      const updateResult = await Link.updateMany(
        { _id: { $in: collection.links } },
        { $pull: { collections: collectionId } }
      );

      if (updateResult.modifiedCount > 0) {
        console.log(
          `Removed collection ${collectionId} from ${updateResult.modifiedCount} links`
        );
      }
    }

    // Delete the collection
    const deleteResult = await Collection.findByIdAndDelete(collectionId);

    if (!deleteResult) {
      throw new ApiError(500, "Failed to delete collection. Please try again.");
    }

    res.status(200).json({
      success: true,
      message: "Collection deleted successfully.",
      deletedCollection: {
        id: collectionId,
        name: collection.name,
        linkCount: collection.links ? collection.links.length : 0,
      },
    });
  } catch (error) {
    // If something goes wrong, log it for debugging
    console.error(`Error deleting collection ${collectionId}:`, error);
    throw new ApiError(
      500,
      "An error occurred while deleting the collection. Please try again."
    );
  }
});

// --- GET collection statistics ---
export const getCollectionStats = asyncHandler(async (req, res) => {
  const { user_id } = req.params;

  // Validate user_id format
  if (!mongoose.Types.ObjectId.isValid(user_id)) {
    throw new ApiError(400, "Invalid user ID format.");
  }

  try {
    const stats = await Collection.aggregate([
      { $match: { owner: new mongoose.Types.ObjectId(user_id) } },
      {
        $lookup: {
          from: "links",
          localField: "links",
          foreignField: "_id",
          as: "linkDetails",
        },
      },
      {
        $project: {
          name: 1,
          linkCount: { $size: "$links" },
          totalClicks: { $sum: "$linkDetails.viewerCount" },
          createdAt: 1,
          updatedAt: 1,
        },
      },
      { $sort: { name: 1 } },
    ]);

    // Calculate summary statistics
    const totalCollections = stats.length;
    const totalLinks = stats.reduce((sum, stat) => sum + stat.linkCount, 0);
    const totalClicks = stats.reduce(
      (sum, stat) => sum + (stat.totalClicks || 0),
      0
    );
    const averageLinksPerCollection =
      totalCollections > 0 ? (totalLinks / totalCollections).toFixed(2) : 0;

    res.status(200).json({
      success: true,
      stats,
      summary: {
        totalCollections,
        totalLinks,
        totalClicks,
        averageLinksPerCollection: parseFloat(averageLinksPerCollection),
      },
    });
  } catch (error) {
    console.error(
      `Error fetching collection stats for user ${user_id}:`,
      error
    );
    throw new ApiError(
      500,
      "An error occurred while fetching collection statistics. Please try again."
    );
  }
});

// --- GET dashboard data (user, links, collections) ---
export const getDashboardData = asyncHandler(async (req, res) => {
  const { user_id } = req.params;

  // Validate user_id format
  if (!mongoose.Types.ObjectId.isValid(user_id)) {
    throw new ApiError(400, "Invalid user ID format.");
  }

  try {
    // Fetch all data concurrently using Promise.all for better performance
    const [user, links, collections] = await Promise.all([
      // Get user details (excluding sensitive fields)
      User.findById(user_id).select("-password -__v").lean(),

      // Get all user's links with basic fields
      Link.find({ owner: user_id })
        .sort({ createdAt: -1 })
        .select(
          "shortId longUrl viewerCount collections analysisStatus analysisInputMode aiSummary aiTags aiSafetyRating aiClassification createdAt updatedAt"
        )
        .lean(),

      // Get all user's collections with populated link counts
      Collection.find({ owner: user_id })
        .sort({ name: 1 })
        .select("name links isSystem systemCategory isPublic createdAt updatedAt")
        .lean(),
    ]);

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    // Calculate collection statistics
    const collectionStats = collections.map((collection) => ({
      ...collection,
      linkCount: collection.links ? collection.links.length : 0,
    }));

    // Calculate overall statistics
    const totalLinks = links.length;
    const totalCollections = collections.length;
    const totalClicks = links.reduce(
      (sum, link) => sum + (link.viewerCount || 0),
      0
    );
    const averageLinksPerCollection =
      totalCollections > 0 ? (totalLinks / totalCollections).toFixed(2) : 0;

    res.status(200).json({
      success: true,
      data: {
        user,
        links,
        collections: collectionStats,
        stats: {
          totalLinks,
          totalCollections,
          totalClicks,
          averageLinksPerCollection: parseFloat(averageLinksPerCollection),
        },
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    console.error(`Error fetching dashboard data for user ${user_id}:`, error);
    throw new ApiError(
      500,
      "An error occurred while fetching dashboard data. Please try again."
    );
  }
});

export const shareCollection = asyncHandler(async (req, res) => {
  const { collectionId, user_id } = req.params;
  const { isPublic = true } = req.body;

  if (
    !mongoose.Types.ObjectId.isValid(collectionId) ||
    !mongoose.Types.ObjectId.isValid(user_id)
  ) {
    throw new ApiError(400, "Invalid ID format.");
  }

  const collection = await Collection.findOneAndUpdate(
    { _id: collectionId, owner: user_id },
    { isPublic: Boolean(isPublic) },
    { new: true, runValidators: true }
  ).lean();

  if (!collection) {
    throw new ApiError(404, "Collection not found or permission denied.");
  }

  res.status(200).json({
    success: true,
    message: collection.isPublic
      ? "Collection sharing enabled"
      : "Collection sharing disabled",
    collection,
    shareUrl: collection.isPublic
      ? `${process.env.REACT_APP_FRONTEND_URL}/shared/collections/${collection._id}`
      : null,
  });
});

export const getSharedCollection = asyncHandler(async (req, res) => {
  const { collectionId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(collectionId)) {
    throw new ApiError(400, "Invalid collection ID format.");
  }

  const collection = await Collection.findById(collectionId)
    .select("name description links owner isPublic createdAt updatedAt")
    .populate(
      "links",
      "shortId longUrl viewerCount analysisStatus aiSummary aiTags aiSafetyRating aiClassification createdAt"
    )
    .lean();

  if (!collection) {
    throw new ApiError(404, "Shared collection not found.");
  }

  const viewerId = getOptionalUserIdFromRequest(req);
  const isOwner = viewerId && String(collection.owner) === String(viewerId);
  const approved = await hasApprovedAccess({
    resourceType: "collection",
    resourceId: collection._id,
    userId: viewerId,
  });

  if (!collection.isPublic && !isOwner && !approved) {
    return res.status(200).json({
      success: false,
      requiresApproval: true,
      collection: {
        _id: collection._id,
        name: collection.name,
        isPublic: false,
      },
      message: "This collection is private. Request access from the owner.",
    });
  }

  res.status(200).json({
    success: true,
    collection,
  });
});

const generateImportedShortId = async () => {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const shortId = Array.from({ length: 7 }, () =>
      chars.charAt(Math.floor(Math.random() * chars.length))
    ).join("");
    const existing = await Link.findOne({ shortId });
    if (!existing) return shortId;
  }
  return `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 4)}`.slice(0, 9);
};

export const importSharedCollection = asyncHandler(async (req, res) => {
  const { collectionId } = req.params;
  const { user_id } = req.params;

  if (
    !mongoose.Types.ObjectId.isValid(collectionId) ||
    !mongoose.Types.ObjectId.isValid(user_id)
  ) {
    throw new ApiError(400, "Invalid ID format.");
  }

  const sourceCollection = await Collection.findById(collectionId).populate(
    "links"
  );

  if (!sourceCollection) {
    throw new ApiError(404, "Collection not found.");
  }

  if (String(sourceCollection.owner) === String(user_id)) {
    throw new ApiError(400, "You already own this collection.");
  }

  const approved = await hasApprovedAccess({
    resourceType: "collection",
    resourceId: sourceCollection._id,
    userId: user_id,
  });

  if (!sourceCollection.isPublic && !approved) {
    throw new ApiError(403, "Access approval is required before importing.");
  }

  const baseName = sourceCollection.name;
  let targetName = baseName;
  let suffix = 1;
  while (await Collection.findOne({ owner: user_id, name: targetName })) {
    suffix += 1;
    targetName = `${baseName} (${suffix})`;
  }

  const importedCollection = await Collection.create({
    name: targetName,
    owner: user_id,
    links: [],
  });

  const importedLinks = [];
  for (const sourceLink of sourceCollection.links || []) {
    const importedLink = await Link.create({
      shortId: await generateImportedShortId(),
      longUrl: sourceLink.longUrl,
      owner: user_id,
      aiSummary: sourceLink.aiSummary,
      aiTags: sourceLink.aiTags,
      aiSafetyRating: sourceLink.aiSafetyRating,
      aiSafetyJustification: sourceLink.aiSafetyJustification,
      aiClassification: sourceLink.aiClassification,
      analysisStatus: sourceLink.analysisStatus,
      collections: [importedCollection._id],
    });
    importedLinks.push(importedLink._id);
  }

  importedCollection.links = importedLinks;
  await importedCollection.save();

  res.status(201).json({
    success: true,
    message: "Collection added to your workspace.",
    collection: importedCollection,
    importedLinks: importedLinks.length,
  });
});

// --- BULK ADD links to collection ---
export const bulkAddLinksToCollection = asyncHandler(async (req, res) => {
  const { collectionId, user_id } = req.params;
  const { linkIds } = req.body;

  // Validate IDs format
  if (
    !mongoose.Types.ObjectId.isValid(collectionId) ||
    !mongoose.Types.ObjectId.isValid(user_id)
  ) {
    throw new ApiError(400, "Invalid ID format.");
  }

  // Validate linkIds array
  if (!Array.isArray(linkIds) || linkIds.length === 0) {
    throw new ApiError(400, "linkIds must be a non-empty array.");
  }

  // Limit the number of links that can be added at once
  if (linkIds.length > 1000) {
    throw new ApiError(400, "Cannot add more than 1000 links at once.");
  }

  // Validate each linkId format
  for (const linkId of linkIds) {
    if (!mongoose.Types.ObjectId.isValid(linkId)) {
      throw new ApiError(400, `Invalid link ID format: ${linkId}`);
    }
  }

  // Check if collection exists and user owns it
  const collection = await Collection.findOne({
    _id: collectionId,
    owner: user_id,
  });

  if (!collection) {
    throw new ApiError(404, "Collection not found or permission denied.");
  }

  // Check if all links exist and belong to the user
  const links = await Link.find({
    _id: { $in: linkIds },
    owner: user_id,
  });

  if (links.length !== linkIds.length) {
    const foundIds = links.map((link) => link._id.toString());
    const missingIds = linkIds.filter((id) => !foundIds.includes(id));
    throw new ApiError(
      400,
      `Some links not found or permission denied: ${missingIds.join(", ")}`
    );
  }

  try {
    // Add links to collection (avoid duplicates)
    const updatedCollection = await Collection.findByIdAndUpdate(
      collectionId,
      { $addToSet: { links: { $each: linkIds } } },
      { new: true, runValidators: true }
    );

    // Update links to include this collection (avoid duplicates)
    const updateResult = await Link.updateMany(
      { _id: { $in: linkIds } },
      { $addToSet: { collections: collectionId } }
    );

    res.status(200).json({
      success: true,
      message: "Links added to collection successfully",
      collection: updatedCollection,
      addedLinks: linkIds.length,
      modifiedLinks: updateResult.modifiedCount,
    });
  } catch (error) {
    console.error(
      `Error bulk adding links to collection ${collectionId}:`,
      error
    );
    throw new ApiError(
      500,
      "An error occurred while adding links to the collection. Please try again."
    );
  }
});

// --- BULK MOVE links between collections ---
export const bulkMoveLinks = asyncHandler(async (req, res) => {
  const { user_id } = req.params;
  const { linkIds, sourceCollectionId, targetCollectionId } = req.body;

  // Validate IDs format
  if (
    !Array.isArray(linkIds) ||
    linkIds.length === 0 ||
    !mongoose.Types.ObjectId.isValid(targetCollectionId) ||
    !mongoose.Types.ObjectId.isValid(user_id)
  ) {
    throw new ApiError(400, "Invalid parameters provided.");
  }

  // Validate each linkId format
  for (const linkId of linkIds) {
    if (!mongoose.Types.ObjectId.isValid(linkId)) {
      throw new ApiError(400, `Invalid link ID format: ${linkId}`);
    }
  }

  // Check if target collection exists and user owns it
  const targetCollection = await Collection.findOne({
    _id: targetCollectionId,
    owner: user_id,
  });

  if (!targetCollection) {
    throw new ApiError(
      404,
      "Target collection not found or permission denied."
    );
  }

  // Check if source collection exists (if provided)
  if (
    sourceCollectionId &&
    mongoose.Types.ObjectId.isValid(sourceCollectionId)
  ) {
    const sourceCollection = await Collection.findOne({
      _id: sourceCollectionId,
      owner: user_id,
    });

    if (!sourceCollection) {
      throw new ApiError(
        404,
        "Source collection not found or permission denied."
      );
    }
  }

  // Check if all links exist and belong to the user
  const links = await Link.find({
    _id: { $in: linkIds },
    owner: user_id,
  });

  if (links.length !== linkIds.length) {
    const foundIds = links.map((link) => link._id.toString());
    const missingIds = linkIds.filter((id) => !foundIds.includes(id));
    throw new ApiError(
      400,
      `Some links not found or permission denied: ${missingIds.join(", ")}`
    );
  }

  try {
    // Remove links from source collection (if provided)
    if (sourceCollectionId) {
      await Collection.findByIdAndUpdate(sourceCollectionId, {
        $pull: { links: { $in: linkIds } },
      });
    }

    // Add links to target collection
    const updatedTargetCollection = await Collection.findByIdAndUpdate(
      targetCollectionId,
      { $addToSet: { links: { $each: linkIds } } },
      { new: true, runValidators: true }
    );

    // Update links to reflect the new collection assignment
    await Link.updateMany(
      { _id: { $in: linkIds } },
      {
        $pull: { collections: sourceCollectionId || { $exists: false } },
        $addToSet: { collections: targetCollectionId },
      }
    );

    res.status(200).json({
      success: true,
      message: "Links moved successfully",
      targetCollection: updatedTargetCollection,
      movedLinks: linkIds.length,
    });
  } catch (error) {
    console.error(`Error moving links:`, error);
    throw new ApiError(
      500,
      "An error occurred while moving links. Please try again."
    );
  }
});

// --- ENHANCED DELETE collection with option to delete links ---
export const deleteCollectionEnhanced = asyncHandler(async (req, res) => {
  const { collectionId, user_id } = req.params;
  const { deleteLinks = false } = req.query;

  // Validate IDs format
  if (
    !mongoose.Types.ObjectId.isValid(collectionId) ||
    !mongoose.Types.ObjectId.isValid(user_id)
  ) {
    throw new ApiError(400, "Invalid ID format.");
  }

  // Check if collection exists and user owns it
  const collection = await Collection.findOne({
    _id: collectionId,
    owner: user_id,
  });

  if (!collection) {
    throw new ApiError(404, "Collection not found or permission denied.");
  }

  try {
    if (
      deleteLinks === "true" &&
      collection.links &&
      collection.links.length > 0
    ) {
      // Delete all links in the collection
      const deleteResult = await Link.deleteMany({
        _id: { $in: collection.links },
        owner: user_id,
      });

      console.log(
        `Deleted ${deleteResult.deletedCount} links from collection ${collectionId}`
      );
    } else if (collection.links && collection.links.length > 0) {
      // Remove this collection from all links that contain it
      const updateResult = await Link.updateMany(
        { _id: { $in: collection.links } },
        { $pull: { collections: collectionId } }
      );

      if (updateResult.modifiedCount > 0) {
        console.log(
          `Removed collection ${collectionId} from ${updateResult.modifiedCount} links`
        );
      }
    }

    // Delete the collection
    const deleteResult = await Collection.findByIdAndDelete(collectionId);

    if (!deleteResult) {
      throw new ApiError(500, "Failed to delete collection. Please try again.");
    }

    res.status(200).json({
      success: true,
      message: "Collection deleted successfully.",
      deletedCollection: {
        id: collectionId,
        name: collection.name,
        linkCount: collection.links ? collection.links.length : 0,
        linksDeleted: deleteLinks === "true",
      },
    });
  } catch (error) {
    console.error(`Error deleting collection ${collectionId}:`, error);
    throw new ApiError(
      500,
      "An error occurred while deleting the collection. Please try again."
    );
  }
});

// Advanced filtering endpoint
// Advanced filtering endpoint
// Advanced filtering endpoint
export const filterLinks = asyncHandler(async (req, res) => {
  const { user_id } = req.params;
  console.log("filterLinks request body:", JSON.stringify(req.body, null, 2));

  try {
    const {
      searchQuery,
      tags,
      dateRange,
      safetyScore,
      clicks,
      sortBy = "createdAt_desc",
      page = 1,
      limit = 20,
    } = req.body;

    // Validate user_id format
    if (!mongoose.Types.ObjectId.isValid(user_id)) {
      throw new ApiError(400, "Invalid user ID format.");
    }

    // Parse pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;

    // Build filter query
    const filterQuery = { owner: user_id };

    // Search query
    if (searchQuery) {
      filterQuery.$or = [
        { longUrl: { $regex: searchQuery, $options: "i" } },
        { aiSummary: { $regex: searchQuery, $options: "i" } },
      ];
    }

    // Tags filter
    if (tags && Array.isArray(tags) && tags.length > 0) {
      filterQuery.aiTags = { $in: tags };
    }

    // Date range filter
    if (dateRange && (dateRange.startDate || dateRange.endDate)) {
      const dateFilter = {};
      let hasDateFilter = false;

      if (dateRange.startDate) {
        const startDate = new Date(dateRange.startDate);
        if (!isNaN(startDate.getTime())) {
          dateFilter.$gte = startDate;
          hasDateFilter = true;
        }
      }
      
      if (dateRange.endDate) {
        const endDate = new Date(dateRange.endDate);
        if (!isNaN(endDate.getTime())) {
          // Set end date to end of day (23:59:59.999)
          endDate.setHours(23, 59, 59, 999);
          dateFilter.$lte = endDate;
          hasDateFilter = true;
        }
      }

      if (hasDateFilter) {
        filterQuery.createdAt = dateFilter;
      }
    }

    // Safety score filter
    if (safetyScore) {
      const isDefault = safetyScore.min === 1 && safetyScore.max === 5;
      if (!isDefault) {
        const safetyFilter = {};
        let hasSafetyFilter = false;

        if (safetyScore.min !== undefined) {
          safetyFilter.$gte = parseInt(safetyScore.min);
          hasSafetyFilter = true;
        }
        if (safetyScore.max !== undefined) {
          safetyFilter.$lte = parseInt(safetyScore.max);
          hasSafetyFilter = true;
        }

        if (hasSafetyFilter) {
          filterQuery.aiSafetyRating = safetyFilter;
        }
      }
    }

    // Clicks filter
    if (clicks && clicks.min > 0) {
      const clicksFilter = { $gte: parseInt(clicks.min) };
      if (clicks.max !== undefined) {
        clicksFilter.$lte = parseInt(clicks.max);
      }
      filterQuery.viewerCount = clicksFilter;
    }

    console.log("Constructed filterQuery:", JSON.stringify(filterQuery, null, 2));

    // Build sort object
    let sortObject = {};
    switch (sortBy) {
      case "createdAt_asc":
        sortObject = { createdAt: 1 };
        break;
      case "createdAt_desc":
        sortObject = { createdAt: -1 };
        break;
      case "clicks_asc":
        sortObject = { viewerCount: 1 };
        break;
      case "clicks_desc":
        sortObject = { viewerCount: -1 };
        break;
      case "safety_asc":
        sortObject = { aiSafetyRating: 1 };
        break;
      case "safety_desc":
        sortObject = { aiSafetyRating: -1 };
        break;
      default:
        sortObject = { createdAt: -1 };
    }

    // Execute query with pagination
    const skip = (pageNum - 1) * limitNum;

    const [links, total] = await Promise.all([
      Link.find(filterQuery).sort(sortObject).skip(skip).limit(limitNum).lean(),
      Link.countDocuments(filterQuery),
    ]);

    res.status(200).json(
      new ApiResponse(200, {
        links,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      })
    );
  } catch (error) {
    console.error("Error in filterLinks:", error);
    throw new ApiError(500, "Error filtering links: " + error.message);
  }
});

// Get unique tags for a user
export const getUserTags = asyncHandler(async (req, res) => {
  const { user_id } = req.params;

  const tags = await User.findById(user_id).select("LinkTags");

  res.status(200).json(new ApiResponse(200, { tags: tags }));
});
