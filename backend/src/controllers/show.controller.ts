/**
 * Public show/seat reads -- picking a showtime and viewing its seat map.
 * Deliberately unauthenticated, same reasoning as content.controller.ts:
 * browsing happens before sign-in. No requireAuth belongs on this router.
 */

import type { Request, Response } from "express";
import {
  holdGeneralAdmission,
  holdSeats,
  MAX_SEATS_PER_HOLD,
  releaseGeneralAdmission,
  releaseSeats,
} from "../services/lockService";
import {
  describeSeats,
  getGeneralCapacityForHolds,
  getSeatMapForShow,
  getShowDetail,
  getValidSeatIds,
  isValidContentId,
  isValidShowId,
  listShowsForContent,
  ShowNotAssignedError,
} from "../services/showService";
import { HOLD_TTL_SECONDS } from "../config/redis";

/** GET /api/content/:contentId/shows */
export async function listShows(req: Request, res: Response) {
  const { contentId } = req.params;

  if (!isValidContentId(contentId)) {
    return res.status(400).json({ error: "contentId must be a 24-character hex string" });
  }

  const city = typeof req.query.city === "string" ? req.query.city.trim() : null;

  try {
    const shows = await listShowsForContent(contentId, city || null);
    return res.json({ items: shows });
  } catch (err) {
    console.error("[shows] list failed:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/** GET /api/shows/:showId */
export async function getShow(req: Request, res: Response) {
  const { showId } = req.params;

  // Validate before querying: an id that is not even UUID-shaped can never
  // match a row, and handing it to Postgres as a uuid filter throws a cast
  // error that would otherwise surface as a 500 for what is really "no such
  // show."
  if (!isValidShowId(showId)) {
    return res.status(404).json({ error: "Show not found" });
  }

  try {
    // optionalAuth populates req.user when a token is present, so a signed-in
    // caller sees their own holds reflected in availability.
    const show = await getShowDetail(showId, req.user?.uid ?? null);
    if (!show) return res.status(404).json({ error: "Show not found" });
    return res.json(show);
  } catch (err) {
    console.error("[shows] detail failed:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/** GET /api/shows/:showId/seats */
export async function getSeatMap(req: Request, res: Response) {
  const { showId } = req.params;

  if (!isValidShowId(showId)) {
    return res.status(404).json({ error: "Show not found" });
  }

  try {
    const seats = await getSeatMapForShow(showId, req.user?.uid ?? null);
    if (seats === null) return res.status(404).json({ error: "Show not found" });
    return res.json({ items: seats });
  } catch (err) {
    if (err instanceof ShowNotAssignedError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("[shows] seat map failed:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/** Distinguishes "the cache is down" from a genuine bug, so it can 503 rather than 500. */
function isRedisUnavailable(err: unknown): boolean {
  const name = (err as { name?: string }).name ?? "";
  const message = (err as { message?: string }).message ?? "";
  return (
    name === "MaxRetriesPerRequestError" ||
    /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|Connection is closed|Stream isn't writeable|enableOfflineQueue/i.test(
      message
    )
  );
}

/**
 * POST /api/shows/:showId/hold  (requireAuth)
 *
 * Body is { seatIds: [...] } for assigned seating or { quantity: N } for
 * general admission -- whichever the show actually uses.
 *
 * A conflict is a 409 naming what was contested, so the UI can say "someone
 * just took A3" instead of failing generically. Redis being unreachable is a
 * 503, not a silent success: this endpoint exists to promise exclusivity, and
 * without Redis it cannot, so pretending otherwise would push the collision
 * back to after payment, which is the exact problem it was built to remove.
 */
export async function createHold(req: Request, res: Response) {
  const { showId } = req.params;
  const userId = req.user?.uid;

  if (!userId) {
    console.error("[shows] createHold reached without requireAuth");
    return res.status(500).json({ error: "Internal server error" });
  }
  if (!isValidShowId(showId)) return res.status(404).json({ error: "Show not found" });

  const body = req.body as { seatIds?: unknown; quantity?: unknown };
  const wantsSeats = body.seatIds !== undefined;
  const wantsQuantity = body.quantity !== undefined;

  if (wantsSeats === wantsQuantity) {
    return res.status(400).json({
      error: "Provide exactly one of seatIds (assigned seating) or quantity (general admission).",
    });
  }

  try {
    if (wantsSeats) return await holdAssignedSeats(req, res, showId, userId, body.seatIds);
    return await holdGeneral(req, res, showId, userId, body.quantity);
  } catch (err) {
    if (err instanceof ShowNotAssignedError) {
      return res.status(400).json({ error: err.message });
    }
    if (isRedisUnavailable(err)) {
      console.error("[shows] hold unavailable, Redis unreachable:", err);
      return res.status(503).json({ error: "Seat holds are temporarily unavailable. Please retry." });
    }
    console.error("[shows] hold failed:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function holdAssignedSeats(
  req: Request,
  res: Response,
  showId: string,
  userId: string,
  raw: unknown
) {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every((s) => typeof s === "string")) {
    return res.status(400).json({ error: "seatIds must be a non-empty array of seat ids." });
  }
  const seatIds = [...new Set(raw as string[])];

  if (seatIds.length > MAX_SEATS_PER_HOLD) {
    return res
      .status(400)
      .json({ error: `You can hold at most ${MAX_SEATS_PER_HOLD} seats at once.` });
  }

  // Only seats that actually belong to this show's screen may be held.
  // Without this, arbitrary ids would create arbitrary Redis keys -- both
  // meaningless and an easy way to fill the cache with junk.
  const validSeatIds = await getValidSeatIds(showId);
  if (validSeatIds === null) return res.status(404).json({ error: "Show not found" });

  const unknown = seatIds.filter((id) => !validSeatIds.has(id));
  if (unknown.length > 0) {
    return res.status(400).json({ error: "One or more seats do not belong to this show." });
  }

  const result = await holdSeats(showId, seatIds, userId);

  if (!result.ok) {
    const described = await describeSeats(result.conflicts);
    return res.status(409).json({
      error: "Some of those seats were just taken by someone else.",
      seating_mode: "assigned",
      conflicts: result.conflicts.map((id) => ({
        seat_id: id,
        row_label: described.get(id)?.row_label ?? "?",
        seat_number: described.get(id)?.seat_number ?? 0,
      })),
    });
  }

  return res.status(200).json({
    seating_mode: "assigned",
    seat_ids: seatIds,
    expires_at: result.expiresAt.toISOString(),
    ttl_seconds: HOLD_TTL_SECONDS,
  });
}

async function holdGeneral(
  req: Request,
  res: Response,
  showId: string,
  userId: string,
  raw: unknown
) {
  const quantity = typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isInteger(quantity) || quantity < 1) {
    return res.status(400).json({ error: "quantity must be a positive integer." });
  }
  if (quantity > MAX_SEATS_PER_HOLD) {
    return res
      .status(400)
      .json({ error: `You can hold at most ${MAX_SEATS_PER_HOLD} tickets at once.` });
  }

  const capacityForHolds = await getGeneralCapacityForHolds(showId);
  if (capacityForHolds === null) {
    // Either no such show, or it is an assigned-seating show that should have
    // been given seatIds instead.
    if (!(await getShowDetail(showId))) return res.status(404).json({ error: "Show not found" });
    return res
      .status(400)
      .json({ error: "This show uses assigned seating. Send seatIds instead of quantity." });
  }

  const result = await holdGeneralAdmission(showId, quantity, userId, capacityForHolds);

  if (!result.ok) {
    return res.status(409).json({
      error:
        result.available === 0
          ? "This show just sold out."
          : `Only ${result.available} ticket${result.available === 1 ? "" : "s"} left.`,
      seating_mode: "general",
      requested: quantity,
      available: result.available,
    });
  }

  return res.status(200).json({
    seating_mode: "general",
    quantity,
    expires_at: result.expiresAt.toISOString(),
    ttl_seconds: HOLD_TTL_SECONDS,
  });
}

/**
 * POST /api/shows/:showId/release  (requireAuth)
 *
 * Gives up this user's holds early. Releasing is idempotent and never an
 * error: a hold that already expired is indistinguishable from one that was
 * never taken, and both mean the same thing -- the user holds nothing now.
 * That equivalence is what makes TTL expiry and explicit release genuinely
 * interchangeable rather than merely similar.
 */
export async function releaseHold(req: Request, res: Response) {
  const { showId } = req.params;
  const userId = req.user?.uid;

  if (!userId) {
    console.error("[shows] releaseHold reached without requireAuth");
    return res.status(500).json({ error: "Internal server error" });
  }
  if (!isValidShowId(showId)) return res.status(404).json({ error: "Show not found" });

  const body = req.body as { seatIds?: unknown };

  try {
    if (Array.isArray(body.seatIds)) {
      const seatIds = (body.seatIds as unknown[]).filter((s): s is string => typeof s === "string");
      const released = await releaseSeats(showId, seatIds, userId);
      return res.json({ released });
    }
    // No seatIds given: release whatever this user holds on a general
    // admission show.
    const released = await releaseGeneralAdmission(showId, userId);
    return res.json({ released });
  } catch (err) {
    if (isRedisUnavailable(err)) {
      console.error("[shows] release unavailable, Redis unreachable:", err);
      // The hold will expire on its own, so this is not data loss -- just a
      // slower return of the seat.
      return res.status(503).json({ error: "Could not release right now; the hold will expire on its own." });
    }
    console.error("[shows] release failed:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
