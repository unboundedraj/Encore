import { Router } from "express";
import { getMe } from "../controllers/me.controller";
import { ensureUserRecord, requireAuth } from "../middleware/auth";

const router = Router();

// The two middlewares are composed deliberately rather than bundled: this route
// needs the encore_users row to exist, so it opts into provisioning. Routes that
// only need to know who the caller is can mount requireAuth on its own.
router.get("/", requireAuth, ensureUserRecord, getMe);

export default router;
