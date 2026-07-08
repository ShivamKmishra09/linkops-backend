import mongoose from "mongoose";

const authProfileSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    hostname: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    origin: {
      type: String,
      required: true,
      trim: true,
    },
    encryptedState: {
      iv: { type: String, required: true },
      authTag: { type: String, required: true },
      data: { type: String, required: true },
    },
    status: {
      type: String,
      enum: ["ACTIVE", "EXPIRED", "FAILED"],
      default: "ACTIVE",
      index: true,
    },
    cookieCount: {
      type: Number,
      default: 0,
    },
    localStorageKeyCount: {
      type: Number,
      default: 0,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
    lastValidatedAt: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
      maxlength: 300,
    },
  },
  { timestamps: true }
);

authProfileSchema.index({ owner: 1, hostname: 1, name: 1 }, { unique: true });

export const AuthProfile = mongoose.model("AuthProfile", authProfileSchema);
