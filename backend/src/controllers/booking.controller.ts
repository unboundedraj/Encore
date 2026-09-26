import type { Request, Response } from "express";
import { getBookingForUser, isValidBookingId } from "../services/bookingViewService";

/**
 * GET /api/bookings/:bookingId   (requireAuth)
 *
 * A read, so ensureUserRecord is not needed here -- only checkout, which
 * writes a row referencing encore_users, pays that cost.
 *
 * A booking belonging to someone else returns 404, not 403. Confirming that a
 * given booking id exists at all is itself information about a stranger's
 * purchase; the ownership check and the existence check collapse to the same
 * response so neither can be distinguished from outside.
 */
export async function getBooking(req: Request, res: Response) {
  const { bookingId } = req.params;
  const userId = req.user?.uid;

  if (!userId) {
    console.error("[bookings] reached without requireAuth");
    return res.status(500).json({ error: "Internal server error" });
  }
  if (!isValidBookingId(bookingId)) {
    return res.status(404).json({ error: "Booking not found" });
  }

  try {
    const result = await getBookingForUser(bookingId, userId);
    if (result.kind === "not_found" || result.kind === "forbidden") {
      return res.status(404).json({ error: "Booking not found" });
    }
    return res.json(result.booking);
  } catch (err) {
    console.error("[bookings] lookup failed:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
