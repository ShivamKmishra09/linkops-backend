import mongoose from "mongoose";

const linkSchema = new mongoose.Schema(
  {
    shortId: { type: String, required: true, unique: true }, // e.g., "abcde"
    longUrl: { type: String, required: true },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    viewerCount: { type: Number, default: 0 },
    isPublic: { type: Boolean, default: false },
    // --- New AI Fields ---
    aiSummary: { type: String, default: null },
    aiTags: { type: [String], default: [] },
    aiSafetyRating: { type: Number, default: null },
    aiSafetyJustification: { type: String, default: null },
    aiClassification: {
      category: { type: String, default: "Other" },
      confidence: { type: Number, default: 0 },
      reason: { type: String, default: "Analysis has not been completed." },
    },
    analysisStatus: {
      type: String,
      enum: ["PENDING", "COMPLETED", "FAILED"],
      default: "PENDING",
    },
    analysisAuthProfile: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AuthProfile",
      default: null,
    },
    analysisSnapshotText: {
      type: String,
      default: null,
      maxlength: 200000,
    },
    analysisInputMode: {
      type: String,
      enum: ["URL_SCRAPE", "AUTH_PROFILE", "SNAPSHOT"],
      default: "URL_SCRAPE",
    },
    // ... inside linkSchema
    collections: [{ type: mongoose.Schema.Types.ObjectId, ref: "Collection" }],
  },
  { timestamps: true }
);

export const Link = mongoose.model("Link", linkSchema);
