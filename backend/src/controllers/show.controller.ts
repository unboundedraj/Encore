/**
 * Public show/seat reads -- picking a showtime and viewing its seat map.
 * Deliberately unauthenticated, same reasoning as content.controller.ts:
 * browsing happens before sign-in. No requireAuth belongs on this router.
 */

import type { Request, Response } from "express";
import {
  getSeatMapForShow,
  getShowDetail,
  isValidContentId,
  isValidShowId,
  listShowsForContent,
  ShowNotAssignedError,
} from "../services/showService";

/** GET /api/content/:contentId/shows */
export async function listShows(req: Request, res: Response) {
  const { contentId } = req.params;

  if (!isValidContentId(contentId)) {
    return res.status(400).json({ error: "contentId must be a 24-character hex string" });
  }

  try {
    const shows = await listShowsForContent(contentId);
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
    const show = await getShowDetail(showId);
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
    const seats = await getSeatMapForShow(showId);
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
