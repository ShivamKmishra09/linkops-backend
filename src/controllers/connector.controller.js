import mongoose from "mongoose";
import { asyncHandler } from "../utilities/asyncHandler.js";
import { ApiError } from "../utilities/ApiError.js";
import {
  completeGoogleOAuth,
  createGoogleOAuthUrl,
  deleteConnectorCredential,
  listConnectorCredentials,
  upsertAtlassianCredential,
  upsertGitHubCredential,
} from "../services/connectorService.js";

const assertOwnUserRoute = (req) => {
  const { user_id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(user_id)) {
    throw new ApiError(400, "Invalid user ID format.");
  }

  const tokenUserId =
    req.userData?.userId || req.userData?.sub || req.userData?.id;
  if (tokenUserId && String(tokenUserId) !== String(user_id)) {
    throw new ApiError(403, "You can only manage your own connectors.");
  }

  return user_id;
};

export const listConnectors = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  const connectors = await listConnectorCredentials(userId);

  res.status(200).json({
    success: true,
    connectors,
  });
});

export const saveAtlassianConnector = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  const { siteUrl, email, apiToken } = req.body;

  const connector = await upsertAtlassianCredential({
    ownerId: userId,
    siteUrl,
    email,
    apiToken,
  });

  res.status(200).json({
    success: true,
    message: "Atlassian connector saved.",
    connector,
  });
});

export const saveGitHubConnector = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  const { token } = req.body;

  const connector = await upsertGitHubCredential({
    ownerId: userId,
    token,
  });

  res.status(200).json({
    success: true,
    message: "GitHub connector saved.",
    connector,
  });
});

export const startGoogleConnector = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  const authUrl = createGoogleOAuthUrl({ ownerId: userId });

  res.status(200).json({
    success: true,
    authUrl,
  });
});

export const completeGoogleConnector = asyncHandler(async (req, res) => {
  const { code, state } = req.query;
  await completeGoogleOAuth({ code, state });

  res.redirect(
    `${process.env.REACT_APP_FRONTEND_URL}/home?connector=google&status=connected`
  );
});

export const deleteConnector = asyncHandler(async (req, res) => {
  const userId = assertOwnUserRoute(req);
  const { connectorId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(connectorId)) {
    throw new ApiError(400, "Invalid connector ID format.");
  }

  await deleteConnectorCredential({ ownerId: userId, credentialId: connectorId });

  res.status(200).json({
    success: true,
    message: "Connector deleted.",
  });
});
