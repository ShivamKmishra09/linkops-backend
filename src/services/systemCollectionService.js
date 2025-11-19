import { Collection } from "../models/Collection.js";
import { User } from "../models/User.js";
// System collection categories based on AI classification
const SYSTEM_CATEGORIES = [
  "Programming/Tech Blog",
  "Documentation/Reference",
  "Research/Academic",
  "News/Current Affairs",
  "Learning/Education",
  "Product/Service Page",
  "E-commerce/Marketplace",
  "Social Media/Forum",
  "Entertainment/Media",
  "Scam/Phishing/Unsafe",
  "Other",
];

// Create system collections for a new user
export const createSystemCollections = async (userId) => {
  try {
    const systemCollections = SYSTEM_CATEGORIES.map((category) => ({
      name: category,
      owner: userId,
      isSystem: true,
      systemCategory: category,
      description: `Automatically organized ${category.toLowerCase()} content`,
      color: getCategoryColor(category),
      links: [],
    }));

    const createdCollections = await Collection.insertMany(systemCollections);
    console.log(
      `Created ${createdCollections.length} system collections for user ${userId}`
    );
    return createdCollections;
  } catch (error) {
    console.error("Error creating system collections:", error);
    throw error;
  }
};

// Get system collection by category for a user
export const getSystemCollectionByCategory = async (userId, category) => {
  try {
    return await Collection.findOne({
      owner: userId,
      isSystem: true,
      systemCategory: category,
    });
  } catch (error) {
    console.error("Error getting system collection:", error);
    throw error;
  }
};

// Assign link to appropriate system collection based on AI classification
export const assignLinkToSystemCollection = async (
  userId,
  linkId,
  aiClassification
) => {
  try {
    const category = (aiClassification && aiClassification.category) || "Other";

    // Try to add link to existing system collection; if not present, create it (upsert)
    const update = {
      $addToSet: { links: linkId },
      $setOnInsert: {
        name: category,
        owner: userId,
        isSystem: true,
        systemCategory: category,
        description: `Automatically organized ${category.toLowerCase()} content`,
        color: getCategoryColor(category),
      },
    };

    const opts = { new: true, upsert: true, setDefaultsOnInsert: true };

    const systemCollection = await Collection.findOneAndUpdate(
      { owner: userId, isSystem: true, systemCategory: category },
      update,
      opts
    );

    if (systemCollection) {
      console.log(`Assigned link ${linkId} to system collection ${category}`);
    }

    return systemCollection;
  } catch (error) {
    console.error("Error assigning link to system collection:", error);
    throw error;
  }
};

// Get color for each category
const getCategoryColor = (category) => {
  const colorMap = {
    "Programming/Tech Blog": "#3B82F6", // Blue
    "Documentation/Reference": "#10B981", // Green
    "Research/Academic": "#8B5CF6", // Purple
    "News/Current Affairs": "#EF4444", // Red
    "Learning/Education": "#F59E0B", // Amber
    "Product/Service Page": "#06B6D4", // Cyan
    "E-commerce/Marketplace": "#84CC16", // Lime
    "Social Media/Forum": "#EC4899", // Pink
    "Entertainment/Media": "#F97316", // Orange
    "Scam/Phishing/Unsafe": "#DC2626", // Dark Red
    Other: "#6B7280", // Gray
  };

  return colorMap[category] || "#6B7280";
};

export const addLinkTagsToUser = async (userId, linkTags) => {
  try {
    // Guard input
    if (!userId) throw new Error("userId is required");
    if (!Array.isArray(linkTags) || linkTags.length === 0) return;

    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");

    // Normalize existing fields (support legacy `LinkTags` or canonical `linkTags`)
    const existing = Array.isArray(user.linkTags)
      ? user.linkTags
      : Array.isArray(user.LinkTags)
      ? user.LinkTags
      : [];

    // Ensure we write to canonical field
    user.linkTags = existing;

    // Use a Set for dedupe and safe includes operations
    const tagSet = new Set(user.linkTags.map((t) => String(t)));

    for (const rawTag of linkTags) {
      if (!rawTag) continue;
      const tag = String(rawTag).trim();
      if (tag === "") continue;
      if (!tagSet.has(tag)) {
        tagSet.add(tag);
        user.linkTags.push(tag);
      }
    }

    // Keep legacy field in sync if present
    user.LinkTags = user.linkTags;

    await user.save();
    return user;
  } catch (error) {
    console.error("Error adding link tags to user:", error);
    throw error;
  }
};
