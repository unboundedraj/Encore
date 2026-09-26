import { Router } from "express";
import { getBooking } from "../controllers/booking.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/:bookingId", requireAuth, getBooking);

export default router;
