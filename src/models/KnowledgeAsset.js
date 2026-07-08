import mongoose from "mongoose";

const roleBriefSchema = new mongoose.Schema(
  {
    summary: { type: String, default: "" },
    keyPoints: { type: [String], default: [] },
    actions: { type: [String], default: [] },
  },
  { _id: false }
);

const knowledgeAssetSchema = new mongoose.Schema(
  {
    link: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Link",
      required: true,
      index: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    canonicalUrl: { type: String, required: true, trim: true },
    sourceApp: {
      type: String,
      enum: ["github", "confluence", "google", "figma", "dashboard", "other"],
      default: "other",
      index: true,
    },
    assetType: {
      type: String,
      enum: [
        "github_repo",
        "github_pr",
        "github_issue",
        "prd",
        "krd",
        "figma",
        "dashboard",
        "sop",
        "runbook",
        "incident",
        "rca",
        "onboarding",
        "doc",
        "sheet",
        "other",
      ],
      default: "other",
      index: true,
    },
    title: { type: String, default: "", trim: true },
    ownerTeam: { type: String, default: "", trim: true, index: true },
    ownerPerson: { type: String, default: "", trim: true },
    audiences: {
      type: [String],
      enum: ["engineering", "product", "data", "ops", "support", "leadership"],
      default: [],
      index: true,
    },
    status: {
      type: String,
      enum: ["draft", "active", "stale", "deprecated", "unknown"],
      default: "unknown",
      index: true,
    },
    sourceOfTruth: {
      type: String,
      enum: ["yes", "no", "unknown"],
      default: "unknown",
      index: true,
    },
    employeeBrief: {
      whatThisIs: { type: String, default: "" },
      whoShouldUseIt: { type: String, default: "" },
      whenToUseIt: { type: String, default: "" },
      whyItMatters: { type: String, default: "" },
    },
    roleBriefs: {
      engineering: { type: roleBriefSchema, default: () => ({}) },
      product: { type: roleBriefSchema, default: () => ({}) },
      data: { type: roleBriefSchema, default: () => ({}) },
      ops: { type: roleBriefSchema, default: () => ({}) },
      leadership: { type: roleBriefSchema, default: () => ({}) },
    },
    freshness: {
      lastUpdatedHint: { type: String, default: "" },
      datesFound: { type: [String], default: [] },
      staleRisk: {
        type: String,
        enum: ["low", "medium", "high", "unknown"],
        default: "unknown",
        index: true,
      },
      reason: { type: String, default: "" },
    },
    suggestedCollection: { type: String, default: "Other Work Links", trim: true },
    tags: { type: [String], default: [], index: true },
    searchPhrases: { type: [String], default: [] },
    missingInfo: { type: [String], default: [] },
    reliability: {
      missingOwner: { type: Boolean, default: true, index: true },
      duplicateCandidateCount: { type: Number, default: 0 },
      brokenLink: { type: Boolean, default: false, index: true },
      connectorError: { type: String, default: "" },
      confidence: { type: Number, default: 0 },
    },
    analysisStatus: {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    analysisVersion: { type: Number, default: 2 },
    searchText: { type: String, default: "" },
  },
  { timestamps: true }
);

knowledgeAssetSchema.index({ owner: 1, link: 1 }, { unique: true });
knowledgeAssetSchema.index({ owner: 1, sourceApp: 1 });
knowledgeAssetSchema.index({ owner: 1, assetType: 1 });
knowledgeAssetSchema.index({ owner: 1, sourceOfTruth: 1 });
knowledgeAssetSchema.index({ owner: 1, "freshness.staleRisk": 1 });
knowledgeAssetSchema.index({
  title: "text",
  searchText: "text",
  tags: "text",
  searchPhrases: "text",
  ownerTeam: "text",
});

export const KnowledgeAsset = mongoose.model(
  "KnowledgeAsset",
  knowledgeAssetSchema
);
