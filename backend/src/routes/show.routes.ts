import { Router } from "express";
import { createHold, getSeatMap, getShow, releaseHold } from "../controllers/show.controller";
import { optionalAuth, requireAuth } from "../middleware/auth";

/** Mounted at /api/shows. The nested /:contentId/shows list lives on content.routes.ts. */
const router = Router();

// optionalAuth, not requireAuth: browsing stays public, but a signed-in
// caller gets their own holds marked as theirs rather than as somebody's.
router.get("/:showId", optionalAuth, getShow);
router.get("/:showId/seats", optionalAuth, getSeatMap);

// Taking and giving up a hold is done as a specific person -- a hold that
// belongs to nobody could never be released or converted.
router.post("/:showId/hold", requireAuth, createHold);
router.post("/:showId/release", requireAuth, releaseHold);

export default router;
