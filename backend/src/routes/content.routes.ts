import { Router } from "express";
import { getContentById, listContent } from "../controllers/content.controller";
import { listShows } from "../controllers/show.controller";

const router = Router();

// Public on purpose -- see the note at the top of the controller. No auth
// middleware belongs here.
router.get("/", listContent);
// Two path segments after the mount point, so this never collides with the
// single-segment "/:id" route below regardless of declaration order.
router.get("/:contentId/shows", listShows);
router.get("/:id", getContentById);

export default router;
