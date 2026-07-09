import mongoose from "mongoose";
import { KnowledgeAsset } from "../models/KnowledgeAsset.js";
import { asyncHandler } from "../utilities/asyncHandler.js";
import { ApiError } from "../utilities/ApiError.js";
import {
  backfillKnowledgeAssetsForUser,
  createCollectionFromKnowledgePack,
  getAssetForUser,
  getAssetsForUser,
  getKnowledgeInsightsForUser,
  getKnowledgePacksForUser,
  getRelatedAssetsForUser,
  organizeAssetsIntoSuggestedCollections,
  searchAssetsForUser,
  updateAssetForUser,
} from "../services/knowledgeAssetService.js";

const assertOwnUserRoute = (req) => {
  const { user_id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(user_id)) {
    throw new ApiError(400, "Invalid user ID format.");
  }

  const tokenUserId =
    req.userData?.userId || req.userData?.sub || req.userData?.id;
  if (tokenUserId && String(tokenUserId) !== String(user_id)) {
    throw new ApiError(403, "You can only access your own knowledge assets.");
  }

  return user_id;
};

export const listAssets = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  await backfillKnowledgeAssetsForUser({ ownerId: userId });
  const assets = await getAssetsForUser({
    ownerId: userId,
    filters: req.query || {},
  });

  res.status(200).json({
    success: true,
    assets,
  });
});

export const getAsset = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  const asset = await getAssetForUser({
    ownerId: userId,
    assetId: req.params.assetId,
  });

  if (!asset) {
    throw new ApiError(404, "Knowledge asset not found.");
  }

  res.status(200).json({
    success: true,
    asset,
  });
});

export const getRelatedAssets = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  await backfillKnowledgeAssetsForUser({ ownerId: userId });
  const result = await getRelatedAssetsForUser({
    ownerId: userId,
    assetId: req.params.assetId,
    limit: req.query?.limit || 8,
  });

  if (!result) {
    throw new ApiError(404, "Knowledge asset not found.");
  }

  res.status(200).json({
    success: true,
    ...result,
  });
});

export const updateAsset = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  const asset = await updateAssetForUser({
    ownerId: userId,
    assetId: req.params.assetId,
    updates: req.body || {},
  });

  if (!asset) {
    throw new ApiError(404, "Knowledge asset not found.");
  }

  res.status(200).json({
    success: true,
    message: "Knowledge asset updated.",
    asset,
  });
});

export const searchAssets = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  await backfillKnowledgeAssetsForUser({ ownerId: userId });
  const assets = await searchAssetsForUser({
    ownerId: userId,
    query: req.body?.query || "",
    role: req.body?.role || "",
    assetTypes: req.body?.assetTypes || [],
    sourceOfTruthOnly: Boolean(req.body?.sourceOfTruthOnly),
    staleRisk: req.body?.staleRisk || [],
    limit: req.body?.limit || 20,
  });

  res.status(200).json({
    success: true,
    assets,
  });
});

export const getKnowledgeHealth = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  await backfillKnowledgeAssetsForUser({ ownerId: userId });
  const owner = new mongoose.Types.ObjectId(userId);

  const [
    totalAssets,
    readyAssets,
    failedAssets,
    missingOwner,
    staleAssets,
    byType,
    bySource,
  ] = await Promise.all([
    KnowledgeAsset.countDocuments({ owner }),
    KnowledgeAsset.countDocuments({ owner, analysisStatus: "COMPLETED" }),
    KnowledgeAsset.countDocuments({ owner, analysisStatus: "FAILED" }),
    KnowledgeAsset.countDocuments({ owner, "reliability.missingOwner": true }),
    KnowledgeAsset.countDocuments({
      owner,
      "freshness.staleRisk": { $in: ["medium", "high"] },
    }),
    KnowledgeAsset.aggregate([
      { $match: { owner } },
      { $group: { _id: "$assetType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    KnowledgeAsset.aggregate([
      { $match: { owner } },
      { $group: { _id: "$sourceApp", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  res.status(200).json({
    success: true,
    health: {
      totalAssets,
      readyAssets,
      failedAssets,
      missingOwner,
      staleAssets,
      byType,
      bySource,
    },
  });
});

export const getKnowledgeInsights = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  await backfillKnowledgeAssetsForUser({ ownerId: userId });
  const insights = await getKnowledgeInsightsForUser({ ownerId: userId });

  res.status(200).json({
    success: true,
    insights,
  });
});

export const getKnowledgePacks = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  await backfillKnowledgeAssetsForUser({ ownerId: userId });
  const packs = await getKnowledgePacksForUser({ ownerId: userId });

  res.status(200).json({
    success: true,
    packs,
  });
});

export const createKnowledgePackCollection = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  await backfillKnowledgeAssetsForUser({ ownerId: userId });
  const result = await createCollectionFromKnowledgePack({
    ownerId: userId,
    packKey: req.params.packKey,
  });

  if (!result) {
    throw new ApiError(404, "Knowledge pack not found.");
  }

  res.status(200).json({
    success: true,
    ...result,
  });
});

export const organizeSuggestedCollections = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  await backfillKnowledgeAssetsForUser({ ownerId: userId });
  const result = await organizeAssetsIntoSuggestedCollections({
    ownerId: userId,
  });

  res.status(200).json({
    success: true,
    message: "Suggested collections organized.",
    ...result,
  });
});
