import { Router } from "express";
import { getSeatMap, getShow } from "../controllers/show.controller";

/** Mounted at /api/shows. The nested /:contentId/shows list lives on content.routes.ts. */
const router = Router();

router.get("/:showId", getShow);
router.get("/:showId/seats", getSeatMap);

export default router;
