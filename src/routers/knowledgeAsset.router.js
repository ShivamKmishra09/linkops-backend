import { Router } from "express";
import { checkForUserAuthentication } from "../middleware/auth.middleware.js";
import {
  createKnowledgePackCollection,
  getAsset,
  getKnowledgeHealth,
  getKnowledgeInsights,
  getKnowledgePacks,
  getRelatedAssets,
  listAssets,
  organizeSuggestedCollections,
  searchAssets,
  updateAsset,
} from "../controllers/knowledgeAsset.controller.js";

const router = Router();

router
  .route("/loggedin/:user_id/assets")
  .get(checkForUserAuthentication, listAssets);

router
  .route("/loggedin/:user_id/assets/:assetId")
  .get(checkForUserAuthentication, getAsset)
  .patch(checkForUserAuthentication, updateAsset);

router
  .route("/loggedin/:user_id/assets/:assetId/related")
  .get(checkForUserAuthentication, getRelatedAssets);

router
  .route("/loggedin/:user_id/search")
  .post(checkForUserAuthentication, searchAssets);

router
  .route("/loggedin/:user_id/knowledge-health")
  .get(checkForUserAuthentication, getKnowledgeHealth);

router
  .route("/loggedin/:user_id/knowledge-insights")
  .get(checkForUserAuthentication, getKnowledgeInsights);

router
  .route("/loggedin/:user_id/knowledge-packs")
  .get(checkForUserAuthentication, getKnowledgePacks);

router
  .route("/loggedin/:user_id/knowledge-packs/:packKey/collection")
  .post(checkForUserAuthentication, createKnowledgePackCollection);

router
  .route("/loggedin/:user_id/organize-suggested-collections")
  .post(checkForUserAuthentication, organizeSuggestedCollections);

export default router;
