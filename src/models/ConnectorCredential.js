import mongoose from "mongoose";

const connectorCredentialSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ["ATLASSIAN", "GITHUB", "GOOGLE"],
      required: true,
      index: true,
    },
    siteUrl: {
      type: String,
      required: true,
      trim: true,
    },
    hostname: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    encryptedCredential: {
      iv: { type: String, required: true },
      authTag: { type: String, required: true },
      data: { type: String, required: true },
    },
    status: {
      type: String,
      enum: ["ACTIVE", "FAILED"],
      default: "ACTIVE",
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
      maxlength: 600,
    },
  },
  { timestamps: true }
);

connectorCredentialSchema.index(
  { owner: 1, provider: 1, hostname: 1 },
  { unique: true }
);

export const ConnectorCredential = mongoose.model(
  "ConnectorCredential",
  connectorCredentialSchema
);
