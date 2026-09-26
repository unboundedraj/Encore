/**
 * Public city list. Unauthenticated for the same reason as the catalog: picking
 * a city is the first thing a visitor does, well before signing in.
 */

import type { Request, Response } from "express";
import { listCities } from "../services/cityService";

/** GET /api/cities */
export async function getCities(_req: Request, res: Response) {
  try {
    return res.json({ items: await listCities() });
  } catch (err) {
    console.error("[cities] list failed:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
