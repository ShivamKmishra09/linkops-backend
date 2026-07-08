import { Router } from "express";
import {
  createCollection,
  getCollections,
  getCollection,
  updateCollection,
  deleteCollection,
  addLinksToCollection,
  removeLinksFromCollection,
  getCollectionStats,
  getDashboardData,
  bulkAddLinksToCollection,
  bulkMoveLinks,
  deleteCollectionEnhanced,
  filterLinks,
  getUserTags,
  shareCollection,
  getSharedCollection,
  importSharedCollection,
} from "../controllers/collection.controller.js";
import { checkForUserAuthentication } from "../middleware/auth.middleware.js";
import { streamUserEvents } from "../controllers/realtime.controller.js";
import {
  listAccessRequests,
  requestAccess,
  updateAccessRequest,
} from "../controllers/access.controller.js";

const router = Router();

router
  .route("/loggedin/:user_id/events")
  .get(checkForUserAuthentication, streamUserEvents);

router
  .route("/loggedin/:user_id/access-requests")
  .get(checkForUserAuthentication, listAccessRequests);

router
  .route("/loggedin/:user_id/access-requests/:requestId")
  .patch(checkForUserAuthentication, updateAccessRequest);

router
  .route("/access/:resourceType/:resourceKey/request")
  .post(checkForUserAuthentication, requestAccess);

// Route for getting all dashboard data in one call
router
  .route("/loggedin/:user_id/dashboard-data")
  .get(checkForUserAuthentication, getDashboardData);

// Routes for getting all collections and creating a new one
router
  .route("/loggedin/:user_id/collections")
  .get(checkForUserAuthentication, getCollections)
  .post(checkForUserAuthentication, createCollection);

// Route for getting collection statistics
router
  .route("/loggedin/:user_id/collections/stats")
  .get(checkForUserAuthentication, getCollectionStats);

// Route for getting, updating, and deleting a specific collection
router
  .route("/loggedin/:user_id/collections/:collectionId")
  .get(checkForUserAuthentication, getCollection)
  .patch(checkForUserAuthentication, updateCollection)
  .delete(checkForUserAuthentication, deleteCollectionEnhanced);

router
  .route("/loggedin/:user_id/collections/:collectionId/share")
  .patch(checkForUserAuthentication, shareCollection);

router.route("/shared/collections/:collectionId").get(getSharedCollection);

router
  .route("/loggedin/:user_id/shared/collections/:collectionId/import")
  .post(checkForUserAuthentication, importSharedCollection);

// Route for managing links in a collection
router
  .route("/loggedin/:user_id/collections/:collectionId/links")
  .post(checkForUserAuthentication, addLinksToCollection)
  .delete(checkForUserAuthentication, removeLinksFromCollection);

// Bulk operations routes
router
  .route("/loggedin/:user_id/collections/:collectionId/links/bulk-add")
  .post(checkForUserAuthentication, bulkAddLinksToCollection);

router
  .route("/loggedin/:user_id/collections/links/bulk-move")
  .post(checkForUserAuthentication, bulkMoveLinks);

// Advanced filtering and tags routes
router
  .route("/loggedin/:user_id/links/filter")
  .post(checkForUserAuthentication, filterLinks);

router
  .route("/loggedin/:user_id/tags")
  .get(checkForUserAuthentication, getUserTags);

export default router;
