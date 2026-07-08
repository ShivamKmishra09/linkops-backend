import { Router } from "express";
import { checkForUserAuthentication } from "../middleware/auth.middleware.js";
import {
  cancelAuthProfileCapture,
  completeAuthProfileCapture,
  deleteAuthProfile,
  listAuthProfiles,
  startAuthProfileCapture,
} from "../controllers/authProfile.controller.js";

const router = Router();

router
  .route("/loggedin/:user_id/auth-profiles")
  .get(checkForUserAuthentication, listAuthProfiles);

router
  .route("/loggedin/:user_id/auth-profiles/capture")
  .post(checkForUserAuthentication, startAuthProfileCapture);

router
  .route("/loggedin/:user_id/auth-profiles/capture/:sessionId")
  .post(checkForUserAuthentication, completeAuthProfileCapture)
  .delete(checkForUserAuthentication, cancelAuthProfileCapture);

router
  .route("/loggedin/:user_id/auth-profiles/:profileId")
  .delete(checkForUserAuthentication, deleteAuthProfile);

export default router;
