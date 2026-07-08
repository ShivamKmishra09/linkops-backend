import mongoose from "mongoose";
import { AccessRequest } from "../models/AccessRequest.js";
import { Collection } from "../models/Collection.js";
import { Link } from "../models/Link.js";
import { ApiError } from "../utilities/ApiError.js";
import { asyncHandler } from "../utilities/asyncHandler.js";
import { publishUserEvent } from "../services/realtimeService.js";

const getResource = async (resourceType, resourceKey) => {
  if (resourceType === "collection") {
    if (!mongoose.Types.ObjectId.isValid(resourceKey)) {
      throw new ApiError(400, "Invalid collection ID.");
    }
    return await Collection.findById(resourceKey);
  }

  if (resourceType === "link") {
    return await Link.findOne({ shortId: resourceKey });
  }

  throw new ApiError(400, "Unsupported resource type.");
};

export const requestAccess = asyncHandler(async (req, res) => {
  const { resourceType, resourceKey } = req.params;
  const requesterId = req.userData.userId;
  const resource = await getResource(resourceType, resourceKey);

  if (!resource) {
    throw new ApiError(404, "Shared resource not found.");
  }

  if (String(resource.owner) === String(requesterId)) {
    return res.status(200).json({
      success: true,
      message: "You already own this resource.",
      status: "OWNER",
    });
  }

  if (resource.isPublic) {
    return res.status(200).json({
      success: true,
      message: "This resource is already public.",
      status: "PUBLIC",
    });
  }

  const accessRequest = await AccessRequest.findOneAndUpdate(
    {
      resourceType,
      resourceId: resource._id,
      requester: requesterId,
    },
    {
      $setOnInsert: {
        owner: resource.owner,
      },
      $set: {
        status: "PENDING",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).populate("requester", "username email");

  await publishUserEvent(resource.owner, {
    type: "access-requested",
    reason: "access-requested",
    request: accessRequest,
    refreshAccessRequests: true,
  });

  res.status(200).json({
    success: true,
    message: "Access request sent to the owner.",
    request: accessRequest,
  });
});

export const listAccessRequests = asyncHandler(async (req, res) => {
  const { user_id } = req.params;
  const { status } = req.query;

  const statusFilter = status ? { status } : {};

  const [incoming, outgoing] = await Promise.all([
    AccessRequest.find({ owner: user_id, ...statusFilter })
      .populate("requester", "username email")
      .sort({ updatedAt: -1 })
      .lean(),
    AccessRequest.find({ requester: user_id, ...statusFilter })
      .populate("owner", "username email")
      .sort({ updatedAt: -1 })
      .lean(),
  ]);

  res.status(200).json({
    success: true,
    incoming,
    outgoing,
  });
});

export const updateAccessRequest = asyncHandler(async (req, res) => {
  const { user_id, requestId } = req.params;
  const { status } = req.body;

  if (!["APPROVED", "REJECTED"].includes(status)) {
    throw new ApiError(400, "Status must be APPROVED or REJECTED.");
  }

  const accessRequest = await AccessRequest.findOneAndUpdate(
    { _id: requestId, owner: user_id },
    { status },
    { new: true, runValidators: true }
  )
    .populate("requester", "username email")
    .lean();

  if (!accessRequest) {
    throw new ApiError(404, "Access request not found.");
  }

  await publishUserEvent(accessRequest.requester._id, {
    type: "access-request-updated",
    reason: status.toLowerCase(),
    request: accessRequest,
  });

  res.status(200).json({
    success: true,
    request: accessRequest,
  });
});
