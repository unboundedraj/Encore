import { Router } from "express";
import { getContentById, listContent } from "../controllers/content.controller";

const router = Router();

// Public on purpose -- see the note at the top of the controller. No auth
// middleware belongs here.
router.get("/", listContent);
router.get("/:id", getContentById);

export default router;
