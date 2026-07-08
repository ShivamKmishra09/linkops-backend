import { Router } from "express";
import {
  addurl,
  geturls,
  handleRedirect,
  resolveShortLink,
  deleteUrl,
  editLongUrl,
  updateLinkCollections,
} from "../controllers/redirect.controller.js";

import { checkForUserAuthentication } from "../middleware/auth.middleware.js";

import { createLinkLimiter } from "../middleware/rateLimit.middleware.js";

const router = Router();
router
  .route("/loggedin/:user_id/redirect")
  .patch(checkForUserAuthentication, createLinkLimiter, addurl);
router
  .route("/loggedin/:user_id/url")
  .post(checkForUserAuthentication, createLinkLimiter, addurl);
router
  .route("/loggedin/:user_id/urls")
  .get(checkForUserAuthentication, geturls);
router.route("/linkly/:web_id").get(handleRedirect);
router.route("/linkly/:web_id/resolve").get(resolveShortLink);
router
  .route("/loggedin/:user_id/url/:linkId")
  .patch(checkForUserAuthentication, editLongUrl) // Edits a link
  .delete(checkForUserAuthentication, deleteUrl);
router
  .route("/loggedin/:user_id/link/:linkId/collections")
  .patch(checkForUserAuthentication, updateLinkCollections);

export default router;
