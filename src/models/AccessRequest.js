import mongoose from "mongoose";

const accessRequestSchema = new mongoose.Schema(
  {
    resourceType: {
      type: String,
      enum: ["collection", "link"],
      required: true,
    },
    resourceId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
  },
  { timestamps: true }
);

accessRequestSchema.index(
  { resourceType: 1, resourceId: 1, requester: 1 },
  { unique: true }
);

export const AccessRequest = mongoose.model(
  "AccessRequest",
  accessRequestSchema
);
