import { Router } from "express";
import { checkForUserAuthentication } from "../middleware/auth.middleware.js";
import {
  completeGoogleConnector,
  deleteConnector,
  listConnectors,
  saveAtlassianConnector,
  saveGitHubConnector,
  startGoogleConnector,
} from "../controllers/connector.controller.js";

const router = Router();

router
  .route("/loggedin/:user_id/connectors")
  .get(checkForUserAuthentication, listConnectors);

router
  .route("/loggedin/:user_id/connectors/atlassian")
  .post(checkForUserAuthentication, saveAtlassianConnector);

router
  .route("/loggedin/:user_id/connectors/github")
  .post(checkForUserAuthentication, saveGitHubConnector);

router
  .route("/loggedin/:user_id/connectors/google/start")
  .post(checkForUserAuthentication, startGoogleConnector);

router.route("/connectors/google/callback").get(completeGoogleConnector);

router
  .route("/loggedin/:user_id/connectors/:connectorId")
  .delete(checkForUserAuthentication, deleteConnector);

export default router;
