import { Router } from "express";
import { createCheckout } from "../controllers/checkout.controller";
import { createHold, getSeatMap, getShow, releaseHold } from "../controllers/show.controller";
import { ensureUserRecord, optionalAuth, requireAuth } from "../middleware/auth";

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

// ensureUserRecord only here: encore_bookings.user_id is a foreign key to
// encore_users, so the row has to exist before a booking can be inserted.
// Holding touches no foreign key, which is why it does not pay that cost.
router.post("/:showId/checkout", requireAuth, ensureUserRecord, createCheckout);

export default router;
