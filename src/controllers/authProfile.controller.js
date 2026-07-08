import mongoose from "mongoose";
import { AuthProfile } from "../models/AuthProfile.js";
import { asyncHandler } from "../utilities/asyncHandler.js";
import { ApiError } from "../utilities/ApiError.js";
import {
  cancelAuthCapture,
  completeAuthCapture,
  listUserAuthProfiles,
  startAuthCapture,
} from "../services/authProfileService.js";

const assertOwnUserRoute = (req) => {
  const { user_id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(user_id)) {
    throw new ApiError(400, "Invalid user ID format.");
  }

  const tokenUserId =
    req.userData?.userId || req.userData?.sub || req.userData?.id;
  if (tokenUserId && String(tokenUserId) !== String(user_id)) {
    throw new ApiError(403, "You can only manage your own auth profiles.");
  }

  return user_id;
};

export const listAuthProfiles = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  const profiles = await listUserAuthProfiles(userId);

  res.status(200).json({
    success: true,
    profiles,
  });
});

export const startAuthProfileCapture = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  const { name, loginUrl } = req.body;

  const capture = await startAuthCapture({
    ownerId: userId,
    name,
    loginUrl,
  });

  res.status(202).json({
    success: true,
    message:
      "A browser window was opened. Log in there, then come back and save the profile.",
    capture,
  });
});

export const completeAuthProfileCapture = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  const { sessionId } = req.params;
  const profile = await completeAuthCapture({ ownerId: userId, sessionId });

  res.status(201).json({
    success: true,
    message: "Auth profile saved.",
    profile,
  });
});

export const cancelAuthProfileCapture = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  const { sessionId } = req.params;

  await cancelAuthCapture({ ownerId: userId, sessionId });

  res.status(200).json({
    success: true,
    message: "Login capture cancelled.",
  });
});

export const deleteAuthProfile = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  const { profileId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(profileId)) {
    throw new ApiError(400, "Invalid auth profile ID format.");
  }

  const deletedProfile = await AuthProfile.findOneAndDelete({
    _id: profileId,
    owner: userId,
  });

  if (!deletedProfile) {
    throw new ApiError(404, "Auth profile not found.");
  }

  res.status(200).json({
    success: true,
    message: "Auth profile deleted.",
  });
});
