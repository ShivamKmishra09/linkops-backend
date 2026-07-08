import jwt from "jsonwebtoken";
import { AccessRequest } from "../models/AccessRequest.js";

export const getOptionalUserIdFromRequest = (req) => {
  const bearerHeader = req.headers.authorization || req.query.authorization;
  if (!bearerHeader || typeof bearerHeader !== "string") return null;

  try {
    const token = bearerHeader.startsWith("Bearer ")
      ? bearerHeader.split(" ")[1]
      : bearerHeader;
    const decodedToken = jwt.verify(token, process.env.JWT_KEY);
    return decodedToken.userId || decodedToken.sub || decodedToken.id || null;
  } catch {
    return null;
  }
};

export const hasApprovedAccess = async ({
  resourceType,
  resourceId,
  userId,
}) => {
  if (!userId) return false;

  const request = await AccessRequest.findOne({
    resourceType,
    resourceId,
    requester: userId,
    status: "APPROVED",
  }).lean();

  return Boolean(request);
};
